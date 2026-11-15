import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getAppointment } from "@/server/services/docks";
import { entityHistory } from "@/server/services/audit";
import { listWarehouses } from "@/server/services/warehouse";
import { changeAppointmentStatusAction, receiptFromAppointmentAction } from "@/server/actions/inbound";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/fields";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { HistoryList } from "@/components/wms/history";
import { fmtDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Agendamento de doca" };

export default async function AppointmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const a = await getAppointment(ctx, id);
  if (!a) notFound();
  const [history, warehouses] = await Promise.all([entityHistory(ctx, "dock_appointment", id), listWarehouses(ctx)]);
  const role = ctx.user.role;
  const day = a.local_date;
  const statusForm = (action: string, label: string, variant: "primary" | "secondary" | "danger" = "secondary", confirm?: string) => (
    <ActionForm action={changeAppointmentStatusAction} confirm={confirm}>
      <input type="hidden" name="_id" value={id} />
      <input type="hidden" name="action" value={action} />
      <SubmitButton size="sm" variant={variant}>
        {label}
      </SubmitButton>
    </ActionForm>
  );

  return (
    <>
      <PageHeader
        title={`Agendamento ${a.code}`}
        badges={<StatusBadge kind="appointment" status={a.status} />}
        description={`Doca ${a.dock_code} · ${a.local_start}–${a.local_end} · ${a.direction === "inbound" ? "Entrada" : "Saída"}`}
        breadcrumbs={[{ label: "Entrada" }, { label: "Agenda de docas", href: `/docas?data=${day}` }, { label: a.code }]}
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardBody>
              <DefinitionList
                items={[
                  ["Início", fmtDateTime(a.starts_at)],
                  ["Fim", fmtDateTime(a.ends_at)],
                  ["Transportadora", a.carrier],
                  ["Placa", a.vehicle_plate],
                  [
                    "Documento",
                    a.purchase_order_id ? (
                      <Link className="link" href={`/recebimentos/pedido/${a.purchase_order_id}`}>
                        Pedido de compra {a.po_number}
                      </Link>
                    ) : a.outbound_order_id ? (
                      <Link className="link" href={`/separacao/${a.outbound_order_id}`}>
                        Pedido de saída {a.outbound_code}
                      </Link>
                    ) : (
                      "—"
                    ),
                  ],
                  ["Recebimento", a.receipt_id ? <Link className="link" href={`/recebimentos/${a.receipt_id}`}>{a.receipt_code}</Link> : "—"],
                  ["Observações", a.notes],
                ]}
              />
            </CardBody>
          </Card>
          {can(role, "dock.schedule") && ["scheduled", "checked_in"].includes(a.status) ? (
            <Card>
              <CardHeader title="Operação" description="Check-in na chegada do veículo; não comparecimento só após o início da janela." />
              <CardBody className="flex flex-wrap gap-2">
                {a.status === "scheduled" ? statusForm("check_in", "Registrar check-in", "primary") : null}
                {a.status === "checked_in" ? statusForm("complete", "Concluir", "primary") : null}
                {a.status === "scheduled" ? statusForm("no_show", "Não compareceu", "secondary", "Registrar não comparecimento?") : null}
                {a.status === "scheduled" ? statusForm("cancel", "Cancelar", "danger", "Cancelar este agendamento?") : null}
              </CardBody>
            </Card>
          ) : null}
          {a.direction === "inbound" && a.purchase_order_id && !a.receipt_id && ["scheduled", "checked_in"].includes(a.status) && can(role, "receipt.create") ? (
            <Card>
              <CardHeader title="Iniciar recebimento" description="Cria a entrega com o saldo pendente do pedido; a chegada é registrada pelo check-in do agendamento." />
              <CardBody>
                <ActionForm action={receiptFromAppointmentAction} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="_id" value={id} />
                  <input type="hidden" name="purchaseOrderId" value={a.purchase_order_id} />
                  <Field label="Depósito" required>
                    <Select name="warehouseId" defaultValue={a.warehouse_id} options={warehouses.filter((w) => w.id === a.warehouse_id).map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }))} />
                  </Field>
                  <Field label="Nº da NF">
                    <Input name="invoiceNumber" maxLength={40} />
                  </Field>
                  <SubmitButton>Criar recebimento</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
        <Card>
          <CardHeader title="Histórico" />
          <HistoryList rows={history} />
        </Card>
      </div>
    </>
  );
}
