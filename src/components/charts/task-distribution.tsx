import Link from "next/link";
import { STATUS, TASK_TYPE_LABELS } from "@/lib/labels";

const COLORS: Record<string, string> = {
  pending: "bg-chart-6",
  in_progress: "bg-chart-2",
  completed: "bg-chart-5",
  cancelled: "bg-chart-4",
};
const ORDER = ["pending", "in_progress", "completed", "cancelled"];

/** Barras empilhadas horizontais: tarefas por tipo e status. */
export function TaskDistribution({ data }: { data: { status: string; task_type: string; n: number }[] }) {
  const types = Object.keys(TASK_TYPE_LABELS).filter((t) => data.some((d) => d.task_type === t));
  const totals = ORDER.map((s) => ({ s, n: data.filter((d) => d.status === s).reduce((a, d) => a + d.n, 0) }));
  if (!types.length) return <p className="py-6 text-center text-sm text-muted">Nenhuma tarefa registrada ainda.</p>;
  return (
    <div className="space-y-3">
      {types.map((type) => {
        const rows = data.filter((d) => d.task_type === type);
        const total = rows.reduce((a, d) => a + d.n, 0);
        return (
          <div key={type}>
            <div className="mb-1 flex justify-between text-xs">
              <Link href={`/tarefas?type=${type}`} className="font-medium text-fg-2 hover:underline">
                {TASK_TYPE_LABELS[type]}
              </Link>
              <span className="text-muted tabular-nums">{total}</span>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full bg-subtle">
              {ORDER.map((s) => {
                const n = rows.find((r) => r.status === s)?.n ?? 0;
                return n ? (
                  <div key={s} className={COLORS[s]} style={{ width: `${(n / total) * 100}%` }} title={`${STATUS.task[s].label}: ${n}`} />
                ) : null;
              })}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-3 pt-1 text-xs text-fg-2">
        {totals.map(({ s, n }) => (
          <Link key={s} href={`/tarefas?status=${s}`} className="flex items-center gap-1.5 hover:underline">
            <span className={`size-2.5 rounded-sm ${COLORS[s]}`} />
            {STATUS.task[s].label}: <strong className="tabular-nums">{n}</strong>
          </Link>
        ))}
      </div>
    </div>
  );
}
