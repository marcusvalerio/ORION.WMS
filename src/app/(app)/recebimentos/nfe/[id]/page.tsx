import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getNfe } from "@/server/services/nfe";
import { listWarehouses } from "@/server/services/warehouse";
import { listProductOptions } from "@/server/services/products";
import {
  createReceiptFromNfeAction,
  discardNfeAction,
  linkNfeItemAction,
  linkNfeSupplierAction,
  setNfePurchaseOrderAction,
} from "@/server/actions/inbound";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Field, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";

export const metadata = { title: "NF-e importada" };

const MATCH: Record<string, string> = { ean: "EAN", supplier_code: "De-para salvo", manual: "Vínculo manual" };
const fmtCnpj = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

export default async function NfePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const n = await getNfe(ctx, id);
  if (!n) notFound();
  const editable = n.status === "pending" && can(ctx.user.role, "receipt.create");
  const [warehouses, products, suppliers, appointments] = await Promise.all([
    listWarehouses(ctx),
    listProductOptions(ctx),
    ctx.db.query<{ id: string; code: string; name: string; cnpj: string | null }>(
      `select id, code, name, cnpj from erp.suppliers where company_id = $1 order by name`,
      [ctx.user.companyId],
    ),
    n.purchase_order_id
      ? ctx.db.query<{ id: string; code: string }>(
          `select a.id, a.code from wms.dock_appointments a where a.company_id = $1 and a.direction = 'inbound'
             and a.status in ('scheduled', 'checked_in') and (a.purchase_order_id is null or a.purchase_order_id = $2)
             and not exists (select 1 from wms.receipts r where r.appointment_id = a.id and r.status <> 'cancelled')
           order by a.starts_at`,
          [ctx.user.companyId, n.purchase_order_id],
        )
      : Promise.resolve([]),
  ]);
  const unlinked = n.items.filter((i) => !i.product_id).length;
  const productOptions = products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.description}` }));

  return (
    <>
      <PageHeader
        title={`NF-e ${n.number}/${n.series}`}
        badges={<StatusBadge kind="nfe" status={n.status} />}
        description={`${n.emitter_name} · CNPJ ${fmtCnpj(n.emitter_cnpj)}`}
        breadcrumbs={[{ label: "Entrada" }, { label: "Recebimentos", href: "/recebimentos" }, { label: "Novo", href: "/recebimentos/novo" }, { label: `NF ${n.number}` }]}
      />
      <Card className="mb-5">
        <CardBody className="space-y-3">
          <DefinitionList
            items={[
              ["Chave de acesso", <span key="k" className="font-mono text-xs">{n.access_key}</span>],
              ["Emissão", fmtDateTime(n.issued_at)],
              ["Fornecedor (ERP)", n.supplier_name ?? <span className="text-warn-fg">Não identificado pelo CNPJ</span>],
              ["Pedido de compra", n.po_number ?? "Sem pedido"],
              ["Recebimento", n.receipt_id ? <Link className="link" href={`/recebimentos/${n.receipt_id}`}>{n.receipt_code}</Link> : "—"],
              ["Importada em", fmtDateTime(n.created_at)],
            ]}
          />
          <p className="text-xs text-muted">
            Leitura local do XML: o dígito verificador da chave é conferido, mas a assinatura digital e a autorização na SEFAZ não são consultadas.
          </p>
        </CardBody>
      </Card>

      {editable && !n.supplier_id ? (
        <Card className="mb-5">
          <CardHeader title="Vincular emitente" description="O CNPJ do emitente será gravado no fornecedor escolhido (se ele ainda não tiver CNPJ)." />
          <CardBody>
            <ActionForm action={linkNfeSupplierAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="_id" value={n.id} />
              <Field label="Fornecedor" required>
                <Select
                  name="supplierId"
                  required
                  placeholder="Selecione…"
                  options={suppliers.filter((s) => !s.cnpj || s.cnpj === n.emitter_cnpj).map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }))}
                />
              </Field>
              <SubmitButton>Vincular</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      <Card className="mb-5">
        <CardHeader
          title={`Itens da NF (${n.items.length})`}
          description={unlinked ? `${unlinked} item(ns) pendente(s) de vínculo: confirme o produto; o de-para fornecedor × código fica salvo.` : "Todos os itens vinculados a produtos."}
        />
        <TableWrap>
          <table className="table-base">
            <thead>
              <tr>
                <th>#</th>
                <th>Código / EAN</th>
                <th>Descrição na NF</th>
                <th className="num">Qtd.</th>
                <th>Lotes (rastro)</th>
                <th className="min-w-[260px]">Produto</th>
              </tr>
            </thead>
            <tbody>
              {n.items.map((i) => (
                <tr key={i.id}>
                  <td className="text-muted">{i.item_no}</td>
                  <td className="text-xs">
                    <span className="font-mono">{i.supplier_code}</span>
                    <span className="block text-muted">{i.ean ?? "sem GTIN"}</span>
                  </td>
                  <td className="text-xs">{i.description}</td>
                  <td className="num whitespace-nowrap">
                    {fmtQty(i.quantity)} {i.unit}
                    {i.units_factor !== 1 ? <span className="block text-xs text-muted">= {fmtQty(i.quantity * i.units_factor)} {i.uom}</span> : null}
                  </td>
                  <td className="text-xs">
                    {i.lots.length
                      ? i.lots.map((l) => (
                          <span key={l.lot} className="block whitespace-nowrap">
                            {l.lot} · {fmtQty(l.quantity)} · val. {fmtDate(l.expiryDate)}
                          </span>
                        ))
                      : "—"}
                  </td>
                  <td>
                    {i.product_id ? (
                      <div className="text-sm">
                        <span className="font-medium">{i.sku}</span> <Badge tone="success">{MATCH[i.match_source ?? ""] ?? i.match_source}</Badge>
                        <span className="block text-xs text-muted">{i.product_description}</span>
                        {i.uom && i.uom !== i.unit && i.units_factor === 1 ? (
                          <span className="block text-xs text-warn-fg">Unidade da NF ({i.unit}) difere da do produto ({i.uom}) e não há embalagem com esse código.</span>
                        ) : null}
                      </div>
                    ) : editable && n.supplier_id ? (
                      <ActionForm action={linkNfeItemAction} className="flex items-end gap-2">
                        <input type="hidden" name="_id" value={i.id} />
                        <Select name="productId" required placeholder="Selecione o produto…" options={productOptions} aria-label={`Produto do item ${i.item_no}`} />
                        <SubmitButton size="sm">Confirmar</SubmitButton>
                      </ActionForm>
                    ) : (
                      <Badge tone="warning">Pendente de vínculo</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Card className="mb-5">
        <CardHeader
          title="Comparação NF × pedido de compra"
          description="Diferença = quantidade da NF − saldo pendente do pedido. Positiva: a NF traz além do pedido (o excedente vira sobra se for conferido)."
          actions={
            editable && n.supplier_id ? (
              <ActionForm action={setNfePurchaseOrderAction} className="flex items-end gap-2">
                <input type="hidden" name="_id" value={n.id} />
                <Select
                  name="purchaseOrderId"
                  defaultValue={n.purchase_order_id ?? ""}
                  placeholder="Sem pedido (entrada avulsa)"
                  options={n.purchaseOrders.map((p) => ({ value: p.id, label: p.number }))}
                  aria-label="Pedido de compra"
                />
                <SubmitButton size="sm" variant="secondary">
                  Aplicar
                </SubmitButton>
              </ActionForm>
            ) : null
          }
        />
        {n.comparison.length ? (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="num">Pedido</th>
                  <th className="num">Saldo pendente</th>
                  <th className="num">NF</th>
                  <th className="num">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {n.comparison.map((c) => (
                  <tr key={c.product_id}>
                    <td>
                      <span className="font-medium">{c.sku}</span>
                      <span className="block text-xs text-muted">{c.description}</span>
                    </td>
                    <td className="num">{c.ordered === null ? <Badge tone="danger">Fora do pedido</Badge> : fmtQty(c.ordered)}</td>
                    <td className="num">{c.pending === null ? "—" : fmtQty(c.pending)}</td>
                    <td className="num">{fmtQty(c.nfe_qty)}</td>
                    <td className={`num font-medium ${c.difference && c.difference > 0 ? "text-crit-fg" : c.difference && c.difference < 0 ? "text-warn-fg" : ""}`}>
                      {c.difference === null ? "—" : `${c.difference > 0 ? "+" : ""}${fmtQty(c.difference)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="px-4 py-3 text-sm text-muted">Vincule os itens para comparar.</p>
        )}
      </Card>

      {editable ? (
        <Card>
          <CardHeader title="Criar recebimento" description="Uma linha por lote, com lote e validade da NF pré-preenchidos. O previsto de cada linha é limitado ao saldo pendente do pedido." />
          <CardBody className="space-y-3">
            {unlinked || !n.supplier_id ? <Alert level="warning">Conclua os vínculos pendentes para criar o recebimento.</Alert> : null}
            <ActionForm action={createReceiptFromNfeAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="_id" value={n.id} />
              <Field label="Depósito de destino" required>
                <Select name="warehouseId" required options={warehouses.filter((w) => w.active).map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }))} />
              </Field>
              {n.purchase_order_id ? (
                <Field label="Agendamento de doca">
                  <Select name="appointmentId" placeholder="Sem agendamento" options={appointments.map((a) => ({ value: a.id, label: a.code }))} />
                </Field>
              ) : null}
              <SubmitButton disabled={!!unlinked || !n.supplier_id}>Criar recebimento</SubmitButton>
            </ActionForm>
            <ActionForm action={discardNfeAction} confirm="Descartar esta importação de NF-e?">
              <input type="hidden" name="_id" value={n.id} />
              <SubmitButton variant="ghost" size="sm">
                Descartar importação
              </SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
