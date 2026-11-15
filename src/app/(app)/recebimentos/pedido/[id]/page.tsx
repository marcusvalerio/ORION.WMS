import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getPurchaseOrder } from "@/server/integrations/erp/gateway";
import { listPurchaseOrderDeliveries, purchaseOrderBalance } from "@/server/services/receiving";
import { listWarehouses } from "@/server/services/warehouse";
import { WMS_TIMEZONE } from "@/server/services/docks";
import { createReceiptFromPoAction } from "@/server/actions/receiving";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { PoBalanceTable, PoDeliveriesTable } from "@/components/wms/po-balance";
import { fmtDate, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Pedido de compra — entregas" };

const PO_STATUS: Record<string, string> = { open: "Aberto", partially_received: "Recebido parcial", received: "Recebido", cancelled: "Cancelado" };

export default async function PurchaseOrderDeliveriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const po = await getPurchaseOrder(ctx.db, ctx.user.companyId, id);
  if (!po) notFound();
  const [balance, deliveries, warehouses, appointments] = await Promise.all([
    purchaseOrderBalance(ctx.db, id),
    listPurchaseOrderDeliveries(ctx.db, ctx.user.companyId, id),
    listWarehouses(ctx),
    ctx.db.query<{ id: string; code: string; label: string }>(
      `select a.id, a.code, a.code || ' — ' || d.code || ' ' || to_char(a.starts_at at time zone $3, 'DD/MM HH24:MI') as label
       from wms.dock_appointments a join wms.docks d on d.id = a.dock_id
       where a.company_id = $1 and a.direction = 'inbound' and a.status in ('scheduled', 'checked_in')
         and (a.purchase_order_id is null or a.purchase_order_id = $2)
         and not exists (select 1 from wms.receipts r where r.appointment_id = a.id and r.status <> 'cancelled')
       order by a.starts_at`,
      [ctx.user.companyId, id, WMS_TIMEZONE],
    ),
  ]);
  const pendingTotal = balance.reduce((a, b) => a + b.pending, 0);
  const canCreate = can(ctx.user.role, "receipt.create") && ["open", "partially_received"].includes(po.status) && pendingTotal > 0;

  return (
    <>
      <PageHeader
        title={`Pedido de compra ${po.number}`}
        badges={<Badge tone={po.status === "received" ? "success" : po.status === "partially_received" ? "warning" : "info"}>{PO_STATUS[po.status] ?? po.status}</Badge>}
        description={`${po.supplier_name} · ${deliveries.length} entrega(s) registrada(s)`}
        breadcrumbs={[{ label: "Entrada" }, { label: "Recebimentos", href: "/recebimentos" }, { label: "Novo", href: "/recebimentos/novo" }, { label: po.number }]}
      />
      <Card className="mb-5">
        <CardBody>
          <DefinitionList
            items={[
              ["Emissão", fmtDate(po.issue_date)],
              ["Previsão", fmtDate(po.expected_date)],
              ["NF informada no ERP", po.invoice_number],
              ["Quantidade total", fmtQty(po.total_qty)],
              ["Saldo pendente", fmtQty(pendingTotal)],
            ]}
          />
        </CardBody>
      </Card>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Saldo por item" description="Faltas e avarias de uma entrega voltam ao saldo pendente; sobras ficam como divergência e não abatem outros itens." />
          <PoBalanceTable rows={balance} />
        </Card>
        <Card>
          <CardHeader title="Histórico de entregas" />
          <PoDeliveriesTable rows={deliveries} />
        </Card>
      </div>
      {canCreate ? (
        <Card className="mt-5">
          <CardHeader
            title="Nova entrega (parcial)"
            description="Informe a quantidade que chegou nesta entrega, por item, até o saldo pendente. Itens com 0 ficam fora do recebimento."
          />
          <ActionForm action={createReceiptFromPoAction}>
            <input type="hidden" name="purchaseOrderId" value={po.id} />
            <TableWrap>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="num">Saldo pendente</th>
                    <th className="w-36">Nesta entrega</th>
                  </tr>
                </thead>
                <tbody>
                  {balance.map((b, i) => (
                    <tr key={b.purchase_order_item_id}>
                      <td>
                        <input type="hidden" name={`items.${i}.purchaseOrderItemId`} value={b.purchase_order_item_id} />
                        <span className="font-medium">{b.sku}</span>
                        <span className="block text-xs text-muted">{b.description}</span>
                      </td>
                      <td className="num">
                        {fmtQty(b.pending)} {b.uom}
                      </td>
                      <td>
                        <Input
                          name={`items.${i}.quantity`}
                          type="number"
                          min={0}
                          max={b.pending}
                          step="any"
                          defaultValue={b.pending}
                          readOnly={b.pending <= 0}
                          aria-label={`Quantidade ${b.sku}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <CardBody className="grid grid-cols-1 gap-3 border-t border-line md:grid-cols-4 md:items-end">
              <Field label="Depósito de destino" required>
                <Select name="warehouseId" required options={warehouses.filter((w) => w.active).map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }))} />
              </Field>
              <Field label="Nº da NF">
                <Input name="invoiceNumber" maxLength={40} />
              </Field>
              <Field label="Agendamento de doca">
                <Select name="appointmentId" placeholder="Sem agendamento" options={appointments.map((a) => ({ value: a.id, label: a.label }))} />
              </Field>
              <SubmitButton>Criar recebimento desta entrega</SubmitButton>
            </CardBody>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
