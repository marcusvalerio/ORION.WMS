import Link from "next/link";
import { Download } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { listMovements } from "@/server/services/stock";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/fields";
import { Pagination, TableWrap } from "@/components/ui/table";
import { MOVEMENT_LABELS, type Tone } from "@/lib/labels";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid, pageNumber, readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Movimentações" };

const TONE: Record<string, Tone> = {
  putaway: "success",
  adjustment_in: "info",
  adjustment_out: "warning",
  transfer: "progress",
  pick: "neutral",
  shipment: "danger",
  block: "warning",
  unblock: "info",
};

function refHref(type: string | null, id: string | null) {
  if (!id) return null;
  if (type === "receipt") return `/recebimentos/${id}`;
  if (type === "outbound_order") return `/separacao/${id}`;
  if (type === "inventory") return `/inventario/${id}`;
  if (type === "task") return `/tarefas/${id}`;
  return null;
}

export default async function MovementsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  const filters = {
    q: params.q,
    type: params.type,
    from: params.from,
    to: params.to,
    productId: isUuid(params.productId) ? params.productId : null,
    locationId: isUuid(params.locationId) ? params.locationId : null,
  };
  const result = await listMovements(ctx, { ...filters, page: pageNumber(params.page) });
  const exportQs = new URLSearchParams(Object.entries({ q: params.q, type: params.type, from: params.from, to: params.to }).filter(([, v]) => v) as [string, string][]);

  return (
    <>
      <PageHeader
        title="Movimentações"
        description="Histórico imutável de tudo que alterou o estoque: armazenagens, transferências, ajustes, separações, expedições e bloqueios."
        breadcrumbs={[{ label: "Armazém" }, { label: "Movimentações" }]}
        actions={
          can(ctx.user.role, "reports.export") ? (
            <ButtonLink href={`/api/relatorios/movimentacoes?${exportQs}`} size="sm" prefetch={false}>
              <Download className="size-4" /> CSV
            </ButtonLink>
          ) : null
        }
      />
      <Card>
        <FilterBar resetHref="/estoque/movimentacoes">
          <FilterField label="Produto, lote ou documento" className="w-full sm:w-64">
            <Input name="q" defaultValue={params.q} />
          </FilterField>
          <FilterField label="Tipo" className="w-full sm:w-44">
            <Select name="type" defaultValue={params.type} placeholder="Todos" options={Object.entries(MOVEMENT_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
          </FilterField>
          <FilterField label="De" className="w-full sm:w-40">
            <Input name="from" type="date" defaultValue={params.from} />
          </FilterField>
          <FilterField label="Até" className="w-full sm:w-40">
            <Input name="to" type="date" defaultValue={params.to} />
          </FilterField>
          {filters.locationId ? <input type="hidden" name="locationId" value={filters.locationId} /> : null}
          {filters.productId ? <input type="hidden" name="productId" value={filters.productId} /> : null}
        </FilterBar>
        {result.rows.length ? (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Data/hora</th>
                  <th>Tipo</th>
                  <th>Produto</th>
                  <th>Lote</th>
                  <th className="num">Qtd.</th>
                  <th>Origem</th>
                  <th>Destino</th>
                  <th>Documento / tarefa</th>
                  <th>Motivo</th>
                  <th>Usuário</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((m) => {
                  const href = refHref(m.reference_type, m.reference_id);
                  return (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap">{fmtDateTime(m.created_at)}</td>
                      <td>
                        <Badge tone={TONE[m.movement_type]}>{MOVEMENT_LABELS[m.movement_type]}</Badge>
                      </td>
                      <td>
                        <span className="font-medium">{m.sku}</span>
                      </td>
                      <td className="code">{m.lot_code || "—"}</td>
                      <td className="num font-medium">{fmtQty(m.quantity)}</td>
                      <td className="font-mono text-[11px] whitespace-nowrap">{m.from_code ?? "—"}</td>
                      <td className="font-mono text-[11px] whitespace-nowrap">{m.to_code ?? "—"}</td>
                      <td>
                        {href ? (
                          <Link href={href} className="link">
                            {m.reference_code}
                          </Link>
                        ) : (
                          (m.reference_code ?? "—")
                        )}
                        {m.task_code && m.task_id ? (
                          <Link href={`/tarefas/${m.task_id}`} className="block text-xs text-slate-500 hover:underline">
                            {m.task_code}
                          </Link>
                        ) : null}
                      </td>
                      <td className="max-w-[220px] truncate text-xs" title={m.reason ?? ""}>
                        {m.reason ?? "—"}
                      </td>
                      <td className="whitespace-nowrap">{m.user_name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState title="Nenhuma movimentação encontrada" />
        )}
        <Pagination page={result.page} pageSize={result.pageSize} total={result.total} params={params} />
      </Card>
    </>
  );
}
