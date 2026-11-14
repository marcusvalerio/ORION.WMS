import Link from "next/link";
import { Download, Undo2 } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { listReturns, RETURN_STATUSES } from "@/server/services/returns";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { DemoBadge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { RETURN_REASON_LABELS, STATUS } from "@/lib/labels";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Devoluções" };

export default async function ReturnsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  const rows = await listReturns(ctx, { status: params.status, q: params.q });
  const totals = rows.filter((r) => r.status !== "cancelled").reduce(
    (a, r) => ({ q: a.q + r.quantity, ok: a.ok + r.approved, dmg: a.dmg + r.damaged, disc: a.disc + r.discarded }),
    { q: 0, ok: 0, dmg: 0, disc: 0 },
  );
  const qs = new URLSearchParams(Object.entries({ status: params.status, q: params.q }).filter(([, v]) => v) as [string, string][]);
  return (
    <>
      <PageHeader
        title="Devoluções de cliente"
        description="Devoluções de pedidos expedidos, com inspeção por item: apto volta à armazenagem, avariado vai bloqueado para a quarentena, descarte é baixado com movimento próprio."
        breadcrumbs={[{ label: "Entrada" }, { label: "Devoluções" }]}
        actions={
          <>
            {can(ctx.user.role, "return.create") ? (
              <ButtonLink href="/devolucoes/nova" variant="primary" size="sm">
                <Undo2 className="size-4" /> Registrar devolução
              </ButtonLink>
            ) : null}
            {can(ctx.user.role, "reports.export") ? (
              <ButtonLink href={`/api/relatorios/devolucoes?${qs}`} size="sm" prefetch={false}>
                <Download className="size-4" /> CSV
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <Card>
        <FilterBar resetHref="/devolucoes">
          <FilterField label="Buscar" className="w-full sm:w-64">
            <Input name="q" defaultValue={params.q} placeholder="Código, pedido ou cliente" />
          </FilterField>
          <FilterField label="Status">
            <Select name="status" defaultValue={params.status} placeholder="Todos" options={RETURN_STATUSES.map((s) => ({ value: s, label: STATUS.customerReturn[s].label }))} />
          </FilterField>
        </FilterBar>
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
          Total devolvido {fmtQty(totals.q)} · apto {fmtQty(totals.ok)} · avariado {fmtQty(totals.dmg)} · descartado {fmtQty(totals.disc)}
        </p>
        {rows.length ? (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Status</th>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Motivo</th>
                  <th className="num">Devolvido</th>
                  <th className="num">Apto</th>
                  <th className="num">Avariado</th>
                  <th className="num">Descarte</th>
                  <th>Registrada</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">
                      <Link className="link" href={`/devolucoes/${r.id}`}>
                        {r.code}
                      </Link>
                      {r.is_demo ? <DemoBadge className="ml-1" /> : null}
                    </td>
                    <td>
                      <StatusBadge kind="customerReturn" status={r.status} />
                    </td>
                    <td>
                      <Link className="link" href={`/separacao/${r.order_id}`}>
                        {r.order_code}
                      </Link>
                    </td>
                    <td>{r.customer_name}</td>
                    <td>{RETURN_REASON_LABELS[r.reason] ?? r.reason}</td>
                    <td className="num">{fmtQty(r.quantity)}</td>
                    <td className="num">{fmtQty(r.approved)}</td>
                    <td className="num">{fmtQty(r.damaged)}</td>
                    <td className="num">{fmtQty(r.discarded)}</td>
                    <td className="text-xs">
                      {fmtDateTime(r.created_at)}
                      <span className="block text-slate-500">{r.created_by_name}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState title="Nenhuma devolução registrada" />
        )}
      </Card>
    </>
  );
}
