import Link from "next/link";
import type { OrderListRow } from "@/server/services/outbound";
import { DemoBadge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap } from "@/components/ui/table";
import { fmtDateTime, fmtQty } from "@/lib/format";

export function OrderTable({ rows, empty = "Nenhum pedido" }: { rows: OrderListRow[]; empty?: string }) {
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <TableWrap>
      <table className="table-base">
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Status</th>
            <th>Prioridade</th>
            <th>Cliente</th>
            <th>Origem</th>
            <th className="num">Solicitado</th>
            <th className="num">Reservado</th>
            <th className="num">Separado</th>
            <th className="num">Expedido</th>
            <th className="num">Tarefas abertas</th>
            <th>Criado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td>
                <Link href={`/separacao/${o.id}`} className="link">
                  {o.code}
                </Link>
                {o.is_demo ? <DemoBadge className="ml-2" /> : null}
              </td>
              <td>
                <StatusBadge kind="outbound" status={o.status} />
              </td>
              <td>
                <PriorityBadge priority={o.priority} />
              </td>
              <td>{o.customer_name}</td>
              <td>{o.source === "erp" ? `ERP ${o.so_number ?? ""}` : "Manual"}</td>
              <td className="num">{fmtQty(o.requested)}</td>
              <td className="num">{fmtQty(o.reserved)}</td>
              <td className="num">{fmtQty(o.picked)}</td>
              <td className="num">{fmtQty(o.shipped)}</td>
              <td className="num">{o.open_tasks || "—"}</td>
              <td className="whitespace-nowrap text-xs">{fmtDateTime(o.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
