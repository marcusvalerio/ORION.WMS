import Link from "next/link";
import type { PoDeliveryRow, PoItemBalance } from "@/server/services/receiving";
import { StatusBadge } from "@/components/ui/badge";
import { TableWrap } from "@/components/ui/table";
import { fmtDateTime, fmtQty } from "@/lib/format";

/** Saldo pendente por item do pedido de compra (todas as entregas). */
export function PoBalanceTable({ rows }: { rows: PoItemBalance[] }) {
  return (
    <TableWrap>
      <table className="table-base">
        <thead>
          <tr>
            <th>#</th>
            <th>Produto</th>
            <th className="num">Pedido</th>
            <th className="num">Recebido</th>
            <th className="num">Em andamento</th>
            <th className="num">Saldo pendente</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.purchase_order_item_id}>
              <td className="text-slate-400">{b.line_no}</td>
              <td>
                <span className="font-medium">{b.sku}</span>
                <span className="block text-xs text-slate-500">{b.description}</span>
              </td>
              <td className="num">
                {fmtQty(b.ordered)} {b.uom}
              </td>
              <td className="num">{fmtQty(b.received)}</td>
              <td className="num">{b.in_transit ? fmtQty(b.in_transit) : "—"}</td>
              <td className={b.pending > 0 ? "num font-medium text-amber-700" : "num font-medium text-emerald-700"}>{fmtQty(b.pending)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

/** Histórico de entregas (recebimentos) do pedido. */
export function PoDeliveriesTable({ rows, currentId }: { rows: PoDeliveryRow[]; currentId?: string }) {
  if (!rows.length) return <p className="px-4 py-3 text-sm text-slate-500">Nenhuma entrega registrada.</p>;
  return (
    <TableWrap>
      <table className="table-base">
        <thead>
          <tr>
            <th>Entrega</th>
            <th>Recebimento</th>
            <th>Status</th>
            <th>NF</th>
            <th>Chegada</th>
            <th className="num">Previsto</th>
            <th className="num">Conferido</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={r.id === currentId ? "bg-brand-50/40" : undefined}>
              <td className="text-slate-500">{i + 1}ª</td>
              <td>
                <Link className="link" href={`/recebimentos/${r.id}`}>
                  {r.code}
                </Link>
              </td>
              <td>
                <StatusBadge kind="receipt" status={r.status} />
              </td>
              <td>{r.invoice_number ?? "—"}</td>
              <td>{fmtDateTime(r.arrived_at)}</td>
              <td className="num">{fmtQty(r.expected_total)}</td>
              <td className="num">{fmtQty(r.counted_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
