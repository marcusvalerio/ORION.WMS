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
  returnItemsForRecountAction,
  submitInventoryAction,
} from "@/server/actions/inventory";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/fields";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { HistoryList } from "@/components/wms/history";
import { fmtDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";
import { InventoryMode } from "@/components/layout/inventory-mode";
import { CountSheet } from "@/components/inventory/count-sheet";
import { plural, shortLocation } from "@/lib/inventory-rules";

const TYPE_LABEL: Record<string, string> = { general: "Geral", cyclic: "Rotativo", production_line: "Linha de produção" };
const ORIGIN_LABEL: Record<string, string> = { manual: "Aberto manualmente", calendar: "Gerado pelo calendário", trigger: "Aberto por gatilho" };

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
  const counted = inv.items.filter((i) => i.status === "counted" || i.status === "closed").length;
  const recount = inv.items.filter((i) => i.status === "recount").length;
  const diffs = inv.items.filter((i) => i.counted_qty !== null && i.expected_qty !== null && i.counted_qty !== i.expected_qty);
  const scope =
    inv.scope_label ?? ([inv.zone_code && `Zona ${inv.zone_code}`, inv.location_code, inv.sku].filter(Boolean).join(" · ") || "Depósito inteiro");

  return (
    <InventoryMode>
      <PageHeader
        title={`${inv.code} · ${TYPE_LABEL[inv.count_type] ?? inv.count_type} · ${scope}`}
        description={`${ORIGIN_LABEL[inv.origin] ?? "Aberto manualmente"} · ${plural(counted, "item contado", "itens contados")} de ${inv.items.length}${recount ? ` · ${recount} a recontar` : ""} · ${inv.lock_mode === "lock" ? "endereço bloqueado durante a contagem" : "conciliação de movimentos"}`}
        badges={
          <>
            <StatusBadge kind="inventory" status={inv.status} />
            <Badge>{TYPE_LABEL[inv.count_type] ?? inv.count_type}</Badge>
          </>
        }
        breadcrumbs={[{ label: "Operações" }, { label: "Inventário", href: "/inventario" }, { label: inv.code }]}
      />
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
              ["Escopo", scope],
              ["Progresso", `${counted} de ${inv.items.length} · ${diffs.length} com diferença${recount ? ` · ${recount} a recontar` : ""}`],
              ["Data de referência", inv.reference_date ? inv.reference_date.split("-").reverse().join("/") : "—"],
              ["Aberto por", `${inv.created_by_name} · ${fmtDateTime(inv.created_at)}`],
              ["Submetido por", inv.submitted_by_name ? `${inv.submitted_by_name} · ${fmtDateTime(inv.submitted_at)}` : "—"],
              ["Aprovado por", inv.approved_by_name ? `${inv.approved_by_name} · ${fmtDateTime(inv.approved_at)}` : "—"],
            ]}
          />
          {inv.notes ? <p className="mt-3 text-sm text-fg-2">Observações: {inv.notes}</p> : null}
          {inv.approval_notes ? <p className="mt-1 text-sm text-fg-2">Aprovação: {inv.approval_notes}</p> : null}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          <Card>
            <CardHeader
              title="Folha de contagem"
              description={
                counting
                  ? "Contagem cega: o esperado fica oculto até a submissão. Fora da tolerância, o item volta para a 2ª contagem (outro usuário) e, se divergir, para a 3ª (supervisor). Salvar não altera o saldo."
                  : "Contagem encerrada."
              }
            />
            {inv.items.length ? (
              counting && can(role, "inventory.count") ? (
                <ActionForm action={recordCountsAction}>
                  <input type="hidden" name="_id" value={id} />
                  <CountSheet items={inv.items} editable />
                </ActionForm>
              ) : (
                <CountSheet items={inv.items} />
              )
            ) : (
              <EmptyState title="Nenhum item no escopo" description="Não havia saldo no escopo selecionado. Inclua itens encontrados fisicamente, se houver." />
            )}
          </Card>

          {counting && can(role, "inventory.count") ? (
            <Disclosure title="Incluir item encontrado (não constava no sistema)">
              <ActionForm action={addInventoryItemAction} resetOnSuccess className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    {counted < inv.items.length ? (
                      <p className="mt-2 text-xs text-warn-fg">
                        Faltam {plural(inv.items.length - counted, "item", "itens")}
                        {recount ? ` (${recount} em recontagem)` : ""}.
                      </p>
                    ) : null}
                  </ActionForm>
                ) : (
                  <p className="text-sm text-muted">Contagem em andamento.</p>
                )
              ) : null}

              {inv.status === "submitted" ? (
                can(role, "inventory.approve") ? (
                  <>
                    <Alert level="warning" title={`${plural(diffs.length, "diferença", "diferenças")} a ajustar`}>
                      Diferenças dentro da tolerância da classe ABC são ajustadas automaticamente na aprovação. Item cujo saldo mudou desde a foto volta
                      para recontagem.
                    </Alert>
                    {inv.canApprove ? (
                      <ActionForm action={approveInventoryAction} confirm="Aprovar e aplicar os ajustes de estoque?" className="space-y-3">
                        <input type="hidden" name="_id" value={id} />
                        <Field label="Observação da aprovação">
                          <Input name="notes" maxLength={500} />
                        </Field>
                        <Field label="Centro de custo">
                          <Input name="costCenter" maxLength={40} />
                        </Field>
                        <SubmitButton variant="success">Aprovar e ajustar estoque</SubmitButton>
                      </ActionForm>
                    ) : (
                      <Alert level="info" title="Aprovação bloqueada">
                        {inv.blockedReason}
                      </Alert>
                    )}
                    {diffs.length ? (
                      <ActionForm action={returnItemsForRecountAction} className="space-y-3 border-t border-line pt-4">
                        <input type="hidden" name="_id" value={id} />
                        <fieldset>
                          <legend className="text-sm font-medium">Itens para recontar</legend>
                          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                            {diffs.map((i, k) => (
                              <li key={i.id}>
                                <label className="flex min-h-11 items-center gap-2 text-sm">
                                  <input type="checkbox" name={`itemIds.${k}`} value={i.id} defaultChecked className="size-4" />
                                  <span className="font-mono whitespace-nowrap" title={i.location_code}>
                                    {shortLocation({ ...i, code: i.location_code })}
                                  </span>
                                  <span className="font-mono whitespace-nowrap">{i.sku}</span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        </fieldset>
                        <Field label="Motivo da recontagem" required>
                          <Input name="notes" required minLength={5} />
                        </Field>
                        <SubmitButton variant="secondary">Devolver itens para recontagem</SubmitButton>
                      </ActionForm>
                    ) : null}
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
