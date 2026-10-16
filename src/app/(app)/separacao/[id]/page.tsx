import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getOrder, type OutboundStatus } from "@/server/services/outbound";
import { listTasks } from "@/server/services/tasks";
import { listDivergences } from "@/server/services/divergences";
import { entityHistory } from "@/server/services/audit";
import { cancelOrderAction, checkOrderAction, releasePickingAction, reserveOrderAction, shipOrderAction } from "@/server/actions/outbound";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { DemoBadge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { Stepper } from "@/components/ui/stepper";
import { Field, Input } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { TaskTable } from "@/components/wms/task-table";
import { HistoryList } from "@/components/wms/history";
import { DivergenceList } from "@/components/wms/divergence-list";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Pedido de saída" };

const STEP: Record<OutboundStatus, number> = { open: 0, reserved: 1, picking: 2, picked: 3, checked: 4, shipped: 6, cancelled: 0 };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const o = await getOrder(ctx, id);
  if (!o) notFound();
  const [tasks, divergences, history] = await Promise.all([
    listTasks(ctx, { q: o.code, type: "picking", pageSize: 100, sort: "code" }),
    listDivergences(ctx, { orderId: id }),
    entityHistory(ctx, "outbound_order", id),
  ]);
  const role = ctx.user.role;
  const pickTasks = tasks.rows.filter((t) => t.order_id === id);
  const shortage = o.lines.filter((l) => l.available_now < l.requested_qty);

  return (
    <>
      <PageHeader
        title={`Pedido ${o.code}`}
        badges={
          <>
            <StatusBadge kind="outbound" status={o.status} />
            <PriorityBadge priority={o.priority} />
            {o.is_demo ? <DemoBadge /> : null}
          </>
        }
        description={`${o.customer_name} · ${o.source === "erp" ? `Pedido ERP ${o.so_number}` : "Pedido manual"}`}
        breadcrumbs={[{ label: "Operações" }, { label: "Separação", href: "/separacao" }, { label: o.code }]}
      />
      <Card className="mb-5">
        <CardBody className="space-y-4">
          <Stepper steps={["Aberto", "Reservado", "Em separação", "Separado", "Conferido", "Expedido"]} current={STEP[o.status]} cancelled={o.status === "cancelled"} />
          <DefinitionList
            items={[
              ["Depósito", `${o.warehouse_code} — ${o.warehouse_name}`],
              ["Doca de expedição", o.staging_code ? <span className="font-mono text-xs">{o.staging_code}</span> : "Definida ao liberar a separação"],
              ["Criado por", `${o.created_by_name} · ${fmtDateTime(o.created_at)}`],
              ["Reservado em", fmtDateTime(o.reserved_at)],
              ["Separado em", fmtDateTime(o.picked_at)],
              ["Conferido em", fmtDateTime(o.checked_at)],
              ["Expedido em", fmtDateTime(o.shipped_at)],
              ["Observações", o.notes],
            ]}
          />
        </CardBody>
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Itens do pedido" description="Disponível agora = saldo livre em endereços ativos de armazenagem/picking, não vencido." />
            <TableWrap>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="num">Solicitado</th>
                    {o.status === "open" ? <th className="num">Disponível agora</th> : null}
                    <th className="num">Reservado</th>
                    <th className="num">Separado</th>
                    <th className="num">Conferido</th>
                    <th className="num">Expedido</th>
                  </tr>
                </thead>
                <tbody>
                  {o.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <span className="font-medium">{l.sku}</span>
                        <span className="block text-xs text-slate-500">{l.description}</span>
                      </td>
                      <td className="num">
                        {fmtQty(l.requested_qty)} {l.uom}
                      </td>
                      {o.status === "open" ? (
                        <td className={cn("num", l.available_now < l.requested_qty ? "font-semibold text-red-600" : "text-emerald-700")}>{fmtQty(l.available_now)}</td>
                      ) : null}
                      <td className="num">{fmtQty(l.reserved_qty)}</td>
                      <td className="num">{fmtQty(l.picked_qty)}</td>
                      <td className="num">{fmtQty(l.checked_qty)}</td>
                      <td className="num font-medium">{fmtQty(l.shipped_qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>

            {o.status === "open" && can(role, "outbound.reserve") ? (
              <CardBody className="space-y-3 border-t border-slate-100">
                {shortage.length ? (
                  <Alert level="warning" title="Disponibilidade insuficiente">
                    {shortage.map((l) => `${l.sku}: solicitado ${fmtQty(l.requested_qty)}, disponível ${fmtQty(l.available_now)}`).join("; ")}. A reserva é tudo-ou-nada e
                    será recusada.
                  </Alert>
                ) : null}
                <ActionForm action={reserveOrderAction}>
                  <input type="hidden" name="_id" value={id} />
                  <SubmitButton>Reservar estoque (FEFO)</SubmitButton>
                </ActionForm>
              </CardBody>
            ) : null}

            {o.status === "reserved" && can(role, "outbound.reserve") ? (
              <CardBody className="border-t border-slate-100">
                <ActionForm action={releasePickingAction}>
                  <input type="hidden" name="_id" value={id} />
                  <SubmitButton>Liberar para separação (gerar tarefas)</SubmitButton>
                </ActionForm>
              </CardBody>
            ) : null}

            {o.status === "picked" && can(role, "outbound.check") ? (
              <CardBody className="border-t border-slate-100">
                <h3 className="mb-1 text-sm font-semibold text-slate-800">Conferência final</h3>
                <p className="mb-3 text-xs text-slate-500">Reconte os volumes na doca. Qualquer diferença em relação ao separado é registrada como divergência e bloqueia a expedição.</p>
                <ActionForm action={checkOrderAction} className="space-y-3">
                  <input type="hidden" name="_id" value={id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {o.lines.map((l, idx) => (
                      <Field key={l.id} label={`${l.sku} — conferido (separado: ${fmtQty(l.picked_qty)})`} required>
                        <input type="hidden" name={`lines.${idx}.lineId`} value={l.id} />
                        <Input name={`lines.${idx}.checkedQty`} type="number" min={0} step="any" required />
                      </Field>
                    ))}
                  </div>
                  <Field label="Observações">
                    <Input name="notes" maxLength={500} />
                  </Field>
                  <SubmitButton>Registrar conferência</SubmitButton>
                </ActionForm>
              </CardBody>
            ) : null}

            {o.status === "checked" && can(role, "outbound.ship") ? (
              <CardBody className="border-t border-slate-100">
                <h3 className="mb-1 text-sm font-semibold text-slate-800">Confirmar expedição</h3>
                <p className="mb-3 text-xs text-slate-500">
                  Baixa física de {fmtQty(o.lines.reduce((a, l) => a + l.checked_qty, 0))} un da doca, consumo das reservas e comunicação ao ERP.
                </p>
                <ActionForm action={shipOrderAction} confirm="Confirmar a expedição? A baixa de estoque é definitiva." className="grid gap-3 sm:grid-cols-3">
                  <input type="hidden" name="_id" value={id} />
                  <Field label="Transportadora">
                    <Input name="carrier" maxLength={120} />
                  </Field>
                  <Field label="Placa do veículo">
                    <Input name="vehiclePlate" maxLength={10} />
                  </Field>
                  <Field label="Documento (NF/romaneio)">
                    <Input name="documentRef" maxLength={60} />
                  </Field>
                  <div className="sm:col-span-3">
                    <SubmitButton variant="success">Confirmar expedição</SubmitButton>
                  </div>
                </ActionForm>
              </CardBody>
            ) : null}

            {o.status === "shipped" && o.shipment ? (
              <CardBody className="border-t border-slate-100">
                <Alert level="success" title={`Expedição ${o.shipment.code} confirmada`}>
                  {fmtDateTime(o.shipment.shipped_at)} por {o.shipment.shipped_by_name}
                  {o.shipment.carrier ? ` · ${o.shipment.carrier}` : ""}
                  {o.shipment.vehicle_plate ? ` · placa ${o.shipment.vehicle_plate}` : ""}
                  {o.shipment.document_ref ? ` · doc. ${o.shipment.document_ref}` : ""}
                </Alert>
              </CardBody>
            ) : null}
          </Card>

          {o.reservations.length ? (
            <Card>
              <CardHeader title="Reservas" description="Saldo comprometido por endereço/lote (FEFO)." />
              <TableWrap>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Endereço</th>
                      <th>Lote</th>
                      <th className="num">Reservado</th>
                      <th className="num">Separado</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.reservations.map((r) => (
                      <tr key={r.id}>
                        <td>{r.sku}</td>
                        <td className="font-mono text-[11px] whitespace-nowrap">{r.location_code}</td>
                        <td className="code">{r.lot_code || "—"}</td>
                        <td className="num">{fmtQty(r.quantity)}</td>
                        <td className="num">{fmtQty(r.picked_qty)}</td>
                        <td>
                          <StatusBadge kind="reservation" status={r.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          ) : null}

          {pickTasks.length ? (
            <Card>
              <CardHeader title="Tarefas de separação" description="Execute pela central de tarefas. Ao concluir todas, o pedido passa a Separado." />
              <TaskTable rows={pickTasks} />
            </Card>
          ) : null}

          <Card>
            <CardHeader title={`Divergências (${divergences.length})`} />
            <DivergenceList rows={divergences} canResolve={can(role, "divergence.resolve")} />
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Histórico" />
            <HistoryList rows={history} />
          </Card>
          {["open", "reserved"].includes(o.status) && can(role, "outbound.reserve") ? (
            <Card>
              <CardHeader title="Cancelar pedido" description="Permitido antes da separação. Reservas são liberadas." />
              <CardBody>
                <ActionForm action={cancelOrderAction} confirm="Cancelar este pedido e liberar as reservas?" className="space-y-3">
                  <input type="hidden" name="_id" value={id} />
                  <Field label="Motivo" required>
                    <Input name="reason" required minLength={5} />
                  </Field>
                  <SubmitButton variant="danger" size="sm">
                    Cancelar pedido
                  </SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {o.status === "picking" ? (
            <Alert level="info">
              Separação em andamento.{" "}
              <Link href="/tarefas?type=picking&status=pending,in_progress" className="link">
                Ver tarefas abertas
              </Link>
            </Alert>
          ) : null}
        </div>
      </div>
    </>
  );
}
