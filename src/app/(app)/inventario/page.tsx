import Link from "next/link";
import { CalendarDays, Download } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { listInventories } from "@/server/services/inventory";
import { listLocations, listWarehouses, listZones } from "@/server/services/warehouse";
import { listProductOptions } from "@/server/services/products";
import { createInventoryAction } from "@/server/actions/inventory";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { fmtDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";

export const metadata = { title: "Inventário" };

const TYPE_LABEL: Record<string, string> = { general: "Geral", cyclic: "Rotativo", production_line: "Linha de produção" };

export default async function InventoryListPage() {
  const ctx = await requireCtx();
  const manage = can(ctx.user.role, "inventory.create");
  const [rows, warehouses, zones, locations, products] = await Promise.all([
    listInventories(ctx),
    manage ? listWarehouses(ctx) : Promise.resolve([]),
    manage ? listZones(ctx) : Promise.resolve([]),
    manage ? listLocations(ctx, { pageSize: 2000 }) : Promise.resolve({ rows: [] }),
    manage ? listProductOptions(ctx) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader
        title="Inventário"
        description="Contagens gerais ou rotativas. O saldo esperado é registrado na abertura; a contagem não altera estoque — os ajustes só ocorrem após aprovação de um supervisor."
        breadcrumbs={[{ label: "Operações" }, { label: "Inventário" }]}
        actions={
          <>
            {manage ? (
              <ButtonLink href="/inventario/calendario" size="sm" variant="secondary">
                <CalendarDays className="size-4" aria-hidden /> Calendário
              </ButtonLink>
            ) : null}
            {can(ctx.user.role, "reports.export") ? (
              <ButtonLink href="/api/relatorios/inventarios" size="sm" prefetch={false}>
                <Download className="size-4" aria-hidden /> Baixar CSV
              </ButtonLink>
            ) : null}
          </>
        }
      />
      {manage ? (
        <div className="mb-5">
          <Disclosure title="Abrir nova contagem">
            <ActionForm action={createInventoryAction} className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Depósito" required>
                <Select name="warehouseId" required options={warehouses.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }))} />
              </Field>
              <Field label="Tipo" required>
                <Select
                  name="countType"
                  options={[
                    { value: "cyclic", label: "Rotativo (por zona, endereço ou produto)" },
                    { value: "general", label: "Geral (todo o depósito)" },
                    { value: "production_line", label: "Linha de produção (WIP)" },
                  ]}
                />
              </Field>
              <Field label="Zona">
                <Select name="zoneId" placeholder="Todas" options={zones.map((z) => ({ value: z.id, label: `${z.warehouse_code} · ${z.code} — ${z.name}` }))} />
              </Field>
              <Field label="Endereço">
                <Select name="locationId" placeholder="Todos" options={locations.rows.map((l) => ({ value: l.id, label: l.code }))} />
              </Field>
              <Field label="Produto">
                <Select name="productId" placeholder="Todos" options={products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.description}` }))} />
              </Field>
              <Field label="Data de referência (fechamento)">
                <Input name="referenceDate" type="date" lang="pt-BR" />
              </Field>
              <Field label="Observações" className="md:col-span-2">
                <Input name="notes" maxLength={500} />
              </Field>
              <div className="md:col-span-3">
                <SubmitButton>Abrir contagem</SubmitButton>
              </div>
            </ActionForm>
          </Disclosure>
        </div>
      ) : null}
      <Card>
        <CardHeader title="Sessões de inventário" />
        {rows.length ? (
          <>
            <ul className="divide-y divide-line md:hidden">
              {rows.map((r) => (
                <li key={r.id} className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/inventario/${r.id}`} className="link font-mono whitespace-nowrap">
                      {r.code}
                    </Link>
                    <StatusBadge kind="inventory" status={r.status} />
                  </div>
                  <p className="mt-1 text-sm">
                    {TYPE_LABEL[r.count_type] ?? r.count_type} · <span className="font-mono whitespace-nowrap">{r.warehouse_code}</span>
                  </p>
                  <p className="text-xs text-muted">{r.scope}</p>
                  <p className="mt-2 text-sm tabular-nums">
                    {r.counted} de {r.items} contados ·{" "}
                    {r.differences ? <span className="text-crit-fg">{r.differences} com diferença</span> : <span className="text-muted">0 com diferença</span>}
                  </p>
                </li>
              ))}
            </ul>
            <TableWrap className="hidden md:block">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Tipo</th>
                    <th>Status</th>
                    <th>Depósito / escopo</th>
                    <th className="num">Itens</th>
                    <th className="num">Contados</th>
                    <th className="num">Com diferença</th>
                    <th>Aberto por</th>
                    <th>Aprovado em</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">
                        <Link href={`/inventario/${r.id}`} className="link font-mono">
                          {r.code}
                        </Link>
                      </td>
                      <td>{TYPE_LABEL[r.count_type] ?? r.count_type}</td>
                      <td>
                        <StatusBadge kind="inventory" status={r.status} />
                      </td>
                      <td>
                        <span className="font-mono whitespace-nowrap">{r.warehouse_code}</span>
                        <span className="block text-xs text-muted">{r.scope}</span>
                      </td>
                      <td className="num">{r.items}</td>
                      <td className="num">{r.counted}</td>
                      <td className="num">{r.differences ? <Badge tone="danger">{r.differences}</Badge> : <span className="text-muted">0</span>}</td>
                      <td>
                        {r.created_by_name}
                        <span className="block text-xs text-muted">{fmtDateTime(r.created_at)}</span>
                      </td>
                      <td className="whitespace-nowrap">{fmtDateTime(r.approved_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </>
        ) : (
          <EmptyState title="Nenhum inventário registrado" />
        )}
      </Card>
    </>
  );
}
