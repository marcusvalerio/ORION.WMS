/** Barra de progresso de tarefas (ondas). */
export function Progress({ done, total }: { done: number; total: number }) {
  if (!total) return <span className="text-xs text-slate-500">Sem tarefas</span>;
  const pct = Math.round((done / total) * 100);
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500 tabular-nums">
        {done}/{total} tarefas ({pct}%)
      </span>
    </div>
  );
}
