import "server-only";
import type { Queryable } from "../../db/types";
import { getSetting } from "../../services/settings";
import {
  divergenciaEmail,
  inventarioConcluidoEmail,
  recebimentoAgendadoEmail,
  type EmailMessage,
} from "../../emails/templates";
import type { OutboxEvent } from "./transports";

/**
 * CANAL DE E-MAIL da outbox.
 *
 * Eventos com aviso por e-mail (ver EMAIL_TEMPLATES) são renderizados com os
 * templates de `src/server/emails/templates.ts` para os destinatários do
 * parâmetro da empresa `notifications.email_recipients` e entregues por um
 * transporte de e-mail plugável. Cada evento gera no máximo um registro em
 * wms.email_messages (único por event_id), visível na tela de Integração.
 *
 * Transportes:
 *  - `log` (padrão): NÃO envia nada; apenas registra o e-mail renderizado.
 *  - `http`: com EMAIL_API_URL definida, faz POST JSON
 *    `{ from, to, subject, html, text }` para a URL (Authorization: Bearer
 *    EMAIL_API_TOKEN, se houver; Idempotency-Key = id do evento). Serve para
 *    provedores de API transacional ou um relay próprio.
 *  - SMTP: não incluído (exigiria dependência nova). Para usar, implemente
 *    `EmailTransport` (ex.: com nodemailer) e devolva-o em
 *    `emailTransportFromEnv` quando SMTP_URL estiver definida.
 *
 * Falha no envio de e-mail não faz o evento voltar para a fila (o efeito
 * principal, a integração com o ERP, já foi aplicado): o registro fica com
 * status "falhou" e a mensagem do erro.
 */

export type EmailTemplate = "inventario_concluido" | "divergencia" | "recebimento_agendado";

export interface EmailTransport {
  readonly name: "log" | "http";
  send(message: EmailMessage & { to: string[]; idempotencyKey: string }): Promise<void>;
}

export const logEmailTransport: EmailTransport = {
  name: "log",
  async send() {
    // Transporte de registro: o e-mail fica apenas gravado em wms.email_messages.
  },
};

export function httpEmailTransport(options: { url: string; token?: string; from: string; timeoutMs?: number; fetchImpl?: typeof fetch }): EmailTransport {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return {
    name: "http",
    async send(m) {
      let response: Response;
      try {
        response = await doFetch(options.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "orion-wms-email",
            "idempotency-key": m.idempotencyKey,
            ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
          },
          body: JSON.stringify({ from: options.from, to: m.to, subject: m.subject, html: m.html, text: m.text }),
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "error",
        });
      } catch (error) {
        const e = error as Error;
        throw new Error(e?.name === "TimeoutError" ? `Tempo esgotado após ${timeoutMs} ms.` : `Falha de rede: ${e?.message ?? String(error)}`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    },
  };
}

/** Transporte de e-mail pelo ambiente: `http` com EMAIL_API_URL; senão `log` (nenhum envio real). */
export function emailTransportFromEnv(env: Record<string, string | undefined> = process.env): EmailTransport {
  const url = env.EMAIL_API_URL?.trim();
  if (!url) return logEmailTransport;
  return httpEmailTransport({ url, token: env.EMAIL_API_TOKEN?.trim() || undefined, from: env.EMAIL_FROM?.trim() || "ORION WMS <nao-responda@orion.local>" });
}

const str = (v: unknown, fallback = "—") => (typeof v === "string" && v ? v : fallback);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const link = (path: string, env: Record<string, string | undefined> = process.env) => `${(env.APP_URL ?? "").replace(/\/$/, "")}${path}`;

/** Renderiza o e-mail de um evento, ou null se o evento não tem aviso por e-mail. */
export function renderEventEmail(event: Pick<OutboxEvent, "event_type" | "aggregate_id" | "payload">): { template: EmailTemplate; message: EmailMessage } | null {
  const p = event.payload ?? {};
  switch (event.event_type) {
    case "inventory.approved":
      return {
        template: "inventario_concluido",
        message: inventarioConcluidoEmail({
          codigo: str(p.code),
          deposito: str(p.warehouse),
          fechadoEm: new Date(str(p.approved_at, new Date().toISOString())),
          acuracidade: num(p.accuracy),
          enderecos: num(p.locations),
          ajustes: num(p.adjustments),
          url: link(`/inventario/${event.aggregate_id}`),
        }),
      };
    case "divergence.registered":
      return {
        template: "divergencia",
        message: divergenciaEmail({
          endereco: str(p.location),
          produto: typeof p.product === "string" ? p.product : undefined,
          esperado: num(p.expected),
          contado: num(p.counted),
          unidade: typeof p.uom === "string" ? p.uom : undefined,
          valorUnitario: p.unit_price != null && Number.isFinite(Number(p.unit_price)) ? Number(p.unit_price) : undefined,
          recontagemCriada: p.recount === true,
          url: link(`/divergencias`),
        }),
      };
    case "dock.appointment_created":
      if (p.direction !== "inbound") return null; // o template é de recebimento
      return {
        template: "recebimento_agendado",
        message: recebimentoAgendadoEmail({
          pedido: str(p.reference),
          doca: str(p.dock),
          inicio: new Date(str(p.starts_at)),
          fim: new Date(str(p.ends_at)),
          fornecedor: typeof p.supplier === "string" ? p.supplier : undefined,
          volumes: typeof p.volumes === "string" ? p.volumes : undefined,
          url: link(`/docas`),
        }),
      };
    default:
      return null;
  }
}

/**
 * Gera (e entrega pelo transporte) o e-mail do evento, se houver. Idempotente:
 * se o evento já tem e-mail registrado, não faz nada.
 */
export async function deliverEventEmail(q: Queryable, event: OutboxEvent, transport: EmailTransport): Promise<"none" | "exists" | "logged" | "sent" | "failed" | "skipped"> {
  const rendered = renderEventEmail(event);
  if (!rendered) return "none";
  const [exists] = await q.query(`select 1 from wms.email_messages where event_id = $1`, [event.id]);
  if (exists) return "exists";
  const to = await getSetting(q, event.company_id, "notifications.email_recipients");
  let status: "logged" | "sent" | "failed" | "skipped" = transport.name === "log" ? "logged" : "sent";
  let error: string | null = null;
  if (!to.length) status = "skipped";
  else {
    try {
      await transport.send({ ...rendered.message, to, idempotencyKey: event.id });
    } catch (e) {
      status = "failed";
      error = ((e as Error)?.message ?? String(e)).slice(0, 1000);
    }
  }
  await q.query(
    `insert into wms.email_messages (company_id, event_id, template, to_addresses, subject, html, text_body, status, transport, error, sent_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, case when $8 in ('logged', 'sent') then now() end)
     on conflict (event_id) do nothing`,
    [event.company_id, event.id, rendered.template, to, rendered.message.subject, rendered.message.html, rendered.message.text, status, transport.name, error],
  );
  return status;
}
