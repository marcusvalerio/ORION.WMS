import "server-only";
import { z } from "zod";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError, NotFoundError } from "../errors";
import { parse, uuid } from "../validation";
import { processOutbox, queueCounts, type ProcessOptions } from "../integrations/outbox/processor";
import { transportFromEnv, type Transport } from "../integrations/outbox/transports";
import { audit, runOperation, type OpOptions } from "./common";

export const INTEGRATION_STATUSES = ["pending", "sending", "sent", "failed", "discarded"] as const;

export interface IntegrationEventRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  last_attempt_at: string | null;
  processed_at: string | null;
  transport: string | null;
  discard_reason: string | null;
  discarded_by_name: string | null;
  discarded_at: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

const SELECT = `select e.id, e.event_type, e.aggregate_type, e.aggregate_id, e.status, e.attempts, e.last_error,
    e.next_attempt_at::text as next_attempt_at, e.last_attempt_at::text as last_attempt_at, e.processed_at::text as processed_at,
    e.transport, e.discard_reason, u.name as discarded_by_name, e.discarded_at::text as discarded_at, e.payload,
    e.created_at::text as created_at
  from wms.integration_events e left join wms.users u on u.id = e.discarded_by`;

export async function listOutboxEvents(
  ctx: Ctx,
  f: { status?: string | null; type?: string | null; q?: string | null; page?: number; pageSize?: number } = {},
) {
  assertCan(ctx, "audit.view");
  const pageSize = f.pageSize ?? 30;
  const page = Math.max(1, f.page ?? 1);
  const status = f.status && (INTEGRATION_STATUSES as readonly string[]).includes(f.status) ? f.status : null;
  const params = [ctx.user.companyId, status, f.type || null, f.q?.trim() || null];
  const where = `where e.company_id = $1 and ($2::text is null or e.status = $2) and ($3::text is null or e.event_type = $3)
    and ($4::text is null or e.payload::text ilike '%' || $4 || '%' or e.id::text = $4 or coalesce(e.last_error, '') ilike '%' || $4 || '%')`;
  const [count] = await ctx.db.query<{ total: number }>(`select count(*) as total from wms.integration_events e ${where}`, params);
  const rows = await ctx.db.query<IntegrationEventRow>(
    `${SELECT} ${where} order by e.created_at desc, e.id limit ${pageSize} offset ${(page - 1) * pageSize}`,
    params,
  );
  const types = await ctx.db.query<{ event_type: string }>(
    `select distinct event_type from wms.integration_events where company_id = $1 order by event_type`,
    [ctx.user.companyId],
  );
  return {
    rows,
    total: count.total,
    page,
    pageSize,
    counts: await queueCounts(ctx.db, ctx.user.companyId),
    types: types.map((t) => t.event_type),
  };
}

export async function getOutboxEvent(ctx: Ctx, id: string): Promise<IntegrationEventRow> {
  assertCan(ctx, "audit.view");
  const [row] = await ctx.db.query<IntegrationEventRow>(`${SELECT} where e.id = $1 and e.company_id = $2`, [id, ctx.user.companyId]);
  if (!row) throw new NotFoundError("Evento de integração");
  return row;
}

/** Botão "Processar fila": processa os eventos elegíveis da empresa do usuário. */
export async function processQueue(ctx: Ctx, overrides: Partial<ProcessOptions> & { transport?: Transport } = {}) {
  assertCan(ctx, "integration.process");
  let transport = overrides.transport;
  if (!transport) {
    const config = transportFromEnv();
    if (!config.ok) throw new DomainError(`Transporte de integração mal configurado: ${config.error}`, "INTEGRATION_CONFIG");
    transport = config.transport;
  }
  const result = await processOutbox(ctx.db, { ...overrides, transport, companyId: ctx.user.companyId });
  if (result.claimed) {
    await audit(ctx.db, ctx, "integration.processed", "integration", null, null, {
      transport: transport.name,
      claimed: result.claimed,
      sent: result.sent,
      retrying: result.retrying,
      failed: result.failed,
    });
  }
  return result;
}

/** Reenviar: devolve o evento à fila imediatamente, com as tentativas zeradas. */
export async function retryOutboxEvent(ctx: Ctx, id: string, opts?: OpOptions) {
  assertCan(ctx, "integration.manage");
  const eventId = parse(uuid("Evento"), id);
  return runOperation(ctx, "integration.retry", opts, async (tx) => {
    const [e] = await tx.query<{ status: string; event_type: string }>(
      `select status, event_type from wms.integration_events where id = $1 and company_id = $2 for update`,
      [eventId, ctx.user.companyId],
    );
    if (!e) throw new NotFoundError("Evento de integração");
    if (!["failed", "discarded", "pending"].includes(e.status)) {
      throw new DomainError(
        e.status === "sent" ? "Evento já enviado: não é reenviado para evitar duplicidade no ERP." : "Evento em envio neste momento; aguarde.",
        "INVALID_STATUS",
      );
    }
    await tx.query(
      `update wms.integration_events set status = 'pending', attempts = 0, next_attempt_at = now(), locked_at = null,
         discard_reason = null, discarded_by = null, discarded_at = null where id = $1`,
      [eventId],
    );
    await audit(tx, ctx, "integration.retried", "integration", eventId, e.event_type, { previous_status: e.status });
    return { id: eventId };
  });
}

const discardSchema = z.object({
  reason: z.string({ error: "Informe o motivo." }).trim().min(5, "Descreva o motivo (mínimo 5 caracteres).").max(500),
});

/** Descartar: o evento deixa de ser enviado; exige motivo e fica auditado. */
export async function discardOutboxEvent(ctx: Ctx, id: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "integration.manage");
  const eventId = parse(uuid("Evento"), id);
  const { reason } = parse(discardSchema, input);
  return runOperation(ctx, "integration.discard", opts, async (tx) => {
    const [e] = await tx.query<{ status: string; event_type: string }>(
      `select status, event_type from wms.integration_events where id = $1 and company_id = $2 for update`,
      [eventId, ctx.user.companyId],
    );
    if (!e) throw new NotFoundError("Evento de integração");
    if (!["pending", "failed"].includes(e.status)) {
      throw new DomainError("Só eventos na fila ou com falha podem ser descartados.", "INVALID_STATUS");
    }
    await tx.query(
      `update wms.integration_events set status = 'discarded', discard_reason = $2, discarded_by = $3, discarded_at = now(), locked_at = null
       where id = $1`,
      [eventId, reason, ctx.user.id],
    );
    await audit(tx, ctx, "integration.discarded", "integration", eventId, e.event_type, { reason, previous_status: e.status });
    return { id: eventId };
  });
}
