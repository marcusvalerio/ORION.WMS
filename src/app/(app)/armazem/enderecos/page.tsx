import Link from "next/link";
import { Plus } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { listLocations, listWarehouses, listZones, LOCATION_STATUSES, LOCATION_TYPES, STORAGE_CLASSES } from "@/server/services/warehouse";
import { createLocationAction } from "@/server/actions/warehouse";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { OccupancyBar } from "@/components/ui/occupancy";
import { EmptyState } from "@/components/ui/empty-state";
import { Disclosure } from "@/components/ui/disclosure";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Field, Input, Select } from "@/components/ui/fields";
import { Pagination, SortTh, TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { LOCATION_TYPE_LABELS, STATUS, STORAGE_CLASS_LABELS, ZONE_TYPE_LABELS } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { isUuid, pageNumber, readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Endereços" };

export default async function LocationsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  const [warehouses, zones, result] = await Promise.all([
    listWarehouses(ctx),
    listZones(ctx),
    listLocations(ctx, {
      warehouseId: isUuid(params.warehouseId) ? params.warehouseId : null,
      zoneId: isUuid(params.zoneId) ? params.zoneId : null,
      status: params.status,
      type: params.type,
      occupancy: params.occupancy as "empty" | "occupied" | "full" | undefined,
      q: params.q,
      sort: params.sort,
      page: pageNumber(params.page),
    }),
  ]);
  const manage = can(ctx.user.role, "warehouse.manage");

  return (
    <>
      <PageHeader
        title="Endereços"
        description="Posições físicas no formato DEPÓSITO/RUA/MÓDULO/NÍVEL/POSIÇÃO, com capacidade, compatibilidade e ocupação atual."
        breadcrumbs={[{ label: "Armazém" }, { label: "Endereços" }]}
      />
      {manage ? (
        <div className="mb-4">
          <Disclosure title="Cadastrar endereço" icon={<Plus className="size-4 text-slate-400" />}>
            <ActionForm action={createLocationAction} resetOnSuccess className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
              <Field label="Zona" required className="col-span-2">
                <Select name="zoneId" required options={zones.map((z) => ({ value: z.id, label: `${z.warehouse_code} · ${z.code} — ${z.name}` }))} />
              </Field>
              <Field label="Rua" required>
                <Input name="aisle" required maxLength={6} placeholder="01" />
              </Field>
              <Field label="Módulo" required>
                <Input name="bay" required maxLength={6} placeholder="01" />
              </Field>
              <Field label="Nível" required>
                <Input name="level" required maxLength={6} placeholder="01" />
              </Field>
              <Field label="Posição" required>
                <Input name="position" required maxLength={6} placeholder="00" />
              </Field>
              <Field label="Tipo">
                <Select name="locationType" options={LOCATION_TYPES.map((t) => ({ value: t, label: LOCATION_TYPE_LABELS[t] }))} />
              </Field>
              <Field label="Classe">
                <Select name="storageClass" options={STORAGE_CLASSES.map((c) => ({ value: c, label: STORAGE_CLASS_LABELS[c] }))} />
              </Field>
              <Field label="Capacidade (un)" required>
                <Input name="capacityUnits" type="number" min={1} step="any" required />
              </Field>
              <Field label="Peso máx. (kg)">
                <Input name="maxWeightKg" type="number" min={0} step="any" />
              </Field>
              <Field label="Observações" className="col-span-2">
                <Input name="notes" maxLength={500} />
              </Field>
              <div className="col-span-2 flex items-end md:col-span-4 xl:col-span-8">
                <SubmitButton>Cadastrar endereço</SubmitButton>
              </div>
            </ActionForm>
          </Disclosure>
        </div>
      ) : null}
      <Card>
        <FilterBar resetHref="/armazem/enderecos">
          <FilterField label="Buscar código">
            <Input name="q" defaultValue={params.q} placeholder="RUA-01, MOD-02…" />
          </FilterField>
          <FilterField label="Depósito">
            <Select name="warehouseId" defaultValue={params.warehouseId} placeholder="Todos" options={warehouses.map((w) => ({ value: w.id, label: w.code }))} />
          </FilterField>
          <FilterField label="Zona">
            <Select name="zoneId" defaultValue={params.zoneId} placeholder="Todas" options={zones.map((z) => ({ value: z.id, label: `${z.warehouse_code} · ${z.code}` }))} />
          </FilterField>
          <FilterField label="Status" className="w-full sm:w-36">
            <Select name="status" defaultValue={params.status} placeholder="Todos" options={LOCATION_STATUSES.map((s) => ({ value: s, label: STATUS.location[s].label }))} />
          </FilterField>
          <FilterField label="Tipo" className="w-full sm:w-40">
            <Select name="type" defaultValue={params.type} placeholder="Todos" options={LOCATION_TYPES.map((t) => ({ value: t, label: LOCATION_TYPE_LABELS[t] }))} />
          </FilterField>
          <FilterField label="Ocupação" className="w-full sm:w-36">
            <Select
              name="occupancy"
              defaultValue={params.occupancy}
              placeholder="Todas"
              options={[
                { value: "empty", label: "Vazios" },
                { value: "occupied", label: "Ocupados" },
                { value: "full", label: "Lotados" },
              ]}
            />
          </FilterField>
        </FilterBar>
        {result.rows.length ? (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <SortTh label="Código" field="code" current={params.sort ?? "code"} params={params} />
                  <SortTh label="Zona" field="zone" current={params.sort} params={params} />
                  <th>Tipo</th>
                  <th>Classe</th>
                  <th>Status</th>
                  <th className="num">SKUs</th>
                  <SortTh label="Ocupação" field="occupancy" current={params.sort} params={params} descFirst />
                </tr>
              </thead>
              <tbody>
                {result.rows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/armazem/enderecos/${l.id}`} className="link font-mono text-xs">
                        {l.code}
                      </Link>
                    </td>
                    <td>
                      <span className="code">{l.zone_code}</span> <span className="text-xs text-slate-500">{ZONE_TYPE_LABELS[l.zone_type]}</span>
                    </td>
                    <td>{LOCATION_TYPE_LABELS[l.location_type]}</td>
                    <td>{l.storage_class ? STORAGE_CLASS_LABELS[l.storage_class] : "Geral"}</td>
                    <td>
                      <StatusBadge kind="location" status={l.status} />
                    </td>
                    <td className="num">{l.sku_count}</td>
                    <td>
                      <OccupancyBar used={l.occupied} capacity={l.capacity_units} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState title="Nenhum endereço encontrado" description="Ajuste os filtros ou cadastre novos endereços." />
        )}
        <Pagination page={result.page} pageSize={result.pageSize} total={result.total} params={params} />
      </Card>
    </>
  );
}
