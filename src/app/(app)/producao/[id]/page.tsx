import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getRequisition } from "@/server/services/production";
import { listLocations } from "@/server/services/warehouse";
import {
  cancelRequisitionAction,
  completeRequisitionAction,
  deliverToLineAction,
  receiveOutputAction,
  releaseRequisitionAction,
  reserveRequisitionAction,
  returnLeftoversAction,
} from "@/server/actions/comex";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { STATUS, TASK_TYPE_LABELS } from "@/lib/labels";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Requisição de produção" };

export default async function RequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const data = await getRequisition(ctx, id);
  if (!data) notFound();
  const { header: r, lines, reservations, tasks, deliveries, returns } = data;
  const role = ctx.user.role;
  const manage = can(role, "production.manage");
  const operate = can(role, "production.operate");
  const openPicks = tasks.filter((t) => t.task_type === "production_pick" && ["pending", "in_progress"].includes(t.status)).length;
  const toDeliver = reservations.filter((v) => v.status === "picked").length;
  const pendingReserve = lines.some((l) => l.required_qty - l.reserved_qty - l.picked_qty > 0);
  const unreleased = reservations.some((v) => v.status === "active" && !tasks.some((t) => t.status !== "cancelled" && t.task_type === "production_pick" && t.sku === v.sku && t.from_code === v.location_code && t.lot_code === v.lot_code));
  const returnable = lines.filter((l) => l.delivered_qty - l.returned_qty > 0);
  const deliveredLots = new Map<string, Set<string>>();
  for (const v of reservations.filter((x) => x.status === "delivered")) {
    if (!deliveredLots.has(v.line_id)) deliveredLots.set(v.line_id, new Set());
    deliveredLots.get(v.line_id)!.add(v.lot_code);
  }
  const returnOptions = returnable.flatMap((l) =>
    [...(deliveredLots.get(l.id) ?? [])].map((lot) => ({ value: `${l.id}|${lot}`, label: `${l.sku}${lot ? ` — lote ${lot}` : ""} (até ${fmtQty(l.delivered_qty - l.returned_qty)})` })),
  );
  const destinations =
    r.status === "delivered" && operate && returnOptions.length
      ? (await listLocations(ctx, { warehouseId: r.warehouse_id, status: "active", pageSize: 500 })).rows.filter((l) => ["storage", "picking"].includes(l.zone_type))
      : [];

  return (
    <>
      <PageHeader
        title={`Requisição ${r.code}`}
        description={`Ordem ${r.order_number} · ${r.sku} — ${r.description}`}
        breadcrumbs={[{ label: "Operações" }, { label: "Produção", href: "/producao" }, { label: r.code }]}
        actions={<StatusBadge kind="productionRequisition" status={r.status} />}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardBody>
              <DefinitionList
                items={[
                  ["Ordem de produção (ERP)", `${r.order_number} (${r.order_status})`],
                  ["Previsão", fmtDate(r.due_date)],
                  ["Linha", r.line_code],
                  ["Reserva", r.all_or_nothing ? "Tudo ou nada" : "Parcial permitida"],
                  ["Lote do produto acabado", r.output_lot_code],
                  ["Produto acabado recebido", `${fmtQty(r.output_qty)} de ${fmtQty(r.planned_output_qty)} ${r.uom}`],
                  ["Criada por", `${r.created_by_name} em ${fmtDateTime(r.created_at)}`],
                  ["Cancelamento", r.cancel_reason],
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Componentes" />
            <TableWrap>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Linha</th>
                    <th>Componente</th>
                    <th className="num">Requerido</th>
                    <th className="num">Reservado</th>
                    <th className="num">Separado</th>
                    <th className="num">Entregue</th>
                    <th className="num">Sobra devolvida</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.line_no}</td>
                      <td>
                        <span className="font-medium">{l.sku}</span>
                        <span className="block text-xs text-slate-500">{l.description}</span>
                      </td>
                      <td className="num">{fmtQty(l.required_qty)}</td>
                      <td className="num">{fmtQty(l.reserved_qty)}</td>
                      <td className="num">{fmtQty(l.picked_qty)}</td>
                      <td className="num">{fmtQty(l.delivered_qty)}</td>
                      <td className="num">{fmtQty(l.returned_qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>

          <Card>
            <CardHeader title={`Reservas (${reservations.length})`} description="FEFO: validade mais próxima primeiro, somente saldo disponível e não vencido." />
            {reservations.length ? (
              <TableWrap>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Componente</th>
                      <th>Endereço</th>
                      <th>Lote</th>
                      <th>Validade</th>
                      <th className="num">Reservado</th>
                      <th className="num">Separado</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reservations.map((v) => (
                      <tr key={v.id}>
                        <td>{v.sku}</td>
                        <td className="font-mono text-[11px]">{v.location_code}</td>
                        <td className="code">
                          {v.lot_code || "—"}
                          {v.origin_country ? <span className="block text-xs text-slate-500">origem {v.origin_country}</span> : null}
                        </td>
                        <td>{fmtDate(v.expiry_date)}</td>
                        <td className="num">{fmtQty(v.quantity)}</td>
                        <td className="num">{fmtQty(v.picked_qty)}</td>
                        <td>
                          <Badge tone={v.status === "delivered" ? "success" : v.status === "released" ? "neutral" : "info"}>{v.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState title="Sem reservas" />
            )}
          </Card>

          <Card>
            <CardHeader title={`Tarefas (${tasks.length})`} description="Separação para a linha e armazenagem do produto acabado." />
            {tasks.length ? (
              <TableWrap>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Tarefa</th>
                      <th>Tipo</th>
                      <th>Produto / lote</th>
                      <th>De → para</th>
                      <th className="num">Qtd.</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <Link href={`/tarefas/${t.id}`} className="link font-mono">
                            {t.code}
                          </Link>
                        </td>
                        <td>{TASK_TYPE_LABELS[t.task_type] ?? t.task_type}</td>
                        <td>
                          {t.sku} {t.lot_code ? <span className="text-xs text-slate-500">lote {t.lot_code}</span> : null}
                        </td>
                        <td className="font-mono text-[11px]">
                          {t.from_code ?? "—"} → {t.to_code ?? t.suggested_code ?? "—"}
                        </td>
                        <td className="num">{fmtQty(t.confirmed_qty ?? t.quantity)}</td>
                        <td>
                          <StatusBadge kind="task" status={t.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState title="Sem tarefas" />
            )}
          </Card>

          <Card>
            <CardHeader title={`Entregas à linha (${deliveries.length}) e sobras devolvidas (${returns.length})`} />
            <CardBody className="space-y-2 text-sm">
              {deliveries.map((d) => (
                <p key={d.id}>
                  <b className="font-mono">{d.code}</b> · {fmtDateTime(d.created_at)} · entregue por {d.delivered_by_name}, recebido por {d.received_by}:{" "}
                  {d.items.map((i) => `${i.sku}${i.lot_code ? ` (${i.lot_code})` : ""} ${fmtQty(i.quantity)}`).join("; ")}
                </p>
              ))}
              {returns.map((m) => (
                <p key={m.id}>
                  Sobra · {fmtDateTime(m.created_at)} · {m.sku}
                  {m.lot_code ? ` (${m.lot_code})` : ""} {fmtQty(m.quantity)} → <span className="font-mono text-[11px]">{m.to_code}</span> ({m.user_name})
                </p>
              ))}
              {deliveries.length + returns.length === 0 ? <p className="text-slate-500">Nenhuma entrega registrada.</p> : null}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Próximos passos" />
            <CardBody className="space-y-4">
              {manage && ["open", "reserved", "picking", "delivered"].includes(r.status) && pendingReserve ? (
                <ActionForm action={reserveRequisitionAction}>
                  <input type="hidden" name="_id" value={id} />
                  <SubmitButton>Reservar componentes (FEFO)</SubmitButton>
                </ActionForm>
              ) : null}
              {manage && ["reserved", "picking", "delivered"].includes(r.status) && unreleased ? (
                <ActionForm action={releaseRequisitionAction}>
                  <input type="hidden" name="_id" value={id} />
                  <SubmitButton>Gerar tarefas de separação</SubmitButton>
                </ActionForm>
              ) : null}
              {openPicks ? <Alert level="info">{openPicks} tarefa(s) de separação em aberto.</Alert> : null}
              {operate && toDeliver && !openPicks ? (
                <ActionForm action={deliverToLineAction} className="space-y-2" confirm="Confirmar a entrega do material separado à linha?">
                  <input type="hidden" name="_id" value={id} />
                  <Field label="Recebido na linha por" required>
                    <Input name="receivedBy" required minLength={2} />
                  </Field>
                  <Field label="Observação">
                    <Input name="notes" />
                  </Field>
                  <SubmitButton>Confirmar entrega à linha</SubmitButton>
                </ActionForm>
              ) : null}
              {operate && destinations.length ? (
                <ActionForm action={returnLeftoversAction} className="space-y-2" resetOnSuccess>
                  <input type="hidden" name="_id" value={id} />
                  <ReturnFields options={returnOptions} destinations={destinations.map((l) => ({ value: l.id, label: l.code }))} />
                  <SubmitButton variant="secondary">Devolver sobra ao estoque</SubmitButton>
                </ActionForm>
              ) : null}
              {operate && r.status === "delivered" && r.output_qty < r.planned_output_qty ? (
                <ActionForm action={receiveOutputAction} className="space-y-2">
                  <input type="hidden" name="_id" value={id} />
                  <Field label={`Produto acabado (lote ${r.output_lot_code})`} required>
                    <Input name="quantity" type="number" min={0} step="any" max={r.planned_output_qty - r.output_qty} required />
                  </Field>
                  <Field label="Validade">
                    <Input name="expiryDate" type="date" />
                  </Field>
                  <SubmitButton variant="secondary">Receber produto acabado</SubmitButton>
                </ActionForm>
              ) : null}
              {manage && r.status === "delivered" ? (
                <ActionForm action={completeRequisitionAction} confirm="Encerrar a requisição?">
                  <input type="hidden" name="_id" value={id} />
                  <SubmitButton variant="success">Encerrar requisição</SubmitButton>
                </ActionForm>
              ) : null}
              {manage && ["open", "reserved"].includes(r.status) ? (
                <ActionForm action={cancelRequisitionAction} confirm="Cancelar a requisição e liberar as reservas?" className="space-y-2">
                  <input type="hidden" name="_id" value={id} />
                  <Field label="Motivo do cancelamento" required>
                    <Input name="reason" required minLength={5} />
                  </Field>
                  <SubmitButton variant="danger" size="sm">
                    Cancelar requisição
                  </SubmitButton>
                </ActionForm>
              ) : null}
              {["completed", "cancelled"].includes(r.status) ? (
                <p className="text-sm text-slate-500">Requisição {STATUS.productionRequisition[r.status].label.toLowerCase()}.</p>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function ReturnFields({ options, destinations }: { options: { value: string; label: string }[]; destinations: { value: string; label: string }[] }) {
  return (
    <>
      <Field label="Componente / lote" required>
        <Select name="lineLot" required options={options} />
      </Field>
      <Field label="Quantidade" required>
        <Input name="quantity" type="number" min={0} step="any" required />
      </Field>
      <Field label="Endereço de destino" required>
        <Select name="locationId" required options={destinations} />
      </Field>
    </>
  );
}
