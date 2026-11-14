import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getReturn } from "@/server/services/returns";
import { entityHistory } from "@/server/services/audit";
import { cancelReturnAction, inspectReturnItemAction } from "@/server/actions/inbound";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { DemoBadge, StatusBadge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { HistoryList } from "@/components/wms/history";
import { RETURN_REASON_LABELS } from "@/lib/labels";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Devolução" };

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const r = await getReturn(ctx, id);
  if (!r) notFound();
  const history = await entityHistory(ctx, "customer_return", id);
  const role = ctx.user.role;
  const canInspect = r.status === "pending" && can(role, "return.inspect");

  return (
    <>
      <PageHeader
        title={`Devolução ${r.code}`}
        badges={
          <>
            <StatusBadge kind="customerReturn" status={r.status} />
            {r.is_demo ? <DemoBadge /> : null}
          </>
        }
        description={`${r.customer_name} · Pedido ${r.order_code}`}
        breadcrumbs={[{ label: "Entrada" }, { label: "Devoluções", href: "/devolucoes" }, { label: r.code }]}
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardBody>
              <DefinitionList
                items={[
                  ["Pedido de saída", <Link key="o" className="link" href={`/separacao/${r.order_id}`}>{r.order_code}</Link>],
                  ["Depósito", r.warehouse_code],
                  ["Motivo", RETURN_REASON_LABELS[r.reason] ?? r.reason],
                  ["Detalhes", r.reason_notes],
                  ["Registrada por", `${r.created_by_name} · ${fmtDateTime(r.created_at)}`],
                  ["Concluída", fmtDateTime(r.completed_at)],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Itens e inspeção"
              description="Apto + avariado + descarte deve somar a quantidade devolvida. Apto gera tarefa de armazenagem; avariado entra bloqueado na quarentena; descarte é baixado com movimento próprio."
            />
            <TableWrap>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Lote / validade</th>
                    <th className="num">Devolvido</th>
                    <th className="min-w-[420px]">Inspeção</th>
                  </tr>
                </thead>
                <tbody>
                  {r.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <span className="font-medium">{i.sku}</span>
                        <span className="block text-xs text-slate-500">{i.description}</span>
                      </td>
                      <td className="text-xs">
                        {i.lot_code || "—"} / {fmtDate(i.expiry_date)}
                      </td>
                      <td className="num">
                        {fmtQty(i.quantity)} {i.uom}
                      </td>
                      <td>
                        {i.inspected ? (
                          <span className="text-xs">
                            Apto {fmtQty(i.approved_qty)} · avariado {fmtQty(i.damaged_qty)} · descarte {fmtQty(i.discarded_qty)}
                            <span className="block text-slate-500">
                              {i.inspected_by_name} · {fmtDateTime(i.inspected_at)}
                              {i.inspection_notes ? ` · ${i.inspection_notes}` : ""}
                            </span>
                          </span>
                        ) : canInspect ? (
                          <ActionForm action={inspectReturnItemAction} className="grid grid-cols-4 items-end gap-2">
                            <input type="hidden" name="_id" value={i.id} />
                            <Field label="Apto">
                              <Input name="approvedQty" type="number" min={0} step="any" defaultValue={i.quantity} />
                            </Field>
                            <Field label="Avariado">
                              <Input name="damagedQty" type="number" min={0} step="any" />
                            </Field>
                            <Field label="Descarte">
                              <Input name="discardedQty" type="number" min={0} step="any" />
                            </Field>
                            <SubmitButton size="sm">Inspecionar</SubmitButton>
                            <Input name="notes" placeholder="Observação da inspeção" className="col-span-4" aria-label="Observação" />
                          </ActionForm>
                        ) : (
                          <span className="text-xs text-slate-500">{r.status === "pending" ? "Aguardando inspeção (supervisor)" : "—"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
          {r.tasks.length ? (
            <Card>
              <CardHeader title="Tarefas de armazenagem" />
              <ul className="divide-y divide-slate-100 text-sm">
                {r.tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between px-4 py-2">
                    <Link className="link" href={`/tarefas/${t.id}`}>
                      {t.code}
                    </Link>
                    <span className="text-xs">
                      {t.sku} · {fmtQty(t.quantity)}
                    </span>
                    <StatusBadge kind="task" status={t.status} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Histórico" />
            <HistoryList rows={history} />
          </Card>
          {r.status === "pending" && can(role, "return.create") && !r.items.some((i) => i.inspected) ? (
            <Card>
              <CardHeader title="Cancelar devolução" description="Permitido antes de qualquer inspeção." />
              <CardBody>
                <ActionForm action={cancelReturnAction} confirm="Cancelar esta devolução?" className="space-y-3">
                  <input type="hidden" name="_id" value={id} />
                  <Field label="Motivo" required>
                    <Input name="reason" required minLength={5} />
                  </Field>
                  <SubmitButton variant="danger" size="sm">
                    Cancelar devolução
                  </SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
