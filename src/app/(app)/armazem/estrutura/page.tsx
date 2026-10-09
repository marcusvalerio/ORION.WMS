import Link from "next/link";
import { Plus } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { getStructureTree, listWarehouses, listZones, ZONE_TYPES, LOCATION_TYPES, STORAGE_CLASSES } from "@/server/services/warehouse";
import { createWarehouseAction, createZoneAction, generateLocationsAction, toggleWarehouseAction, toggleZoneAction } from "@/server/actions/warehouse";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OccupancyBar } from "@/components/ui/occupancy";
import { EmptyState } from "@/components/ui/empty-state";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { LOCATION_TYPE_LABELS, STORAGE_CLASS_LABELS, ZONE_TYPE_LABELS } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { readParams, type SearchParams } from "@/lib/params";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Estrutura física" };

export default async function StructurePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  const warehouses = await listWarehouses(ctx);
  const current = warehouses.find((w) => w.id === params.wh) ?? warehouses[0];
  const [zones, tree] = current ? await Promise.all([listZones(ctx, current.id), getStructureTree(ctx, current.id)]) : [[], []];
  const manage = can(ctx.user.role, "warehouse.manage");
  const zonesById = Object.groupBy(tree, (t) => t.zone_id);

  return (
    <>
      <PageHeader
        title="Estrutura física"
        description="Depósitos, zonas operacionais, ruas e endereços. A ocupação considera o estoque físico frente à capacidade em unidades de cada endereço."
        breadcrumbs={[{ label: "Armazém" }, { label: "Estrutura física" }]}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {warehouses.map((w) => (
          <Link
            key={w.id}
            href={`?wh=${w.id}`}
            className={cn(
              "rounded-lg border bg-white p-4 shadow-xs transition-colors",
              w.id === current?.id ? "border-brand-400 ring-2 ring-brand-100" : "border-slate-200 hover:border-brand-300",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="code">{w.code}</span>
              {w.active ? <Badge tone="success">Ativo</Badge> : <Badge>Inativo</Badge>}
            </div>
            <p className="mt-1 font-medium text-slate-900">{w.name}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {w.zone_count} zonas · {w.active_locations}/{w.location_count} endereços ativos
            </p>
            <OccupancyBar used={w.occupied} capacity={w.capacity} className="mt-3" />
          </Link>
        ))}
        {!warehouses.length ? (
          <Card className="sm:col-span-2 xl:col-span-4">
            <EmptyState title="Nenhum depósito cadastrado" description="Cadastre o primeiro depósito para montar a estrutura física." />
          </Card>
        ) : null}
      </div>

      {current ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <CardHeader
              title={`Mapa estrutural — ${current.code} ${current.name}`}
              description="Zona → rua, com status dos endereços e ocupação agregada. Clique para ver os endereços."
              actions={
                manage ? (
                  <ActionForm action={toggleWarehouseAction} confirm={current.active ? "Desativar este depósito?" : undefined}>
                    <input type="hidden" name="_id" value={current.id} />
                    <input type="hidden" name="active" value={String(!current.active)} />
                    <SubmitButton size="sm" variant="secondary">
                      {current.active ? "Desativar depósito" : "Ativar depósito"}
                    </SubmitButton>
                  </ActionForm>
                ) : null
              }
            />
            {zones.length ? (
              <div className="divide-y divide-slate-100">
                {zones.map((z) => (
                  <div key={z.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="code">{z.code}</span>
                        <span className="text-sm font-medium text-slate-800">{z.name}</span>
                        <Badge tone="info">{ZONE_TYPE_LABELS[z.zone_type]}</Badge>
                        {!z.active ? <Badge>Inativa</Badge> : null}
                      </div>
                      <div className="flex items-center gap-3">
                        <OccupancyBar used={z.occupied} capacity={z.capacity} />
                        {manage ? (
                          <ActionForm action={toggleZoneAction} confirm={z.active ? `Desativar a zona ${z.code}? Seus endereços deixam de receber armazenagem e reservas.` : undefined}>
                            <input type="hidden" name="_id" value={z.id} />
                            <input type="hidden" name="active" value={String(!z.active)} />
                            <SubmitButton size="sm" variant="ghost">
                              {z.active ? "Desativar" : "Ativar"}
                            </SubmitButton>
                          </ActionForm>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {(zonesById[z.id] ?? []).map((a) => (
                        <Link
                          key={a.aisle}
                          href={`/armazem/enderecos?zoneId=${z.id}&q=RUA-${a.aisle}`}
                          className="rounded-md border border-slate-200 px-3 py-2 hover:border-brand-300 hover:bg-brand-50/40"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-slate-700">Rua {a.aisle}</span>
                            <span className="text-slate-500">{a.locations} end.</span>
                          </div>
                          <div className="mt-1 flex gap-2 text-[11px] text-slate-500">
                            <span className="text-emerald-700">{a.active} ativos</span>
                            {a.blocked ? <span className="text-amber-700">{a.blocked} bloq.</span> : null}
                            {a.inactive ? <span>{a.inactive} inat.</span> : null}
                          </div>
                          <OccupancyBar used={a.occupied} capacity={a.capacity} showLabel={false} className="mt-1.5" />
                        </Link>
                      ))}
                      {!zonesById[z.id] ? <p className="text-xs text-slate-500">Nenhum endereço nesta zona.</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Nenhuma zona cadastrada" description="Cadastre zonas (armazenagem, expedição, quarentena…) para criar endereços." />
            )}
          </Card>

          <div className="space-y-4 xl:col-span-2">
            <Card>
              <CardHeader title="Zonas" />
              <TableWrap>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Tipo</th>
                      <th className="num">Endereços</th>
                      <th className="num">Capacidade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {zones.map((z) => (
                      <tr key={z.id}>
                        <td>
                          <Link href={`/armazem/enderecos?zoneId=${z.id}`} className="link">
                            {z.code}
                          </Link>
                        </td>
                        <td>{ZONE_TYPE_LABELS[z.zone_type]}</td>
                        <td className="num">{z.location_count}</td>
                        <td className="num">{z.capacity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>

            {manage ? (
              <>
                <Disclosure title="Gerar endereços em lote" icon={<Plus className="size-4 text-slate-400" />}>
                  <ActionForm action={generateLocationsAction} className="grid grid-cols-2 gap-3">
                    <Field label="Zona" required className="col-span-2">
                      <Select name="zoneId" required options={zones.map((z) => ({ value: z.id, label: `${z.code} — ${z.name}` }))} />
                    </Field>
                    <Field label="Rua" required>
                      <Input name="aisle" required maxLength={6} placeholder="05" />
                    </Field>
                    <Field label="Posições por nível" required>
                      <Input name="positions" type="number" min={1} max={10} defaultValue={1} required />
                    </Field>
                    <Field label="Módulo inicial">
                      <Input name="bayFrom" type="number" min={0} max={99} defaultValue={1} />
                    </Field>
                    <Field label="Módulo final">
                      <Input name="bayTo" type="number" min={0} max={99} defaultValue={4} />
                    </Field>
                    <Field label="Nível inicial">
                      <Input name="levelFrom" type="number" min={0} max={20} defaultValue={1} />
                    </Field>
                    <Field label="Nível final">
                      <Input name="levelTo" type="number" min={0} max={20} defaultValue={3} />
                    </Field>
                    <Field label="Tipo">
                      <Select name="locationType" options={LOCATION_TYPES.map((t) => ({ value: t, label: LOCATION_TYPE_LABELS[t] }))} />
                    </Field>
                    <Field label="Classe">
                      <Select name="storageClass" options={STORAGE_CLASSES.map((c) => ({ value: c, label: STORAGE_CLASS_LABELS[c] }))} />
                    </Field>
                    <Field label="Capacidade (un) por endereço" required className="col-span-2">
                      <Input name="capacityUnits" type="number" min={1} step="any" defaultValue={100} required />
                    </Field>
                    <div className="col-span-2">
                      <SubmitButton>Gerar endereços</SubmitButton>
                    </div>
                  </ActionForm>
                </Disclosure>
                <Disclosure title="Nova zona" icon={<Plus className="size-4 text-slate-400" />}>
                  <ActionForm action={createZoneAction} resetOnSuccess className="grid grid-cols-2 gap-3">
                    <input type="hidden" name="warehouseId" value={current.id} />
                    <Field label="Código" required>
                      <Input name="code" required maxLength={20} placeholder="PCK" />
                    </Field>
                    <Field label="Tipo" required>
                      <Select name="zoneType" options={ZONE_TYPES.map((t) => ({ value: t, label: ZONE_TYPE_LABELS[t] }))} />
                    </Field>
                    <Field label="Nome" required className="col-span-2">
                      <Input name="name" required maxLength={80} placeholder="Picking fracionado" />
                    </Field>
                    <div className="col-span-2">
                      <SubmitButton>Cadastrar zona</SubmitButton>
                    </div>
                  </ActionForm>
                </Disclosure>
                <Disclosure title="Novo depósito" icon={<Plus className="size-4 text-slate-400" />}>
                  <ActionForm action={createWarehouseAction} resetOnSuccess className="grid grid-cols-2 gap-3">
                    <Field label="Código" required>
                      <Input name="code" required maxLength={20} placeholder="DEP-02" />
                    </Field>
                    <Field label="Nome" required>
                      <Input name="name" required maxLength={120} />
                    </Field>
                    <Field label="Endereço" className="col-span-2">
                      <Input name="address" maxLength={300} />
                    </Field>
                    <div className="col-span-2">
                      <SubmitButton>Cadastrar depósito</SubmitButton>
                    </div>
                  </ActionForm>
                </Disclosure>
              </>
            ) : (
              <Card>
                <CardBody className="text-sm text-slate-500">Somente administradores e supervisores alteram a estrutura física.</CardBody>
              </Card>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
