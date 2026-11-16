import "server-only";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { DomainError } from "../errors";
import { buildAtlasPayload } from "../integrations/atlas/outbound-payloads";

export interface OpOptions {
  /** Chave única da requisição (gerada pelo formulário) para evitar execução duplicada. */
  idempotencyKey?: string;
}

/** Gera o próximo código sequencial legível (ex.: REC-000001) de forma transacional. */
export async function nextCode(tx: Queryable, companyId: string, prefix: string): Promise<string> {
  const [row] = await tx.query<{ value: number }>(
    `insert into wms.counters (company_id, scope, value) values ($1, $2, 1)
     on conflict (company_id, scope) do update set value = wms.counters.value + 1
     returning value`,
    [companyId, prefix],
  );
  return `${prefix}-${String(row.value).padStart(6, "0")}`;
}

export async function audit(
  tx: Queryable,
  ctx: Ctx,
  action: string,
  entityType: string,
  entityId: string | null,
  entityCode: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await tx.query(
    `insert into wms.audit_log (company_id, user_id, action, entity_type, entity_id, entity_code, details)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [ctx.user.companyId, ctx.user.id, action, entityType, entityId, entityCode, JSON.stringify(details)],
  );
}

export async function enqueueIntegrationEvent(
  tx: Queryable,
  ctx: Ctx,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const companyId = ctx.user.companyId;
  // Empresa vinculada ao ATLAS: payload no formato do contrato (ids atlas_*), ver integrations/atlas/outbound-payloads.ts.
  const [link] = await tx.query<{ status: string }>(`select status from wms.atlas_links where company_id = $1`, [companyId]);
  const body = link && link.status !== "disabled" ? await buildAtlasPayload(tx, companyId, eventType, aggregateId, payload) : payload;
  // aggregate.sequence do envelope: crescente por agregado, atribuída na mesma transação (contrato 3.3/3.5).
  const [row] = await tx.query<{ id: string }>(
    `insert into wms.integration_events (company_id, event_type, aggregate_type, aggregate_id, payload, aggregate_seq)
     values ($1, $2, $3, $4, $5,
             coalesce((select max(aggregate_seq) from wms.integration_events
                       where company_id = $1 and aggregate_type = $3 and aggregate_id = $4), 0) + 1)
     returning id`,
    [companyId, eventType, aggregateType, aggregateId, JSON.stringify(body)],
  );
  return row.id;
}

/**
 * Eventos novos do contrato ATLAS (outbound.picking_started,
 * outbound.ready_to_invoice, stock.adjusted...): só existem para empresas
 * vinculadas; sem vínculo nada é enfileirado (o ERP local não os consome).
 */
export async function enqueueAtlasEvent(
  tx: Queryable,
  ctx: Ctx,
  eventType: string,
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const [link] = await tx.query<{ status: string }>(`select status from wms.atlas_links where company_id = $1`, [ctx.user.companyId]);
  if (!link || link.status === "disabled") return null;
  return enqueueIntegrationEvent(tx, ctx, eventType, aggregateType, aggregateId, payload);
}

/**
 * Empresa vinculada ao ATLAS com a integração suspensa (company.deactivated,
 * modo somente leitura): bloqueia toda operação de escrita dos usuários. A
 * aplicação de eventos do próprio ATLAS (usuário de sistema) continua.
 */
async function assertWritable(tx: Queryable, ctx: Ctx): Promise<void> {
  if (ctx.user.isSystem) return;
  const [link] = await tx.query<{ status: string }>(`select status from wms.atlas_links where company_id = $1`, [ctx.user.companyId]);
  if (link?.status === "suspended") {
    throw new DomainError("Empresa em modo somente leitura: a integração com o ATLAS está suspensa.", "READ_ONLY");
  }
}

/**
 * Executa uma operação crítica em transação única, com idempotência opcional.
 * A chave é gravada na mesma transação: se a operação falhar, a chave é desfeita
 * junto; se a mesma requisição for reenviada, o resultado original é devolvido
 * sem reexecutar a operação.
 */
export async function runOperation<T>(
  ctx: Ctx,
  action: string,
  opts: OpOptions | undefined,
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> {
  const key = opts?.idempotencyKey?.trim();
  return ctx.db.transaction(async (tx) => {
    await assertWritable(tx, ctx);
    if (key) {
      const inserted = await tx.query(
        `insert into wms.idempotency_keys (company_id, key, action, user_id) values ($1, $2, $3, $4)
         on conflict (company_id, key) do nothing returning key`,
        [ctx.user.companyId, key, action, ctx.user.id],
      );
      if (inserted.length === 0) {
        const [previous] = await tx.query<{ action: string; result: T }>(
          `select action, result from wms.idempotency_keys where company_id = $1 and key = $2`,
          [ctx.user.companyId, key],
        );
        if (previous.action !== action) {
          throw new DomainError("Chave de requisição reutilizada em outra operação.", "IDEMPOTENCY_CONFLICT");
        }
        return previous.result;
      }
    }
    const result = await fn(tx);
    if (key) {
      await tx.query(`update wms.idempotency_keys set result = $3 where company_id = $1 and key = $2`, [
        ctx.user.companyId,
        key,
        JSON.stringify(result ?? null),
      ]);
    }
    return result;
  });
}

export async function recordTaskEvent(
  tx: Queryable,
  taskId: string,
  userId: string,
  eventType: string,
  fromStatus: string | null,
  toStatus: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await tx.query(
    `insert into wms.task_events (task_id, event_type, from_status, to_status, payload, user_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [taskId, eventType, fromStatus, toStatus, JSON.stringify(payload), userId],
  );
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function assertPositive(value: number, label = "Quantidade"): void {
  if (!Number.isFinite(value) || value <= 0) throw new DomainError(`${label} deve ser maior que zero.`, "VALIDATION");
}
