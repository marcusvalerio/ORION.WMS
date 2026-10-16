import Link from "next/link";
import type { ReceiptListRow } from "@/server/services/receiving";
import { DemoBadge, StatusBadge, Badge } from "@/components/ui/badge";
import { TableWrap } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { fmtDateTime, fmtQty } from "@/lib/format";

export function ReceiptTable({ rows, emptyText = "Nenhum recebimento encontrado" }: { rows: ReceiptListRow[]; emptyText?: string }) {
  if (!rows.length) return <EmptyState title={emptyText} description="Importe um pedido de compra do ERP ou registre uma entrada avulsa." />;
  return (
    <TableWrap>
      <table className="table-base">
        <thead>
          <tr>
            <th>Recebimento</th>
            <th>Status</th>
            <th>Fornecedor</th>
            <th>Pedido / NF</th>
            <th>Chegada</th>
            <th className="num">Previsto</th>
            <th className="num">Conferido</th>
            <th className="num">A armazenar</th>
            <th>Divergências</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/recebimentos/${r.id}`} className="link">
                  {r.code}
                </Link>
                {r.is_demo ? <DemoBadge className="ml-2" /> : null}
                <span className="block text-xs text-slate-500">{r.warehouse_code}</span>
              </td>
              <td>
                <StatusBadge kind="receipt" status={r.status} />
              </td>
              <td>{r.supplier_name}</td>
              <td>
                {r.po_number ?? "Sem pedido"}
                <span className="block text-xs text-slate-500">{r.invoice_number ?? "—"}</span>
              </td>
              <td className="whitespace-nowrap">{fmtDateTime(r.arrived_at)}</td>
              <td className="num">{fmtQty(r.expected_total)}</td>
              <td className="num">{fmtQty(r.counted_total)}</td>
              <td className="num">{r.pending_putaway ? fmtQty(r.pending_putaway) : "—"}</td>
              <td>{r.open_divergences ? <Badge tone="danger">{r.open_divergences} em aberto</Badge> : <span className="text-xs text-slate-400">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
