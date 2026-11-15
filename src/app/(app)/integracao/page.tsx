import Link from "next/link";
import { Ban, Mail, Play, RotateCcw } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import {
  getEmailMessage,
  getOutboxEvent,
  listEmailMessages,
  listOutboxEvents,
  INTEGRATION_STATUSES,
  type EmailMessageRow,
  type IntegrationEventRow,
} from "@/server/services/integration";
import { emailTransportFromEnv } from "@/server/integrations/outbox/email";
import { transportFromEnv } from "@/server/integrations/outbox/transports";
import { OUTBOX_DEFAULTS } from "@/server/integrations/outbox/processor";
import { discardEventAction, processQueueAction, retryEventAction } from "@/server/actions/integration";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/states";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Field, Input, Select } from "@/components/ui/fields";
import { Pagination, TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { STATUS, statusLabel } from "@/lib/labels";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid, pageNumber, readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Integração" };

export default async function IntegrationPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  if (!can(ctx.user.role, "audit.view")) {
    return (
      <>
        <PageHeader title="Integração" breadcrumbs={[{ label: "Gestão" }, { label: "Integração" }]} />
        <Alert level="warning">Acesso restrito a administradores, supervisores e auditores.</Alert>
      </>
    );
  }
  const list = await listOutboxEvents(ctx, { status: params.status, type: params.type, q: params.q, page: pageNumber(params.page) });
  const selected = isUuid(params.id) ? await getOutboxEvent(ctx, params.id).catch(() => null) : null;
  const emails = await listEmailMessages(ctx);
  const email = isUuid(params.email) ? await getEmailMessage(ctx, params.email) : null;
  const emailTransport = emailTransportFromEnv();
  const config = transportFromEnv();
  const canProcess = can(ctx.user.role, "integration.process");
  const canManage = can(ctx.user.role, "integration.manage");

  return (
    <>
      <PageHeader
        title="Integração com o ERP"
        description="Outbox de eventos (gravados na mesma transação da operação) e seu envio ao ERP, com retentativa automática e backoff exponencial."
        breadcrumbs={[{ label: "Gestão" }, { label: "Integração" }]}
        actions={
          canProcess ? (
            <ActionForm action={processQueueAction}>
              <SubmitButton disabled={!config.ok}>
                <Play className="size-4" aria-hidden />
                Processar fila
              </SubmitButton>
            </ActionForm>
          ) : null
        }
      />
      <div className="space-y-5">
        {config.ok ? (
          <Alert level="info" title={`Transporte: ${config.description}`}>
            {config.transport.name === "local"
              ? "Os eventos são aplicados no schema erp deste banco. Para enviar a um ERP externo, defina ERP_WEBHOOK_URL e ERP_WEBHOOK_SECRET (ver README)."
              : "POST JSON assinado (HMAC-SHA256 no cabeçalho X-Orion-Signature); o id do evento vai em Idempotency-Key."}{" "}
            Até {OUTBOX_DEFAULTS.maxAttempts} tentativas por evento; depois, o evento fica como “Falhou” até ser reenviado. Para processar automaticamente,
            agende <code>POST /api/integracao/processar</code> com o token <code>CRON_SECRET</code>.
          </Alert>
        ) : (
          <Alert level="danger" title="Transporte de integração mal configurado">
            {config.error}
          </Alert>
        )}
        {(list.counts.failed ?? 0) > 0 ? (
          <Notice tone="crit" action={<Link href="/integracao?status=failed">Ver eventos</Link>}>
            {list.counts.failed} evento(s) não chegaram ao ATLAS depois de todas as tentativas. O armazém continua funcionando; reenvie quando o ERP voltar.
          </Notice>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {INTEGRATION_STATUSES.map((s) => (
            <Link
              key={s}
              href={`/integracao?status=${s}`}
              className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm hover:bg-canvas"
            >
              <StatusBadge kind="integration" status={s} />
              <span className="font-semibold tabular-nums">{list.counts[s] ?? 0}</span>
            </Link>
          ))}
        </div>

        {selected ? <EventDetail event={selected} canManage={canManage} /> : null}

        <EmailsCard rows={emails.rows} total={emails.total} params={params} selected={email} transportName={emailTransport.name} />

        <Card>
          <FilterBar resetHref="/integracao">
            <FilterField label="Status">
              <Select
                name="status"
                defaultValue={params.status}
                placeholder="Todos"
                options={INTEGRATION_STATUSES.map((s) => ({ value: s, label: STATUS.integration[s]?.label ?? s }))}
              />
            </FilterField>
            <FilterField label="Evento">
              <Select name="type" defaultValue={params.type} placeholder="Todos" options={list.types.map((t) => ({ value: t, label: t }))} />
            </FilterField>
            <FilterField label="Buscar" className="w-full sm:w-64">
              <Input name="q" defaultValue={params.q} placeholder="Código no payload, id ou erro" />
            </FilterField>
          </FilterBar>
          {list.rows.length ? (
            <TableWrap>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Criado em</th>
                    <th>Evento</th>
                    <th>Status</th>
                    <th className="num">Tentativas</th>
                    <th>Próxima tentativa / envio</th>
                    <th>Último erro</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap">{fmtDateTime(e.created_at)}</td>
                      <td>
                        <span className="font-mono text-xs">{e.event_type}</span>
                        <span className="block text-[11px] text-muted">{codeOf(e)}</span>
                      </td>
                      <td>
                        <StatusBadge kind="integration" status={e.status} />
                      </td>
                      <td className="num">{e.attempts}</td>
                      <td className="whitespace-nowrap text-xs">
                        {e.status === "sent" ? `Enviado ${fmtRelative(e.processed_at)}` : e.status === "pending" ? fmtDateTime(e.next_attempt_at) : "—"}
                      </td>
                      <td className="max-w-xs">
                        <span className="line-clamp-2 text-xs break-all text-crit-fg">{e.last_error ?? ""}</span>
                      </td>
                      <td className="text-right">
                        <Link href={`/integracao?${new URLSearchParams({ ...clean(params), id: e.id })}`} className="link text-xs">
                          Detalhes
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState title="Nenhum evento encontrado" />
          )}
          <Pagination page={list.page} pageSize={list.pageSize} total={list.total} params={params} />
        </Card>
      </div>
    </>
  );
}

const EMAIL_STATUS: Record<EmailMessageRow["status"], { label: string; tone: "success" | "info" | "danger" | "neutral" }> = {
  logged: { label: "Registrado (sem envio)", tone: "info" },
  sent: { label: "Enviado", tone: "success" },
  failed: { label: "Falhou", tone: "danger" },
  skipped: { label: "Sem destinatário", tone: "neutral" },
};

function EmailsCard({
  rows,
  total,
  params,
  selected,
  transportName,
}: {
  rows: EmailMessageRow[];
  total: number;
  params: Record<string, string | undefined>;
  selected: (EmailMessageRow & { html: string; text_body: string }) | null;
  transportName: "log" | "http";
}) {
  const base = Object.fromEntries(Object.entries(params).filter(([k, v]) => v && k !== "email")) as Record<string, string>;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Mail className="size-4" aria-hidden /> Avisos por e-mail
          </span>
        }
        description={
          transportName === "log"
            ? `Transporte de registro: os e-mails são gerados e guardados aqui, sem envio real (defina EMAIL_API_URL para enviar). ${total} no total.`
            : `Envio por API HTTP (EMAIL_API_URL). ${total} no total.`
        }
        actions={
          <Link href="/configuracoes" className="link text-xs">
            Destinatários
          </Link>
        }
      />
      {selected ? (
        <CardBody className="space-y-3 border-b border-line">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">{selected.subject}</p>
              <p className="text-xs text-fg-2">
                Para: {selected.to_addresses.length ? selected.to_addresses.join(", ") : "—"} · {fmtDateTime(selected.created_at)}
              </p>
            </div>
            <Link href={`/integracao?${new URLSearchParams(base)}`} className={buttonClass("ghost", "sm")}>
              Fechar
            </Link>
          </div>
          {selected.error ? <Alert level="danger" title="Erro no envio">{selected.error}</Alert> : null}
          <iframe
            title={`Pré-visualização: ${selected.subject}`}
            sandbox=""
            srcDoc={selected.html}
            className="h-[560px] w-full rounded-lg border border-line bg-white"
          />
        </CardBody>
      ) : null}
      {rows.length ? (
        <TableWrap>
          <table className="table-base">
            <thead>
              <tr>
                <th>Gerado em</th>
                <th>Assunto</th>
                <th>Destinatários</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} aria-selected={selected?.id === m.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(m.created_at)}</td>
                  <td className="max-w-sm">
                    <span className="line-clamp-2">{m.subject}</span>
                    <span className="block font-mono text-[11px] text-muted">{m.event_type}</span>
                  </td>
                  <td className="max-w-xs text-xs break-all">{m.to_addresses.length ? m.to_addresses.join(", ") : "—"}</td>
                  <td>
                    <Badge tone={EMAIL_STATUS[m.status].tone}>{EMAIL_STATUS[m.status].label}</Badge>
                  </td>
                  <td className="text-right">
                    <Link href={`/integracao?${new URLSearchParams({ ...base, email: m.id })}`} className="link text-xs">
                      Ver e-mail
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : (
        <EmptyState title="Nenhum e-mail gerado" description="Inventário aprovado, divergência registrada e recebimento agendado geram avisos ao processar a fila." />
      )}
    </Card>
  );
}

