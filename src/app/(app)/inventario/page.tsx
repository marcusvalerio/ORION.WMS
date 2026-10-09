import Link from "next/link";
import { Download } from "lucide-react";
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
          can(ctx.user.role, "reports.export") ? (
            <ButtonLink href="/api/relatorios/inventarios" size="sm" prefetch={false}>
              <Download className="size-4" /> CSV
            </ButtonLink>
          ) : null
        }
      />
      {manage ? (
        <div className="mb-5">
          <Disclosure title="Abrir nova contagem">
            <ActionForm action={createInventoryAction} className="grid gap-3 md:grid-cols-3">
              <Field label="Depósito" required>
                <Select name="warehouseId" required options={warehouses.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }))} />
              </Field>
              <Field label="Tipo" required>
                <Select
                  name="countType"
                  options={[
                    { value: "cyclic", label: "Rotativo (por zona, endereço ou produto)" },
                    { value: "general", label: "Geral (todo o depósito)" },
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
              <Field label="Observações">
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
          <TableWrap>
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
                    <td>
                      <Link href={`/inventario/${r.id}`} className="link">
                        {r.code}
                      </Link>
                    </td>
                    <td>{r.count_type === "general" ? "Geral" : "Rotativo"}</td>
                    <td>
                      <StatusBadge kind="inventory" status={r.status} />
                    </td>
                    <td>
                      {r.warehouse_code}
                      <span className="block text-xs text-slate-500">{r.scope || "Depósito inteiro"}</span>
                    </td>
                    <td className="num">{r.items}</td>
                    <td className="num">{r.counted}</td>
                    <td className="num">{r.differences ? <Badge tone="warning">{r.differences}</Badge> : "0"}</td>
                    <td>
                      {r.created_by_name}
                      <span className="block text-xs text-slate-500">{fmtDateTime(r.created_at)}</span>
                    </td>
                    <td>{fmtDateTime(r.approved_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState title="Nenhum inventário registrado" />
        )}
      </Card>
    </>
  );
}
