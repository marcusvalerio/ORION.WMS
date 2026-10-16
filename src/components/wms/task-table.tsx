import Link from "next/link";
import type { TaskRow } from "@/server/services/tasks";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap } from "@/components/ui/table";
import { TASK_TYPE_LABELS } from "@/lib/labels";
import { fmtDateTime, fmtQty } from "@/lib/format";

export function taskDocument(t: TaskRow): { label: string; href: string } | null {
  if (t.receipt_id && t.receipt_code) return { label: t.receipt_code, href: `/recebimentos/${t.receipt_id}` };
  if (t.order_id && t.order_code) return { label: t.order_code, href: `/separacao/${t.order_id}` };
  if (t.inventory_id && t.inventory_code) return { label: t.inventory_code, href: `/inventario/${t.inventory_id}` };
  return null;
}

export function TaskTable({ rows, header }: { rows: TaskRow[]; header?: React.ReactNode }) {
  if (!rows.length) return <EmptyState title="Nenhuma tarefa encontrada" description="Tarefas são geradas por recebimentos liberados, pedidos em separação, transferências e inventários." />;
  return (
    <TableWrap>
      <table className="table-base">
        <thead>
          {header ?? (
            <tr>
              <th>Código</th>
              <th>Tipo</th>
              <th>Prioridade</th>
              <th>Status</th>
              <th>Produto</th>
              <th className="num">Qtd.</th>
              <th>Origem</th>
              <th>Destino</th>
              <th>Documento</th>
              <th>Responsável</th>
              <th>Criada</th>
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map((t) => {
            const doc = taskDocument(t);
            return (
              <tr key={t.id}>
                <td className="whitespace-nowrap">
                  <Link href={`/tarefas/${t.id}`} className="link">
                    {t.code}
                  </Link>
                </td>
                <td>{TASK_TYPE_LABELS[t.task_type]}</td>
                <td>
                  <PriorityBadge priority={t.priority} />
                </td>
                <td>
                  <StatusBadge kind="task" status={t.status} />
                </td>
                <td>
                  {t.sku ?? "—"}
                  {t.lot_code ? <span className="block text-[11px] text-slate-500">Lote {t.lot_code}</span> : null}
                </td>
                <td className="num">{fmtQty(t.confirmed_qty ?? t.quantity)}</td>
                <td className="font-mono text-[11px] whitespace-nowrap">{t.from_code ?? "—"}</td>
                <td className="font-mono text-[11px] whitespace-nowrap">
                  {t.to_code ?? t.suggested_code ?? (t.task_type === "putaway" ? <span className="font-sans text-xs text-red-600">Sem sugestão</span> : "—")}
                </td>
                <td>
                  {doc ? (
                    <Link href={doc.href} className="link">
                      {doc.label}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{t.completed_by_name ?? t.assigned_name ?? "—"}</td>
                <td className="whitespace-nowrap text-xs">{fmtDateTime(t.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}
