import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getProduct, listPackaging } from "@/server/services/products";
import { listZones, STORAGE_CLASSES } from "@/server/services/warehouse";
import { listStock } from "@/server/services/stock";
import { addPackagingAction, togglePackagingAction, updateProductSettingsAction } from "@/server/actions/warehouse";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox, Field, Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { STORAGE_CLASS_LABELS } from "@/lib/labels";
import { fmtDate, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Produto" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const product = await getProduct(ctx, id);
  if (!product) notFound();
  const [packaging, zones, stock] = await Promise.all([listPackaging(ctx, id), listZones(ctx), listStock(ctx, { productId: id, pageSize: 0 })]);
  const manage = can(ctx.user.role, "products.manage");
  const dims = [product.length_cm, product.width_cm, product.height_cm].every((v) => v !== null)
    ? `${fmtQty(product.length_cm)} × ${fmtQty(product.width_cm)} × ${fmtQty(product.height_cm)} cm`
    : "—";

  return (
    <>
      <PageHeader
        title={`${product.sku} — ${product.description}`}
        badges={product.status === "active" ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>}
        breadcrumbs={[{ label: "Armazém" }, { label: "Produtos", href: "/produtos" }, { label: product.sku }]}
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Cadastro mestre (ERP)" description="Somente leitura no WMS." />
            <CardBody>
              <DefinitionList
                items={[
                  ["SKU", product.sku],
                  ["Código de barras", product.barcode],
                  ["Unidade de medida", product.uom],
                  ["Categoria", product.category],
                  ["Peso", product.weight_kg !== null ? `${fmtQty(product.weight_kg)} kg` : "—"],
                  ["Dimensões (C × L × A)", dims],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Estoque por endereço"
              description={`Físico ${fmtQty(product.physical)} · Reservado ${fmtQty(product.reserved)} · Bloqueado ${fmtQty(product.blocked)} · Disponível ${fmtQty(product.physical - product.reserved - product.blocked)} ${product.uom}`}
            />
            {stock.rows.length ? (
              <TableWrap>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Endereço</th>
                      <th>Lote</th>
                      <th>Validade</th>
                      <th className="num">Físico</th>
                      <th className="num">Reservado</th>
                      <th className="num">Bloqueado</th>
                      <th className="num">Disponível</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock.rows.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <Link href={`/estoque/saldo/${b.id}`} className="link font-mono text-xs">
                            {b.location_code}
                          </Link>
                        </td>
                        <td className="code">{b.lot_code || "—"}</td>
                        <td>{fmtDate(b.expiry_date)}</td>
                        <td className="num">{fmtQty(b.quantity)}</td>
                        <td className="num">{fmtQty(b.reserved_qty)}</td>
                        <td className="num">{fmtQty(b.blocked_qty)}</td>
                        <td className="num font-medium">{fmtQty(b.available_qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState title="Sem saldo armazenado" />
            )}
          </Card>
          <Card>
            <CardHeader
              title="Unidades logísticas"
              description="Fatores de conversão para embalagens. O estoque é sempre controlado na unidade base: cadastrar ou alterar embalagens não altera saldos."
            />
            {packaging.length ? (
              <TableWrap>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Descrição</th>
                      <th className="num">Unidades base</th>
                      <th>Código de barras</th>
                      <th>Status</th>
                      {manage ? <th /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {packaging.map((p) => (
                      <tr key={p.id}>
                        <td className="code">{p.code}</td>
                        <td>{p.description ?? "—"}</td>
                        <td className="num">
                          {fmtQty(p.units_per_package)} {product.uom}
                        </td>
                        <td className="code">{p.barcode ?? "—"}</td>
                        <td>{p.active ? <Badge tone="success">Ativa</Badge> : <Badge>Inativa</Badge>}</td>
                        {manage ? (
                          <td className="text-right">
                            <ActionForm action={togglePackagingAction}>
                              <input type="hidden" name="_id" value={p.id} />
                              <input type="hidden" name="active" value={String(!p.active)} />
                              <SubmitButton size="sm" variant="ghost">
                                {p.active ? "Desativar" : "Ativar"}
                              </SubmitButton>
                            </ActionForm>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState title="Nenhuma unidade logística cadastrada" />
            )}
            {manage ? (
              <CardBody className="border-t border-slate-100">
                <ActionForm action={addPackagingAction} resetOnSuccess className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <input type="hidden" name="_id" value={id} />
                  <Field label="Código" required>
                    <Input name="code" required maxLength={20} placeholder="CX12" />
                  </Field>
                  <Field label="Descrição" className="md:col-span-2">
                    <Input name="description" maxLength={120} />
                  </Field>
                  <Field label={`Unidades (${product.uom})`} required>
                    <Input name="unitsPerPackage" type="number" min={0} step="any" required />
                  </Field>
                  <Field label="Código de barras">
                    <Input name="barcode" maxLength={40} />
                  </Field>
                  <div className="col-span-2 md:col-span-5">
                    <SubmitButton variant="secondary">Adicionar unidade logística</SubmitButton>
                  </div>
                </ActionForm>
              </CardBody>
            ) : null}
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader title="Parâmetros logísticos (WMS)" description="Regras usadas na conferência, sugestão de endereço e reserva." />
          <CardBody>
            <ActionForm action={updateProductSettingsAction} className="space-y-3">
              <input type="hidden" name="_id" value={id} />
              <Checkbox name="lotControlled" label="Controla lote" defaultChecked={product.lot_controlled} disabled={!manage} />
              <Checkbox name="expiryControlled" label="Controla validade (FEFO)" defaultChecked={product.expiry_controlled} disabled={!manage} />
              <Checkbox name="serialControlled" label="Controla número de série" defaultChecked={product.serial_controlled} disabled={!manage} />
              <p className="text-xs text-slate-500">O rastreio individual por número de série é registrado como parâmetro; a captura por unidade está planejada.</p>
              <Field label="Classe de armazenagem">
                <Select
                  name="storageClass"
                  defaultValue={product.storage_class}
                  disabled={!manage}
                  options={STORAGE_CLASSES.map((c) => ({ value: c, label: STORAGE_CLASS_LABELS[c] }))}
                />
              </Field>
              <Field label="Máximo por endereço (un)" hint="Divide a armazenagem em várias tarefas quando excedido.">
                <Input name="maxUnitsPerLocation" type="number" min={0} step="any" defaultValue={product.max_units_per_location ?? ""} disabled={!manage} />
              </Field>
              <Field label="Zona preferencial">
                <Select
                  name="preferredZoneId"
                  defaultValue={product.preferred_zone_id ?? ""}
                  disabled={!manage}
                  placeholder="Sem preferência"
                  options={zones.filter((z) => ["storage", "picking"].includes(z.zone_type)).map((z) => ({ value: z.id, label: `${z.warehouse_code} · ${z.code} — ${z.name}` }))}
                />
              </Field>
              {manage ? <SubmitButton>Salvar parâmetros</SubmitButton> : <p className="text-xs text-slate-500">Somente administradores e supervisores alteram parâmetros.</p>}
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
