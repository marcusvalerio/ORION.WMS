import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { listDocks, listWaveCandidates, listWaves } from "@/server/services/waves";
import { listWarehouses } from "@/server/services/warehouse";
import { createWaveAction } from "@/server/actions/fulfillment";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DemoBadge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Field, Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Progress } from "@/components/wms/progress";
import { STATUS, WAVE_GROUPING_LABELS } from "@/lib/labels";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Ondas de separação" };

export default async function WavesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  const manage = can(ctx.user.role, "wave.manage");
  const [rows, candidates, warehouses, docks] = await Promise.all([
    listWaves(ctx, { status: params.status ?? "draft,released,picking,picked" }),
    manage ? listWaveCandidates(ctx) : Promise.resolve([]),
    manage ? listWarehouses(ctx) : Promise.resolve([]),
    manage ? listDocks(ctx) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title="Ondas de separação"
        description="Agrupe pedidos reservados por doca, transportadora, data prevista ou seleção manual. Ao liberar, as reservas são consolidadas por endereço/produto/lote em tarefas sequenciadas pelo roteiro; na doca, cada pedido é distribuído e segue para a conferência individual."
        breadcrumbs={[{ label: "Operações" }, { label: "Ondas" }]}
      />

      {manage ? (
        <Card className="mb-5">
          <CardHeader
            title="Nova onda"
            description="Doca, transportadora e data usam o planejamento informado em cada pedido. Um pedido participa de no máximo uma onda ativa."
          />
          <CardBody>
            <ActionForm action={createWaveAction} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Field label="Depósito" required>
                  <Select name="warehouseId" required options={warehouses.filter((w) => w.active).map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }))} />
                </Field>
                <Field label="Agrupar por" required>
                  <Select name="grouping" defaultValue="manual" options={Object.entries(WAVE_GROUPING_LABELS).map(([value, label]) => ({ value, label }))} />
                </Field>
                <Field label="Doca" hint="Destino dos volumes; também é o critério no agrupamento por doca.">
                  <Select name="dockLocationId" placeholder="Primeira doca ativa" options={docks.map((d) => ({ value: d.id, label: d.code }))} />
                </Field>
                <Field label="Transportadora">
                  <Input name="carrier" maxLength={120} />
                </Field>
                <Field label="Data prevista">
                  <Input name="plannedDate" type="date" />
                </Field>
              </div>
              {candidates.length ? (
                <TableWrap>
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th className="w-10">
                          <span className="sr-only">Selecionar</span>
                        </th>
                        <th>Pedido</th>
                        <th>Cliente</th>
                        <th>Prioridade</th>
                        <th>Transportadora</th>
                        <th>Data prevista</th>
                        <th>Doca</th>
                        <th className="num">Quantidade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((o, i) => (
                        <tr key={o.id}>
                          <td>
                            <input type="checkbox" name={`orderIds.${i}`} value={o.id} aria-label={`Selecionar ${o.code}`} className="size-4" />
                          </td>
                          <td>
                            <Link href={`/separacao/${o.id}`} className="link">
                              {o.code}
                            </Link>
                          </td>
                          <td>{o.customer_name}</td>
                          <td>
                            <PriorityBadge priority={o.priority} />
                          </td>
                          <td>{o.carrier ?? "—"}</td>
                          <td>{fmtDate(o.planned_ship_date)}</td>
                          <td className="font-mono text-[11px]">{o.staging_code ?? "—"}</td>
                          <td className="num">{fmtQty(o.requested)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              ) : (
                <p className="text-sm text-slate-500">Nenhum pedido reservado fora de onda. Reserve pedidos em Separação para montar ondas.</p>
              )}
              <p className="text-xs text-slate-500">Na seleção manual, marque os pedidos. Nos demais critérios, entram todos os pedidos reservados que atendem ao valor informado.</p>
              <SubmitButton>Criar onda</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <FilterBar resetHref="/ondas">
          <FilterField label="Status" className="w-full sm:w-56">
            <Select
              name="status"
              defaultValue={params.status}
              placeholder="Em andamento"
              options={[
                { value: Object.keys(STATUS.wave).join(","), label: "Todas" },
                ...Object.entries(STATUS.wave).map(([v, s]) => ({ value: v, label: s.label })),
              ]}
            />
          </FilterField>
        </FilterBar>
        {rows.length ? (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Onda</th>
                  <th>Status</th>
                  <th>Agrupamento</th>
                  <th>Doca</th>
                  <th className="num">Pedidos</th>
                  <th>Progresso</th>
                  <th>Criada</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/ondas/${w.id}`} className="link">
                        {w.code}
                      </Link>{" "}
                      {w.is_demo ? <DemoBadge /> : null}
                    </td>
                    <td>
                      <StatusBadge kind="wave" status={w.status} />
                    </td>
                    <td>
                      {WAVE_GROUPING_LABELS[w.grouping]}
                      {w.grouping_value ? <span className="block text-xs text-slate-500">{w.grouping_value}</span> : null}
                    </td>
                    <td className="font-mono text-[11px]">{w.dock_code}</td>
                    <td className="num">{w.orders}</td>
                    <td className="min-w-[140px]">
                      <Progress done={w.tasks_done} total={w.tasks_total} />
                    </td>
                    <td>{fmtDateTime(w.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState title="Nenhuma onda encontrada" description="Crie uma onda a partir de pedidos reservados." />
        )}
      </Card>
    </>
  );
}
