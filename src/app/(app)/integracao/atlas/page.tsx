import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { atlasReconciliation, getAtlasPanel, listAtlasInbox } from "@/server/services/atlas-sync";
import { reprocessAtlasEventAction } from "@/server/actions/integration";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { ATLAS_INBOX_STATUS_LABELS, ATLAS_LINK_STATUS_LABELS } from "@/lib/labels";
import { fmtDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Integração ATLAS" };

const INBOX_FILTERS = ["applied", "failed", "ignored"] as const;

export default async function AtlasIntegrationPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  const crumbs = [{ label: "Gestão" }, { label: "Integração", href: "/integracao" }, { label: "ATLAS" }];
  if (!can(ctx.user.role, "integration.process")) {
    return (
      <>
        <PageHeader title="Integração ATLAS" breadcrumbs={crumbs} />
        <Alert level="warning">Acesso restrito a administradores e supervisores.</Alert>
      </>
    );
  }
  const status = INBOX_FILTERS.includes(params.status as (typeof INBOX_FILTERS)[number]) ? params.status : null;
  const [panel, inbox, recon] = await Promise.all([getAtlasPanel(ctx), listAtlasInbox(ctx, { status }), atlasReconciliation(ctx)]);
  const canManage = can(ctx.user.role, "integration.manage");
  const link = panel.link;
  const st = link ? (ATLAS_LINK_STATUS_LABELS[link.status] ?? { label: link.status, tone: "neutral" as const }) : null;

  return (
    <>
      <PageHeader
        title="Integração com o ATLAS.ERP"
        description="Vínculo da empresa, eventos recebidos do ATLAS (cadastros, pedidos, carga inicial) e reconciliação de estoque."
        breadcrumbs={crumbs}
      />
      <div className="space-y-5">
        <div className="flex gap-2 text-sm">
          <Link href="/integracao" className="rounded-md border border-line px-3 py-1.5 hover:bg-canvas">
            Outbox (ORION → ERP)
          </Link>
          <span className="rounded-md border border-line bg-canvas px-3 py-1.5 font-semibold">ATLAS</span>
        </div>
        {!link ? (
          <Alert level="info" title="Empresa não vinculada ao ATLAS">
            O vínculo é feito pelo ATLAS (Integrações → ORION → “Vincular ao ORION”), que chama <code>POST /api/atlas/v1/links</code> com a credencial de
            instalação. Enquanto não houver vínculo, o ORION funciona com cadastros e login locais.
          </Alert>
        ) : (
          <Card>
            <CardHeader title="Vínculo" actions={st ? <Badge tone={st.tone}>{st.label}</Badge> : null} />
            <CardBody>
              <DefinitionList
                items={[
                  ["Empresa no ATLAS", <code key="a">{link.atlas_company_id}</code>],
                  ["Chave (key_id)", <code key="k">{link.key_id}</code>],
                  ["Dono do estoque", link.stock_owner === "orion" ? "ORION (físico)" : "ATLAS"],
                  ["NF-e antes de expedir", link.require_invoice_before_ship ? "Sim" : "Não"],
                  ["Vinculado em", fmtDateTime(link.linked_at)],
                  ["Ativado em", link.activated_at ? fmtDateTime(link.activated_at) : "—"],
                  ["Último evento recebido", link.last_inbound_at ? fmtDateTime(link.last_inbound_at) : "—"],
                  ["Último envio ao ATLAS", link.last_outbound_at ? fmtDateTime(link.last_outbound_at) : "—"],
                  ["Segredo anterior aceito até", link.previous_valid_until ? fmtDateTime(link.previous_valid_until) : "—"],
                  ["Usuários do ATLAS", `${panel.users.active} ativo(s) de ${panel.users.total}`],
                  ["Login pelo ATLAS (SSO)", panel.sso ? "Configurado" : "Não configurado (ATLAS_URL/ATLAS_JWKS_URL)"],
                  ["Depósitos mapeados", panel.warehouses.map((w) => `${w.atlas_code ?? w.atlas_warehouse_id} → ${w.code}`).join(", ") || "—"],
                ]}
              />
              {link.status_reason ? <p className="mt-3 text-sm text-muted">Motivo: {link.status_reason}</p> : null}
            </CardBody>
          </Card>
        )}

        <div className="flex flex-wrap gap-2">
          {Object.entries(ATLAS_INBOX_STATUS_LABELS).map(([s, l]) => (
            <Link key={s} href={`/integracao/atlas?status=${s}`} className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm hover:bg-canvas">
              <Badge tone={l.tone}>{l.label}</Badge>
              <span className="font-semibold tabular-nums">{panel.counts[s] ?? 0}</span>
            </Link>
          ))}
        </div>

        <Card>
          <CardHeader title="Eventos recebidos do ATLAS" description="Idempotentes pelo id do evento e ordenados por agregado (aggregate.sequence)." />
          {inbox.length ? (
            <TableWrap>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Recebido em</th>
                    <th>Evento</th>
                    <th>Agregado</th>
                    <th className="num">Seq.</th>
                    <th>Status</th>
                    <th className="num">Tentativas</th>
                    <th>Erro</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {inbox.map((e) => {
                    const l = ATLAS_INBOX_STATUS_LABELS[e.status] ?? { label: e.status, tone: "neutral" as const };
                    return (
                      <tr key={e.event_id}>
                        <td>{fmtDateTime(e.received_at)}</td>
                        <td>
                          <code>{e.event_type}</code>
                        </td>
                        <td className="text-xs">
                          {e.aggregate_type} <code>{e.aggregate_id.slice(0, 8)}</code>
                        </td>
                        <td className="num">{e.aggregate_seq}</td>
                        <td>
                          <Badge tone={l.tone}>{l.label}</Badge>
                        </td>
                        <td className="num">{e.attempts}</td>
                        <td className="max-w-xs text-xs break-words">{e.error_code ? `${e.error_code}: ${e.last_error ?? ""}` : "—"}</td>
                        <td>
                          {canManage && e.status === "failed" ? (
                            <ActionForm action={reprocessAtlasEventAction}>
                              <input type="hidden" name="_id" value={e.event_id} />
                              <SubmitButton variant="secondary" size="sm">
                                <RotateCcw className="size-4" aria-hidden />
                                Reprocessar
                              </SubmitButton>
                            </ActionForm>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <CardBody>
              <EmptyState title="Nenhum evento recebido" description="Os eventos aparecem aqui assim que o ATLAS enviar cadastros e documentos." />
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Reconciliação de estoque" description="Carga inicial recebida do ATLAS × saldo físico atual, e snapshots enviados ao ATLAS (diário 02:00 e carga inicial)." />
          {recon.inbound.length ? (
            <TableWrap>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Depósito</th>
                    <th>SKU</th>
                    <th>Lote</th>
                    <th className="num">Carga ATLAS</th>
                    <th className="num">Saldo ORION</th>
                    <th className="num">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {recon.inbound.map((r, i) => (
                    <tr key={i}>
                      <td>{r.warehouse}</td>
                      <td>{r.sku}</td>
                      <td>{r.lot_code ?? "—"}</td>
                      <td className="num">{r.atlas_qty}</td>
                      <td className="num">{r.orion_qty}</td>
                      <td className="num">{Math.round((r.orion_qty - r.atlas_qty) * 1000) / 1000}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <CardBody>
              <p className="text-sm text-muted">Nenhuma carga inicial recebida.</p>
            </CardBody>
          )}
          <CardBody>
            <h3 className="mb-2 text-xs font-semibold text-muted">Snapshots enviados ao ATLAS</h3>
            {recon.outbound.length ? (
              <ul className="space-y-1 text-sm">
                {recon.outbound.map((s) => (
                  <li key={s.snapshot_id}>
                    {fmtDateTime(s.created_at)} · {s.reason === "initial_load" ? "Carga inicial" : s.reason === "daily_reconciliation" ? "Diário" : s.reason} ·{" "}
                    {s.items} item(ns) em {s.chunks} lote(s)
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nenhum snapshot enviado.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
