import type { ReactNode } from "react";

/** Símbolo tracejado ("nada aqui ainda") usado nos estados vazios. */
export function EmptyMark({ size = 72 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="-1 -1 2 2" className="text-line-strong">
      <g fill="none" stroke="currentColor" strokeWidth={0.03} strokeDasharray="0.06 0.05">
        <rect x={-0.535} y={-0.58} width={0.19} height={1.16} />
        <rect x={-0.235} y={-0.8} width={0.13} height={1.6} />
        <rect x={-0.005} y={-0.86} width={0.17} height={1.72} />
        <rect x={0.27} y={-0.78} width={0.1} height={1.56} />
      </g>
    </svg>
  );
}

/** Estado vazio: símbolo tracejado, título, explicação e ação opcional. */
export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <EmptyMark />
      <p className="mt-1 font-display text-lg font-semibold text-fg">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
