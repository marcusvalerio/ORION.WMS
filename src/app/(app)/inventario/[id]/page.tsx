import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getInventory, getInventoryKpis, getInventoryMap } from "@/server/services/inventory";
import { CdMap } from "@/components/inventory/cd-map/cd-map";
import { InventoryKpiPanel } from "@/components/inventory/inventory-kpi-panel";
import { listLocations } from "@/server/services/warehouse";
import { listProductOptions } from "@/server/services/products";
import { entityHistory } from "@/server/services/audit";
import {
  addInventoryItemAction,
  approveInventoryAction,
  cancelInventoryAction,
  recordCountsAction,
  rejectInventoryAction,
  submitInventoryAction,
} from "@/server/actions/inventory";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { SuccessHero } from "@/components/ui/states";
import { Field, Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { HistoryList } from "@/components/wms/history";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";
import { cn } from "@/components/ui/cn";
import { InventoryMode } from "@/components/layout/inventory-mode";

export const metadata = { title: "Inventário" };

export default async function InventoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const inv = await getInventory(ctx, id);
  if (!inv) notFound();
  const role = ctx.user.role;
  const counting = inv.status === "counting";
  const [locations, products, history, map, kpis] = await Promise.all([
    counting && can(role, "inventory.count") ? listLocations(ctx, { warehouseId: inv.warehouse_id, pageSize: 2000 }) : Promise.resolve({ rows: [] }),
    counting && can(role, "inventory.count") ? listProductOptions(ctx) : Promise.resolve([]),
    entityHistory(ctx, "inventory", id),
    getInventoryMap(ctx, id),
    getInventoryKpis(ctx, id),
  ]);
  const counted = inv.items.filter((i) => i.counted_qty !== null).length;
  const diffs = inv.items.filter((i) => i.counted_qty !== null && i.counted_qty !== i.expected_qty);

  return (
    <InventoryMode>
      <PageHeader
        title={`Inventário ${inv.code}`}
        badges={
          <>
            <StatusBadge kind="inventory" status={inv.status} />
            <Badge>{inv.count_type === "general" ? "Geral" : "Rotativo"}</Badge>
          </>
        }
        breadcrumbs={[{ label: "Operações" }, { label: "Inventário", href: "/inventario" }, { label: inv.code }]}
      />
      {inv.status === "approved" && kpis?.accuracy != null ? (
        <SuccessHero
          value={`${kpis.accuracy.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
          title="Inventário concluído"
          detail={`${kpis.deltaPp != null ? `${kpis.deltaPp >= 0 ? "+" : ""}${kpis.deltaPp.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} pp sobre o ciclo anterior · ` : ""}${kpis.locations.total} endereços · ${kpis.divergences ?? 0} ajustes`}
        />
      ) : null}
      {map ? (
        <CdMap
          map={map}
          inventoryId={id}
          canCount={counting && can(role, "inventory.count")}
          now={map.generatedAt}
          kpiPanel={kpis ? <InventoryKpiPanel k={kpis} /> : null}
        />
      ) : null}

      <Card className="mb-5">
        <CardBody>
          <DefinitionList
            items={[
              ["Depósito", inv.warehouse_code],
              ["Escopo", [inv.zone_code && `Zona ${inv.zone_code}`, inv.location_code, inv.sku].filter(Boolean).join(" · ") || "Depósito inteiro"],
              ["Progresso", `${counted} de ${inv.items.length} itens contados · ${diffs.length} com diferença`],
              ["Aberto por", `${inv.created_by_name} · ${fmtDateTime(inv.created_at)}`],
              ["Submetido por", inv.submitted_by_name ? `${inv.submitted_by_name} · ${fmtDateTime(inv.submitted_at)}` : "—"],
              ["Aprovado por", inv.approved_by_name ? `${inv.approved_by_name} · ${fmtDateTime(inv.approved_at)}` : "—"],
            ]}
          />
          {inv.notes ? <p className="mt-3 text-sm text-fg-2">Observações: {inv.notes}</p> : null}
          {inv.approval_notes ? <p className="mt-1 text-sm text-fg-2">Aprovação: {inv.approval_notes}</p> : null}
        </CardBody>
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          <Card>
            <CardHeader
              title="Folha de contagem"
              description={counting ? "Informe a quantidade física encontrada. Salvar contagens não altera o saldo." : "Contagem encerrada."}
            />
            {inv.items.length ? (
              counting && can(role, "inventory.count") ? (
                <ActionForm action={recordCountsAction}>
                  <input type="hidden" name="_id" value={id} />
                  <CountTable items={inv.items} editable />
                  <CardBody className="flex flex-wrap gap-2 border-t border-line">
                    <SubmitButton variant="secondary">Salvar contagens</SubmitButton>
                  </CardBody>
                </ActionForm>
              ) : (
                <CountTable items={inv.items} />
              )
            ) : (
              <EmptyState title="Nenhum item no escopo" description="Não havia saldo no escopo selecionado. Inclua itens encontrados fisicamente, se houver." />
            )}
          </Card>

          {counting && can(role, "inventory.count") ? (
            <Disclosure title="Incluir item encontrado (não constava no sistema)">
              <ActionForm action={addInventoryItemAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="_id" value={id} />
                <Field label="Endereço" required>
                  <Select name="locationId" required placeholder="Selecione…" options={locations.rows.map((l) => ({ value: l.id, label: l.code }))} />
                </Field>
                <Field label="Produto" required>
                  <Select name="productId" required placeholder="Selecione…" options={products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.description}` }))} />
                </Field>
                <Field label="Lote">
                  <Input name="lotCode" maxLength={40} />
                </Field>
                <Field label="Quantidade contada" required>
                  <Input name="countedQty" type="number" min={0} step="any" required />
                </Field>
                <Field label="Observação" className="sm:col-span-2">
                  <Input name="notes" maxLength={500} />
                </Field>
                <div className="sm:col-span-2">
                  <SubmitButton variant="secondary">Incluir item</SubmitButton>
                </div>
              </ActionForm>
            </Disclosure>
          ) : null}
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Fluxo de validação" />
            <CardBody className="space-y-4">
              {counting ? (
                can(role, "inventory.count") ? (
                  <ActionForm action={submitInventoryAction} confirm="Submeter a contagem para aprovação? Não será mais possível alterar as quantidades.">
                    <input type="hidden" name="_id" value={id} />
                    <p className="mb-3 text-sm text-fg-2">Ao submeter, as diferenças viram divergências e aguardam aprovação de um supervisor.</p>
                    <SubmitButton disabled={counted < inv.items.length || inv.items.length === 0}>Submeter para aprovação</SubmitButton>
                    {counted < inv.items.length ? <p className="mt-2 text-xs text-warn-fg">Faltam {inv.items.length - counted} item(ns) a contar.</p> : null}
                  </ActionForm>
                ) : (
                  <p className="text-sm text-muted">Contagem em andamento.</p>
                )
              ) : null}

              {inv.status === "submitted" ? (
                can(role, "inventory.approve") ? (
                  <>
                    <Alert level="warning" title={`${diffs.length} diferença(s) a ajustar`}>
                      A aprovação gera movimentações de ajuste e é recusada se algum saldo tiver mudado desde a abertura da contagem.
                    </Alert>
                    <ActionForm action={approveInventoryAction} confirm="Aprovar e aplicar os ajustes de estoque?" className="space-y-3">
                      <input type="hidden" name="_id" value={id} />
                      <Field label="Observação da aprovação">
                        <Input name="notes" maxLength={500} />
                      </Field>
                      <SubmitButton variant="success">Aprovar e ajustar estoque</SubmitButton>
                    </ActionForm>
                    <ActionForm action={rejectInventoryAction} className="space-y-3 border-t border-line pt-4">
                      <input type="hidden" name="_id" value={id} />
                      <Field label="Motivo da recontagem" required>
                        <Input name="notes" required minLength={5} />
                      </Field>
                      <SubmitButton variant="secondary">Devolver para recontagem</SubmitButton>
                    </ActionForm>
                  </>
                ) : (
                  <p className="text-sm text-muted">Aguardando aprovação de um supervisor.</p>
                )
              ) : null}

              {inv.status === "approved" ? <Alert level="success">Ajustes aplicados. Consulte as movimentações do tipo ajuste com referência {inv.code}.</Alert> : null}
              {inv.status === "cancelled" ? <Alert level="warning">Inventário cancelado.</Alert> : null}

              {(counting || inv.status === "submitted") && can(role, "inventory.create") ? (
                <ActionForm action={cancelInventoryAction} confirm="Cancelar este inventário?" className="space-y-3 border-t border-line pt-4">
                  <input type="hidden" name="_id" value={id} />
                  <Field label="Motivo do cancelamento" required>
                    <Input name="reason" required minLength={5} />
                  </Field>
                  <SubmitButton variant="danger" size="sm">
                    Cancelar inventário
                  </SubmitButton>
                </ActionForm>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Histórico" />
            <HistoryList rows={history} />
          </Card>
        </div>
      </div>
    </InventoryMode>
  );
}

