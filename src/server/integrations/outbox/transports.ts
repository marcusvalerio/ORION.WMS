import "server-only";
import { createHmac } from "node:crypto";
import type { Queryable } from "../../db/types";
import * as erp from "../erp/gateway";

/** Evento da outbox entregue a um transporte. */
export interface OutboxEvent {
  id: string;
  company_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  created_at: string;
  /** aggregate.sequence do envelope (contrato ATLAS 3.3). */
  aggregate_seq?: number | null;
}

/**
 * Transporte plugável. `send` deve lançar erro em caso de falha; o processador
 * cuida de retentativa, backoff e status. Transportes `inTransaction` recebem a
 * transação em que o evento será marcado como enviado (entrega atômica).
 */
export interface Transport {
  readonly name: "local" | "http";
  send(event: OutboxEvent, tx: Queryable): Promise<void>;
}

/**
 * Transporte LOCAL: aplica o evento no schema `erp` do mesmo banco (fronteira de
 * integração local — comportamento original do MVP). A aplicação é idempotente:
 * reprocessar o mesmo evento chega ao mesmo estado.
 */
export const localTransport: Transport = {
  name: "local",
  async send(event, tx) {
    switch (event.event_type) {
      case "receipt.completed": {
        const [r] = await tx.query<{ purchase_order_id: string | null; short: boolean }>(
          `select r.purchase_order_id,
                  exists (select 1 from wms.receipt_items i where i.receipt_id = r.id
                          and coalesce(i.counted_qty, 0) - i.damaged_qty < i.expected_qty) as short
           from wms.receipts r where r.id = $1`,
          [event.aggregate_id],
        );
        if (!r) throw new Error(`Recebimento ${event.aggregate_id} não encontrado.`);
        if (r.purchase_order_id) await erp.setPurchaseOrderStatus(tx, r.purchase_order_id, r.short ? "partially_received" : "received");
        return;
      }
      case "outbound.shipped": {
        const [o] = await tx.query<{ sales_order_id: string | null }>(`select sales_order_id from wms.outbound_orders where id = $1`, [
          event.aggregate_id,
        ]);
        if (!o) throw new Error(`Pedido de saída ${event.aggregate_id} não encontrado.`);
        if (o.sales_order_id) await erp.setSalesOrderStatus(tx, o.sales_order_id, "shipped");
        return;
      }
      default:
        // Evento sem efeito no ERP local: considerado entregue.
        return;
    }
  },
};

