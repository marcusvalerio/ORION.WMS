import { Printer, Tag } from "lucide-react";
import type { Ctx } from "@/server/context";
import { getPackingList } from "@/server/services/comex";
import {
  addExportPackageAction,
  finishPackingAction,
  removeExportPackageAction,
  saveOrderExportAction,
  stuffContainerAction,
} from "@/server/actions/comex";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Checkbox, Field, Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { INCOTERMS_2020 } from "@/lib/comex";
import { PACKAGE_TYPE_LABELS } from "@/lib/labels";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";

/** Exportação do pedido: dados, volumes (packing list), fechamento e estufagem. */
export async function ExportCard({ ctx, orderId }: { ctx: Ctx; orderId: string }) {
  const list = await getPackingList(ctx, orderId);
  if (!list) return null;
  const { order, packages, totals, pending } = list;
  const role = ctx.user.role;
  const closed = ["shipped", "cancelled"].includes(order.status);
  const canEdit = can(role, "comex.manage") && !closed && !order.packed_at;
  if (!order.is_export && !canEdit) return null;
  const packable = order.is_export && ["picked", "checked"].includes(order.status) && !order.packed_at && can(role, "export.pack");

  return (
    <Card>
      <CardHeader
        title="Exportação"
        description="Incoterm, destino, invoice e RE/DU-E; volumes com pesos e dimensões; packing list bilíngue e estufagem."
        actions={
          order.is_export ? (
            <>
              {order.packed_at ? <Badge tone="success">Packing list fechado</Badge> : <Badge tone="warning">Packing list aberto</Badge>}
              {packages.length ? (
                <>
                  <ButtonLink href={`/etiquetas/packing-list/${orderId}`} variant="secondary" size="sm">
                    <Printer className="size-4" aria-hidden /> Packing list
                  </ButtonLink>
                  <ButtonLink href={`/etiquetas/volumes/${orderId}`} variant="secondary" size="sm">
                    <Tag className="size-4" aria-hidden /> Etiquetas de volume
                  </ButtonLink>
                </>
              ) : null}
            </>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        {order.is_export ? (
          <DefinitionList
            items={[
              ["Incoterm", order.export_incoterm],
              ["País de destino", order.destination_country],
              ["Fatura comercial (invoice)", order.commercial_invoice],
              ["RE / DU-E", order.export_declaration],
              ["Volumes", `${totals.packages} · ${fmtQty(totals.grossWeightKg)} kg brutos · ${fmtQty(totals.netWeightKg)} kg líquidos · ${totals.volumeM3} m³`],
              ["Contêiner / lacre", order.container_number ? `${order.container_number} · lacre ${order.seal_number} (${fmtDateTime(order.stuffed_at)})` : null],
            ]}
          />
        ) : (
          <p className="text-sm text-slate-500">Pedido nacional. Marque como exportação para montar volumes e emitir o packing list.</p>
        )}

        {canEdit ? (
          <Disclosure title={order.is_export ? "Alterar dados de exportação" : "Marcar como exportação"}>
            <ActionForm action={saveOrderExportAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="_id" value={orderId} />
              <div className="sm:col-span-2">
                <Checkbox name="isExport" defaultChecked label="Pedido de exportação" />
              </div>
              <Field label="Incoterm">
                <Select name="incoterm" defaultValue={order.export_incoterm ?? ""} placeholder="—" options={INCOTERMS_2020.map((i) => ({ value: i.code, label: i.label }))} />
              </Field>
              <Field label="País de destino" required hint="ISO 3166 alfa-2 (ex.: US)">
                <Input name="destinationCountry" defaultValue={order.destination_country ?? ""} maxLength={2} className="uppercase" />
              </Field>
              <Field label="Fatura comercial (invoice)">
                <Input name="commercialInvoice" defaultValue={order.commercial_invoice ?? ""} maxLength={40} />
              </Field>
              <Field label="RE / DU-E">
                <Input name="exportDeclaration" defaultValue={order.export_declaration ?? ""} maxLength={40} />
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton size="sm">Salvar exportação</SubmitButton>
              </div>
            </ActionForm>
          </Disclosure>
        ) : null}

        {order.is_export && packages.length ? (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Volume</th>
                  <th>Itens</th>
                  <th className="num">Bruto (kg)</th>
                  <th className="num">Líquido (kg)</th>
                  <th>Dimensões (cm)</th>
                  {packable ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">
                      {p.package_no} · {PACKAGE_TYPE_LABELS[p.package_type] ?? p.package_type}
                    </td>
                    <td className="text-xs">
                      {p.items.map((i) => (
                        <span key={`${i.order_line_id}${i.lot_code}`} className="block">
                          {i.sku} {i.lot_code ? `lote ${i.lot_code}` : ""} — {fmtQty(i.quantity)} {i.uom}
                        </span>
                      ))}
                    </td>
                    <td className="num">{fmtQty(p.gross_weight_kg)}</td>
                    <td className="num">{fmtQty(p.net_weight_kg)}</td>
                    <td className="whitespace-nowrap">
                      {fmtQty(p.length_cm)} × {fmtQty(p.width_cm)} × {fmtQty(p.height_cm)}
                    </td>
                    {packable ? (
                      <td>
                        <ActionForm action={removeExportPackageAction} confirm={`Remover o volume ${p.package_no}?`}>
                          <input type="hidden" name="_id" value={p.id} />
                          <SubmitButton size="sm" variant="ghost">
                            Remover
                          </SubmitButton>
                        </ActionForm>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : null}

        {packable && pending.length ? (
          <Disclosure title="Incluir volume" defaultOpen>
            <ActionForm action={addExportPackageAction} className="space-y-3" resetOnSuccess>
              <input type="hidden" name="_id" value={orderId} />
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Field label="Tipo">
                  <Select name="packageType" defaultValue="box" options={Object.entries(PACKAGE_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
                </Field>
                <Field label="Peso bruto (kg)" required>
                  <Input name="grossWeightKg" type="number" min={0} step="any" required />
                </Field>
                <Field label="Peso líquido (kg)" required>
                  <Input name="netWeightKg" type="number" min={0} step="any" required />
                </Field>
                <Field label="Compr. (cm)" required>
                  <Input name="lengthCm" type="number" min={0} step="any" required />
                </Field>
                <Field label="Largura (cm)" required>
                  <Input name="widthCm" type="number" min={0} step="any" required />
                </Field>
                <Field label="Altura (cm)" required>
                  <Input name="heightCm" type="number" min={0} step="any" required />
                </Field>
              </div>
              <TableWrap>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th>Produto / lote</th>
                      <th className="num">A embalar</th>
                      <th>Quantidade neste volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((p, idx) => (
                      <tr key={`${p.order_line_id}${p.lot_code}`}>
                        <td>{p.line_no}</td>
                        <td>
                          {p.sku} {p.lot_code ? <span className="text-xs text-slate-500">lote {p.lot_code}</span> : null}
                        </td>
                        <td className="num">{fmtQty(p.pending)}</td>
                        <td>
                          <input type="hidden" name={`items.${idx}.orderLineId`} value={p.order_line_id} />
                          <input type="hidden" name={`items.${idx}.lotCode`} value={p.lot_code} />
                          <Input name={`items.${idx}.quantity`} type="number" min={0} max={p.pending} step="any" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <SubmitButton size="sm">Incluir volume</SubmitButton>
            </ActionForm>
          </Disclosure>
        ) : null}

        {packable && packages.length && pending.length === 0 ? (
          <ActionForm action={finishPackingAction} confirm="Fechar o packing list? Os volumes não poderão mais ser alterados.">
            <input type="hidden" name="_id" value={orderId} />
            <SubmitButton>Fechar packing list</SubmitButton>
          </ActionForm>
        ) : null}

        {order.is_export && !order.packed_at && order.status === "checked" ? (
          <Alert level="warning">A expedição deste pedido exige o packing list fechado.</Alert>
        ) : null}

        {order.is_export && order.packed_at && !order.stuffed_at && !closed && can(role, "export.pack") ? (
          <ActionForm action={stuffContainerAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="_id" value={orderId} />
            <Field label="Contêiner (ISO 6346)" required>
              <Input name="containerNumber" required maxLength={13} className="uppercase" />
            </Field>
            <Field label="Lacre" required>
              <Input name="sealNumber" required maxLength={30} />
            </Field>
            <SubmitButton size="sm">Registrar estufagem</SubmitButton>
          </ActionForm>
        ) : null}
      </CardBody>
    </Card>
  );
}
