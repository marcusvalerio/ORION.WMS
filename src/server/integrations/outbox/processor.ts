import "server-only";
import type { Db } from "../../db/types";
import type { OutboxEvent, Transport } from "./transports";
import { deliverEventEmail, emailTransportFromEnv, type EmailTransport } from "./email";

export interface ProcessOptions {
  transport: Transport;
  /** Canal de e-mail (avisos). Omitido: transporte do ambiente (`log` sem EMAIL_API_URL). */
  email?: EmailTransport;
  /** Restringe a uma empresa (painel); omitido, processa todas (cron). */
  companyId?: string | null;
  /** Máximo de eventos por execução. */
  limit?: number;
  /** Tentativas até o evento ir para "falhou". */
  maxAttempts?: number;
  /** Atraso da 1ª retentativa; dobra a cada falha (backoff exponencial). */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Evento "enviando" há mais que isso (processo caiu no meio) volta a ser elegível. */
  staleLockMs?: number;
}

export const OUTBOX_DEFAULTS = {
  limit: 50,
  maxAttempts: 8,
  baseDelayMs: 30_000,
  maxDelayMs: 60 * 60_000,
  staleLockMs: 5 * 60_000,
} as const;

export interface ProcessResult {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  results: { id: string; event_type: string; status: "sent" | "pending" | "failed"; error?: string; next_attempt_in_ms?: number }[];
}

export function backoffMs(attempts: number, base: number = OUTBOX_DEFAULTS.baseDelayMs, max: number = OUTBOX_DEFAULTS.maxDelayMs): number {
  return Math.min(max, base * 2 ** Math.max(0, attempts - 1));
}

const errorText = (error: unknown) => ((error as Error)?.message ?? String(error)).slice(0, 1000);

/**
 * Processa a outbox wms.integration_events.
 *
 * 1. Reserva (claim) até `limit` eventos elegíveis numa transação curta com
 *    `FOR UPDATE SKIP LOCKED`: dois processadores simultâneos nunca pegam o
 *    mesmo evento. O evento passa a "enviando", com `locked_at` e tentativa+1.
 * 2. Entrega cada evento pelo transporte. O `local` roda na mesma transação que
 *    marca o evento como enviado (atômico); o `http` envia fora de transação e o
 *    destino deduplica pelo id do evento (Idempotency-Key).
 *    Em seguida o canal de e-mail gera o aviso do evento, se houver (ver email.ts).
 * 3. Falha: volta para "na fila" com `next_attempt_at` = agora + backoff, ou
 *    "falhou" ao atingir `maxAttempts`; o último erro fica registrado.
 */
export async function processOutbox(db: Db, options: ProcessOptions): Promise<ProcessResult> {
  const o = { ...OUTBOX_DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)) } as Required<ProcessOptions>;
  const claimed = await db.transaction((tx) =>
    tx.query<OutboxEvent>(
      `with c as (
         select id from wms.integration_events
         where ((status = 'pending' and next_attempt_at <= now())
                or (status = 'sending' and locked_at < now() - make_interval(secs => $3::double precision / 1000)))
           and ($1::uuid is null or company_id = $1::uuid)
         order by next_attempt_at, created_at
         limit $2
         for update skip locked
       )
       update wms.integration_events e
          set status = 'sending', locked_at = now(), last_attempt_at = now(), attempts = e.attempts + 1, transport = $4
         from c where e.id = c.id
       returning e.id, e.company_id, e.event_type, e.aggregate_type, e.aggregate_id, e.payload, e.attempts, e.created_at::text as created_at`,
      [o.companyId ?? null, o.limit, o.staleLockMs, o.transport.name],
    ),
  );
  claimed.sort((a, b) => a.created_at.localeCompare(b.created_at));

  const email = options.email ?? emailTransportFromEnv();
  const result: ProcessResult = { claimed: claimed.length, sent: 0, retrying: 0, failed: 0, results: [] };
  for (const event of claimed) {
    try {
      if (o.transport.name === "local") {
        await db.transaction(async (tx) => {
          const [still] = await tx.query(`select id from wms.integration_events where id = $1 and status = 'sending' for update`, [event.id]);
          if (!still) return;
          await o.transport.send(event, tx);
          await deliverEventEmail(tx, event, email);
          await markSent(tx, event.id);
        });
      } else {
        await o.transport.send(event, db);
        await deliverEventEmail(db, event, email);
        await markSent(db, event.id);
      }
      result.sent++;
      result.results.push({ id: event.id, event_type: event.event_type, status: "sent" });
    } catch (error) {
      const message = errorText(error);
      const exhausted = event.attempts >= o.maxAttempts;
      const delay = backoffMs(event.attempts, o.baseDelayMs, o.maxDelayMs);
      await db.query(
        `update wms.integration_events
            set status = $2, last_error = $3, locked_at = null,
                next_attempt_at = case when $2 = 'pending' then now() + make_interval(secs => $4::double precision / 1000) else next_attempt_at end
          where id = $1 and status = 'sending'`,
        [event.id, exhausted ? "failed" : "pending", message, delay],
      );
      if (exhausted) result.failed++;
      else result.retrying++;
      result.results.push({
        id: event.id,
        event_type: event.event_type,
        status: exhausted ? "failed" : "pending",
        error: message,
        ...(exhausted ? {} : { next_attempt_in_ms: delay }),
      });
    }
  }
  return result;
}

async function markSent(q: { query: Db["query"] }, id: string) {
  await q.query(
    `update wms.integration_events set status = 'sent', processed_at = now(), locked_at = null, last_error = null
      where id = $1 and status = 'sending'`,
    [id],
  );
}

export async function queueCounts(db: { query: Db["query"] }, companyId?: string | null) {
  const rows = await db.query<{ status: string; n: number }>(
    `select status, count(*)::int as n from wms.integration_events where ($1::uuid is null or company_id = $1::uuid) group by status`,
    [companyId ?? null],
  );
  const counts: Record<string, number> = { pending: 0, sending: 0, sent: 0, failed: 0, discarded: 0 };
  for (const r of rows) counts[r.status] = Number(r.n);
  return counts;
}
