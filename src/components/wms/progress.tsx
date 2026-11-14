/** Barra de progresso de tarefas (ondas). */
export function Progress({ done, total }: { done: number; total: number }) {
  if (!total) return <span className="text-xs text-muted">Sem tarefas</span>;
  const pct = Math.round((done / total) * 100);
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="bg-ok-solid" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted tabular-nums">
        {done}/{total} tarefas ({pct}%)
      </span>
    </div>
  );
}
