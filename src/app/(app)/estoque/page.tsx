import Link from "next/link";
import { ArrowLeftRight, Download, SlidersHorizontal } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { listStock } from "@/server/services/stock";
import { listWarehouses } from "@/server/services/warehouse";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/fields";
import { Pagination, SortTh, TableWrap } from "@/components/ui/table";
import { ZONE_TYPE_LABELS } from "@/lib/labels";
import { fmtDate, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid, pageNumber, readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Estoque" };

export default async function StockPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  const filters = {
    q: params.q,
    warehouseId: isUuid(params.warehouseId) ? params.warehouseId : null,
    lot: params.lot,
    expiryBefore: params.expiryBefore,
    status: params.status as "available" | "reserved" | "blocked" | "expired" | undefined,
  };
  const [warehouses, result] = await Promise.all([
    listWarehouses(ctx),
    listStock(ctx, { ...filters, sort: params.sort, page: pageNumber(params.page) }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const exportQs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
  const total = result.totals;

  return (
    <>
      <PageHeader
        title="Estoque"
        description="Saldos por endereço, produto e lote. Disponível = físico − reservado − bloqueado. Saldos só mudam por movimentações registradas."
        breadcrumbs={[{ label: "Armazém" }, { label: "Estoque" }]}
        actions={
          <>
            {can(ctx.user.role, "stock.transfer") ? (
              <ButtonLink href="/estoque/transferir" size="sm" variant="primary">
                <ArrowLeftRight className="size-4" /> Transferir
              </ButtonLink>
            ) : null}
            {can(ctx.user.role, "stock.adjust") ? (
              <ButtonLink href="/estoque/ajuste" size="sm">
                <SlidersHorizontal className="size-4" /> Ajuste manual
              </ButtonLink>
            ) : null}
            {can(ctx.user.role, "reports.export") ? (
              <ButtonLink href={`/api/relatorios/estoque?${exportQs}`} size="sm" prefetch={false}>
                <Download className="size-4" /> CSV
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Estoque físico", total.quantity, "text-slate-900"],
          ["Reservado", total.reserved, "text-sky-700"],
          ["Bloqueado", total.blocked, "text-amber-700"],
          ["Disponível", total.available, "text-emerald-700"],
        ].map(([label, value, color]) => (
          <div key={label as string} className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-xs">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`mt-0.5 text-xl font-semibold tabular-nums ${color}`}>{fmtQty(value as number)}</p>
          </div>
        ))}
      </div>
      <Card>
        <FilterBar resetHref="/estoque">
          <FilterField label="Produto ou endereço" className="w-full sm:w-64">
            <Input name="q" defaultValue={params.q} placeholder="SKU, descrição ou código do endereço" />
          </FilterField>
          <FilterField label="Depósito" className="w-full sm:w-36">
            <Select name="warehouseId" defaultValue={params.warehouseId} placeholder="Todos" options={warehouses.map((w) => ({ value: w.id, label: w.code }))} />
          </FilterField>
          <FilterField label="Lote" className="w-full sm:w-36">
            <Input name="lot" defaultValue={params.lot} />
          </FilterField>
          <FilterField label="Validade até" className="w-full sm:w-40">
            <Input name="expiryBefore" type="date" defaultValue={params.expiryBefore} />
          </FilterField>
          <FilterField label="Situação" className="w-full sm:w-40">
            <Select
              name="status"
              defaultValue={params.status}
              placeholder="Todas"
              options={[
                { value: "available", label: "Com disponível" },
                { value: "reserved", label: "Com reserva" },
                { value: "blocked", label: "Bloqueado" },
                { value: "expired", label: "Vencido" },
              ]}
            />
          </FilterField>
        </FilterBar>
        {result.rows.length ? (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <SortTh label="Endereço" field="location" current={params.sort ?? "location"} params={params} />
                  <SortTh label="Produto" field="product" current={params.sort} params={params} />
                  <th>Lote</th>
                  <SortTh label="Validade" field="expiry" current={params.sort} params={params} />
                  <SortTh label="Físico" field="quantity" current={params.sort} params={params} className="num" descFirst />
                  <th className="num">Reservado</th>
                  <th className="num">Bloqueado</th>
                  <SortTh label="Disponível" field="available" current={params.sort} params={params} className="num" descFirst />
                </tr>
              </thead>
              <tbody>
                {result.rows.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/estoque/saldo/${b.id}`} className="link font-mono text-xs">
                        {b.location_code}
                      </Link>
                      <span className="block text-[11px] text-slate-500">
                        {ZONE_TYPE_LABELS[b.zone_type]}
                        {b.location_status === "blocked" ? " · endereço bloqueado" : ""}
                      </span>
                    </td>
                    <td>
                      <span className="font-medium text-slate-800">{b.sku}</span>
                      <span className="block text-xs text-slate-500">{b.description}</span>
                    </td>
                    <td className="code">{b.lot_code || "—"}</td>
                    <td>
                      {fmtDate(b.expiry_date)}
                      {b.expiry_date && b.expiry_date < today ? <Badge tone="danger" className="ml-1">Vencido</Badge> : null}
                    </td>
                    <td className="num">{fmtQty(b.quantity)}</td>
                    <td className="num text-sky-700">{fmtQty(b.reserved_qty)}</td>
                    <td className="num text-amber-700">{fmtQty(b.blocked_qty)}</td>
                    <td className="num font-semibold text-emerald-700">{fmtQty(b.available_qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState title="Nenhum saldo encontrado" description="Saldos são criados pela armazenagem de recebimentos ou por ajustes autorizados." />
        )}
        <Pagination page={result.page} pageSize={result.pageSize} total={result.totals.total} params={params} />
      </Card>
    </>
  );
}