export interface HttpTransportOptions {
  url: string;
  secret: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export const SIGNATURE_HEADER = "x-orion-signature";
export const TIMESTAMP_HEADER = "x-orion-timestamp";

/** Assinatura: HMAC-SHA256 (hex) de `${timestamp}.${corpo}` com ERP_WEBHOOK_SECRET. */
export function signBody(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Transporte HTTP: POST JSON para ERP_WEBHOOK_URL, assinado com HMAC-SHA256.
 * Cabeçalhos: `X-Orion-Event-Id` e `Idempotency-Key` (= id do evento; o ERP deve
 * ignorar ids já recebidos), `X-Orion-Timestamp` e `X-Orion-Signature: sha256=<hex>`.
 * Qualquer resposta fora de 2xx, erro de rede ou timeout conta como falha.
 */
export function httpTransport(options: HttpTransportOptions): Transport {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return {
    name: "http",
    async send(event) {
      const body = JSON.stringify({
        id: event.id,
        type: event.event_type,
        aggregate: { type: event.aggregate_type, id: event.aggregate_id },
        company_id: event.company_id,
        created_at: event.created_at,
        attempt: event.attempts,
        payload: event.payload,
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      let response: Response;
      try {
        response = await doFetch(options.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "orion-wms-outbox",
            "x-orion-event-id": event.id,
            "idempotency-key": event.id,
            [TIMESTAMP_HEADER]: timestamp,
            [SIGNATURE_HEADER]: `sha256=${signBody(options.secret, timestamp, body)}`,
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "error",
        });
      } catch (error) {
        const e = error as Error;
        if (e?.name === "TimeoutError") throw new Error(`Tempo esgotado após ${timeoutMs} ms.`);
        throw new Error(`Falha de rede: ${e?.message ?? String(error)}`);
      }
      if (!response.ok) {
        const text = (await response.text().catch(() => "")).slice(0, 300);
        throw new Error(`HTTP ${response.status}${text ? `: ${text}` : ""}`);
      }
    },
  };
}

/** Erro de entrega que não deve ser repetido automaticamente. */
export class NonRetryableError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

/**
 * Transporte ATLAS (contrato 3.2/3.6): para empresas vinculadas
 * (wms.atlas_links), POST do envelope do contrato em
 * `${ATLAS_API_URL}/api/integrations/orion/v1/events`, assinado com o HMAC DA
 * EMPRESA (X-Astraeus-Key-Id/Timestamp/Signature) e Idempotency-Key = id do
 * evento. 2xx = entregue; 4xx com `retryable:false` = falha definitiva; demais
 * erros voltam para a fila com backoff. Empresas sem vínculo seguem pelo
 * transporte `fallback` (local ou webhook legado ERP_WEBHOOK_URL).
 */
export function atlasTransport(options: { apiUrl: string; fallback: Transport; timeoutMs?: number; fetchImpl?: typeof fetch }): Transport {
  return {
    name: "http",
    async send(event, q) {
      const [link] = await q.query<{ atlas_company_id: string; key_id: string; secret_ciphertext: string; status: string }>(
        `select atlas_company_id, key_id, secret_ciphertext, status from wms.atlas_links where company_id = $1`,
        [event.company_id],
      );
      if (!link || link.status === "disabled") return options.fallback.send(event, q);
      const { buildOutboundEnvelope } = await import("../atlas/contract");
      const { decryptSecret } = await import("../atlas/crypto");
      const { atlasRequest } = await import("../atlas/client");
      const body = JSON.stringify(
        buildOutboundEnvelope({
          id: event.id,
          event_type: event.event_type,
          aggregate_type: event.aggregate_type,
          aggregate_id: event.aggregate_id,
          aggregate_seq: event.aggregate_seq ?? null,
          company_id: event.company_id,
          created_at: event.created_at,
          attempts: event.attempts,
          payload: event.payload,
          atlas_company_id: link.atlas_company_id,
        }),
      );
      let r: { status: number; text: string };
      try {
        r = await atlasRequest(
          { keyId: link.key_id, secret: decryptSecret(link.secret_ciphertext) },
          { apiUrl: options.apiUrl, fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs },
          "POST",
          "api/integrations/orion/v1/events",
          body,
          { "Idempotency-Key": event.id, "X-Orion-Event-Id": event.id },
        );
      } catch (error) {
        throw new Error((error as Error).message);
      }
      if (r.status >= 200 && r.status < 300) {
        await q.query(`update wms.atlas_links set last_outbound_at = now() where company_id = $1`, [event.company_id]);
        return;
      }
      let retryable = r.status >= 500 || r.status === 429 || r.status === 408;
      let detail = r.text.slice(0, 300);
      try {
        const err = (JSON.parse(r.text) as { error?: { code?: string; message?: string; retryable?: boolean } }).error;
        if (err) {
          if (typeof err.retryable === "boolean") retryable = err.retryable;
          detail = `${err.code ?? ""}: ${err.message ?? ""}`;
        }
      } catch {
        // corpo não-JSON: mantém o texto
      }
      const message = `ATLAS HTTP ${r.status}${detail ? ` — ${detail}` : ""}`;
      throw retryable ? new Error(message) : new NonRetryableError(message);
    },
  };
}

export type TransportConfig =
  | { ok: true; transport: Transport; description: string }
  | { ok: false; error: string; name: "http" };

/**
 * Transporte configurado pelo ambiente:
 * - `ERP_OUTBOX_TRANSPORT=local|http` escolhe explicitamente;
 * - sem a variável, usa `http` quando ERP_WEBHOOK_URL existe, senão `local`.
 */
export function transportFromEnv(env: Record<string, string | undefined> = process.env): TransportConfig {
  const legacy = legacyTransportFromEnv(env);
  const atlasUrl = (env.ATLAS_API_URL ?? env.ATLAS_URL)?.trim().replace(/\/+$/, "");
  if (!atlasUrl || !legacy.ok) return legacy;
  let host = atlasUrl;
  try {
    host = new URL(atlasUrl).host;
  } catch {
    return { ok: false, name: "http", error: "ATLAS_API_URL/ATLAS_URL inválida." };
  }
  const timeoutMs = Number(env.ERP_WEBHOOK_TIMEOUT_MS) > 0 ? Number(env.ERP_WEBHOOK_TIMEOUT_MS) : 10_000;
  return {
    ok: true,
    transport: atlasTransport({ apiUrl: atlasUrl, fallback: legacy.transport, timeoutMs }),
    description: `ATLAS (${host}) para empresas vinculadas; demais: ${legacy.description}`,
  };
}

function legacyTransportFromEnv(env: Record<string, string | undefined>): TransportConfig {
  const url = env.ERP_WEBHOOK_URL?.trim();
  const choice = env.ERP_OUTBOX_TRANSPORT?.trim() || (url ? "http" : "local");
  if (choice !== "http") return { ok: true, transport: localTransport, description: "Local (schema erp deste banco)" };
  if (!url) return { ok: false, name: "http", error: "ERP_WEBHOOK_URL não definida para o transporte http." };
  const secret = env.ERP_WEBHOOK_SECRET?.trim();
  if (!secret || secret.length < 16) return { ok: false, name: "http", error: "ERP_WEBHOOK_SECRET ausente ou curto (mínimo 16 caracteres)." };
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    return { ok: false, name: "http", error: "ERP_WEBHOOK_URL inválida." };
  }
  const timeoutMs = Number(env.ERP_WEBHOOK_TIMEOUT_MS) > 0 ? Number(env.ERP_WEBHOOK_TIMEOUT_MS) : 10_000;
  return { ok: true, transport: httpTransport({ url, secret, timeoutMs }), description: `HTTP (${host})` };
}