function clean(params: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).filter(([k, v]) => v && k !== "id" && k !== "email")) as Record<string, string>;
}

function codeOf(e: IntegrationEventRow): string {
  const code = e.payload?.code;
  return typeof code === "string" ? code : e.aggregate_type;
}

function EventDetail({ event: e, canManage }: { event: IntegrationEventRow; canManage: boolean }) {
  const canRetry = ["failed", "discarded", "pending"].includes(e.status);
  const canDiscard = ["pending", "failed"].includes(e.status);
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="font-mono">{e.event_type}</span> <StatusBadge kind="integration" status={e.status} />
          </span>
        }
        description={`Evento ${e.id}`}
        actions={
          <Link href="/integracao" className={buttonClass("ghost", "sm")}>
            Fechar
          </Link>
        }
      />
      <CardBody className="space-y-4">
        <DefinitionList
          items={[
            ["Agregado", `${e.aggregate_type} · ${e.aggregate_id}`],
            ["Criado em", fmtDateTime(e.created_at)],
            ["Tentativas", String(e.attempts)],
            ["Última tentativa", e.last_attempt_at ? fmtDateTime(e.last_attempt_at) : "—"],
            ["Próxima tentativa", e.status === "pending" ? fmtDateTime(e.next_attempt_at) : "—"],
            ["Enviado em", e.processed_at ? fmtDateTime(e.processed_at) : "—"],
            ["Transporte", e.transport ? <Badge key="t">{e.transport}</Badge> : "—"],
            ["Status", statusLabel("integration", e.status)],
          ]}
        />
        {e.last_error ? <Alert level="danger" title="Último erro">{e.last_error}</Alert> : null}
        {e.status === "discarded" ? (
          <Alert level="warning" title="Descartado">
            {e.discard_reason} — {e.discarded_by_name ?? "—"}, {fmtDateTime(e.discarded_at)}
          </Alert>
        ) : null}
        <div>
          <p className="label">Payload</p>
          <pre className="max-h-80 overflow-auto rounded-md bg-canvas p-3 text-xs text-fg-2">{JSON.stringify(e.payload, null, 2)}</pre>
        </div>
        {canManage && (canRetry || canDiscard) ? (
          <div className="flex flex-wrap items-end gap-4 border-t border-line pt-4">
            {canRetry ? (
              <ActionForm action={retryEventAction} confirm="Devolver este evento à fila com as tentativas zeradas?">
                <input type="hidden" name="_id" value={e.id} />
                <SubmitButton variant="secondary">
                  <RotateCcw className="size-4" aria-hidden />
                  Reenviar
                </SubmitButton>
              </ActionForm>
            ) : null}
            {canDiscard ? (
              <ActionForm action={discardEventAction} confirm="Descartar este evento? Ele não será mais enviado ao ERP." className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="_id" value={e.id} />
                <Field label="Motivo do descarte" htmlFor="discard-reason" className="w-full sm:w-80">
                  <Input id="discard-reason" name="reason" required minLength={5} maxLength={500} placeholder="Ex.: pedido cancelado no ERP" />
                </Field>
                <SubmitButton variant="danger">
                  <Ban className="size-4" aria-hidden />
                  Descartar
                </SubmitButton>
              </ActionForm>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
