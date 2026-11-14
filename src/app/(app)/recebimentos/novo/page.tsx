import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { listPurchaseOrdersWithBalance } from "@/server/services/receiving";
import { listNfeImports } from "@/server/services/nfe";
import { importNfeAction } from "@/server/actions/inbound";
import { StatusBadge } from "@/components/ui/badge";
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
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
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
  const [orders, warehouses, products, suppliers, nfes] = await Promise.all([
    listPurchaseOrdersWithBalance(ctx),
    listWarehouses(ctx),
    listProductOptions(ctx),
    ctx.db.query<{ id: string; code: string; name: string }>(`select id, code, name from erp.suppliers where company_id = $1 order by name`, [ctx.user.companyId]),
    listNfeImports(ctx),
  ]);
  const pendingNfes = nfes.filter((n) => n.status === "pending");
  const whOptions = warehouses.filter((w) => w.active).map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }));

  return (
    <>
      <PageHeader
        title="Novo recebimento"
        description="Importe o XML da NF-e ou um pedido de compra do ERP. Um pedido pode chegar em várias entregas: cada recebimento leva o saldo pendente, e o banco do pedido é travado para que entregas simultâneas não ultrapassem o pedido."
        breadcrumbs={[{ label: "Entrada" }, { label: "Recebimentos", href: "/recebimentos" }, { label: "Novo" }]}
      />
      <Card className="mb-5">
        <CardHeader
          title="Importar XML da NF-e"
          description="Modelo 55, layout 4.00, até 900 KB. A leitura é local (sem consulta à SEFAZ): chave de acesso com dígito verificador, emitente, itens, lote e validade."
        />
        <div className="p-4">
          <ActionForm action={importNfeAction} className="flex flex-wrap items-end gap-3">
            <Field label="Arquivo XML" required>
              <Input name="xmlFile" type="file" accept=".xml,text/xml,application/xml" required />
            </Field>
            <SubmitButton>Importar NF-e</SubmitButton>
          </ActionForm>
          {pendingNfes.length ? (
            <ul className="mt-4 space-y-1 text-sm">
              {pendingNfes.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center gap-2">
                  <StatusBadge kind="nfe" status={n.status} />
                  <Link className="link" href={`/recebimentos/nfe/${n.id}`}>
                    NF {n.number}/{n.series} — {n.emitter_name}
                  </Link>
                  <span className="text-xs text-slate-500">
                    {fmtDateTime(n.created_at)}
                    {n.pending_links ? ` · ${n.pending_links} item(ns) pendente(s) de vínculo` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Card>
      <Card>
        <CardHeader title="Pedidos de compra (ERP)" description="Saldo pendente = pedido − aceito nas entregas conferidas − previsto nas entregas em andamento. Use “Entrega parcial” para informar quantidades por item." />
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
                  <th className="num">Saldo pendente</th>
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
                    <td className="num">
                      {fmtQty(po.pending_qty)}
                      {po.in_transit_qty ? <span className="block text-xs text-slate-500">{fmtQty(po.in_transit_qty)} em andamento</span> : null}
                    </td>
                    <td>
                      <Badge tone={po.status === "open" ? "info" : po.status === "received" ? "success" : "neutral"}>{PO_STATUS[po.status]}</Badge>
                    </td>
                    <td>
                      {(po.status === "open" || po.status === "partially_received") && po.pending_qty > 0 ? (
                        <ActionForm action={createReceiptFromPoAction} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="purchaseOrderId" value={po.id} />
                          <Select name="warehouseId" options={whOptions} className="w-auto" aria-label="Depósito de destino" />
                          <Input name="invoiceNumber" defaultValue={po.deliveries ? "" : (po.invoice_number ?? "")} placeholder="Nº NF" className="w-28" aria-label="Número da NF" />
                          <SubmitButton size="sm">Receber saldo</SubmitButton>
                        </ActionForm>
                      ) : (
                        <span className="text-xs text-slate-400">{po.pending_qty > 0 ? "Indisponível" : "Sem saldo pendente"}</span>
                      )}
                      <span className="mt-1 block text-xs">
                        <Link className="link" href={`/recebimentos/pedido/${po.id}`}>
                          {po.deliveries ? `${po.deliveries} entrega(s) · ` : ""}Entrega parcial / histórico
                        </Link>
                      </span>
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
