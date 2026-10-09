import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { listPurchaseOrders } from "@/server/integrations/erp/gateway";
import { listWarehouses } from "@/server/services/warehouse";
import { listProductOptions } from "@/server/services/products";
import { createManualReceiptAction, createReceiptFromPoAction } from "@/server/actions/receiving";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { fmtDate, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";

export const metadata = { title: "Novo recebimento" };

const PO_STATUS: Record<string, string> = { open: "Aberto", partially_received: "Recebido parcial", received: "Recebido", cancelled: "Cancelado" };

export default async function NewReceiptPage() {
  const ctx = await requireCtx();
  if (!can(ctx.user.role, "receipt.create")) {
    return (
      <>
        <PageHeader title="Novo recebimento" />
        <Alert level="warning">Seu perfil não permite criar recebimentos.</Alert>
      </>
    );
  }
  const [orders, warehouses, products, suppliers] = await Promise.all([
    listPurchaseOrders(ctx.db, ctx.user.companyId),
    listWarehouses(ctx),
    listProductOptions(ctx),
    ctx.db.query<{ id: string; code: string; name: string }>(`select id, code, name from erp.suppliers where company_id = $1 order by name`, [ctx.user.companyId]),
  ]);
  const whOptions = warehouses.filter((w) => w.active).map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }));

  return (
    <>
      <PageHeader
        title="Novo recebimento"
        description="Importe um pedido de compra do ERP. Cada pedido gera um único recebimento ativo, evitando duplicidade por reenvio."
        breadcrumbs={[{ label: "Entrada" }, { label: "Recebimentos", href: "/recebimentos" }, { label: "Novo" }]}
      />
      <Card>
        <CardHeader title="Pedidos de compra (ERP)" description="Consulta direta ao ERP. A NF-e pode ser associada manualmente; a consulta automática à SEFAZ não está conectada nesta versão." />
        {orders.length ? (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Fornecedor</th>
                  <th>Emissão / previsão</th>
                  <th className="num">Itens</th>
                  <th className="num">Quantidade</th>
                  <th>Situação</th>
                  <th className="min-w-[360px]">Importar</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((po) => (
                  <tr key={po.id}>
                    <td className="font-medium">{po.number}</td>
                    <td>{po.supplier_name}</td>
                    <td>
                      {fmtDate(po.issue_date)}
                      <span className="block text-xs text-slate-500">prev. {fmtDate(po.expected_date)}</span>
                    </td>
                    <td className="num">{po.item_count}</td>
                    <td className="num">{fmtQty(po.total_qty)}</td>
                    <td>
                      <Badge tone={po.status === "open" ? "info" : po.status === "received" ? "success" : "neutral"}>{PO_STATUS[po.status]}</Badge>
                    </td>
                    <td>
                      {po.receipt_code ? (
                        <span className="text-xs text-slate-500">
                          Já importado:{" "}
                          <Link className="link" href={`/recebimentos?q=${po.receipt_code}`}>
                            {po.receipt_code}
                          </Link>
                        </span>
                      ) : po.status === "open" || po.status === "partially_received" ? (
                        <ActionForm action={createReceiptFromPoAction} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="purchaseOrderId" value={po.id} />
                          <Select name="warehouseId" options={whOptions} className="w-auto" aria-label="Depósito de destino" />
                          <Input name="invoiceNumber" defaultValue={po.invoice_number ?? ""} placeholder="Nº NF" className="w-28" aria-label="Número da NF" />
                          <SubmitButton size="sm">Iniciar recebimento</SubmitButton>
                        </ActionForm>
                      ) : (
                        <span className="text-xs text-slate-400">Indisponível</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState title="Nenhum pedido de compra no ERP" />
        )}
      </Card>

      <div className="mt-5">
        <Disclosure title="Entrada avulsa (sem pedido de compra)">
          <ActionForm action={createManualReceiptAction} className="grid gap-3 md:grid-cols-2">
            <Field label="Depósito de destino" required>
              <Select name="warehouseId" required options={whOptions} />
            </Field>
            <Field label="Fornecedor" required>
              <Select name="supplierId" required placeholder="Selecione…" options={suppliers.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))} />
            </Field>
            <Field label="Nº da nota fiscal">
              <Input name="invoiceNumber" maxLength={40} />
            </Field>
            <Field label="Observações">
              <Input name="notes" maxLength={500} />
            </Field>
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-3 gap-3 md:col-span-2">
                <Field label={`Item ${i + 1} — produto`} required={i === 0} className="col-span-2">
                  <Select name={`items.${i}.productId`} placeholder="—" required={i === 0} options={products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.description}` }))} />
                </Field>
                <Field label="Qtd. prevista" required={i === 0}>
                  <Input name={`items.${i}.expectedQty`} type="number" min={0} step="any" required={i === 0} />
                </Field>
              </div>
            ))}
            <p className="text-xs text-slate-500 md:col-span-2">Linhas sem produto são ignoradas.</p>
            <div className="md:col-span-2">
              <SubmitButton>Criar recebimento</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      </div>
    </>
  );
}