type Item = NonNullable<Awaited<ReturnType<typeof getInventory>>>["items"][number];

function CountTable({ items, editable }: { items: Item[]; editable?: boolean }) {
  return (
    <TableWrap>
      <table className="table-base">
        <thead>
          <tr>
            <th>Endereço</th>
            <th>Produto</th>
            <th>Lote / validade</th>
            <th className="num">Esperado</th>
            <th className={editable ? "w-32" : "num"}>Contado</th>
            <th className="num">Diferença</th>
            <th>Observação</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, idx) => {
            const diff = i.counted_qty === null ? null : i.counted_qty - i.expected_qty;
            return (
              <tr key={i.id}>
                <td className="font-mono text-[11px] whitespace-nowrap">{i.location_code}</td>
                <td>
                  <span className="font-medium">{i.sku}</span>
                  <span className="block text-xs text-muted">{i.description}</span>
                </td>
                <td className="text-xs">
                  {i.lot_code || "—"} / {fmtDate(i.expiry_date)}
                </td>
                <td className="num">{fmtQty(i.expected_qty)}</td>
                <td className={editable ? undefined : "num"}>
                  {editable ? (
                    <>
                      <input type="hidden" name={`items.${idx}.itemId`} value={i.id} />
                      <Input name={`items.${idx}.countedQty`} type="number" min={0} step="any" defaultValue={i.counted_qty ?? ""} aria-label={`Contado ${i.sku} em ${i.location_code}`} />
                    </>
                  ) : (
                    fmtQty(i.counted_qty)
                  )}
                </td>
                <td className={cn("num font-medium", diff && diff < 0 ? "text-crit-fg" : diff && diff > 0 ? "text-warn-fg" : "text-muted")}>
                  {diff === null ? "—" : `${diff > 0 ? "+" : ""}${fmtQty(diff)}`}
                  {i.adjusted ? <Badge tone="success" className="ml-1">Ajustado</Badge> : null}
                </td>
                <td>
                  {editable ? (
                    <Input name={`items.${idx}.notes`} defaultValue={i.notes ?? ""} aria-label={`Observação ${i.sku}`} />
                  ) : (
                    <span className="text-xs text-fg-2">{i.notes ?? "—"}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}
