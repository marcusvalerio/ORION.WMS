import Link from "next/link";
import { GAP, niceMax, scale, strokeWidth } from "@/lib/charts";
import { STATUS, TASK_TYPE_LABELS } from "@/lib/labels";
import { fmtQty } from "@/lib/format";

const STACK = [
  { status: "completed", cls: "fill-ok-solid", sw: "bg-ok-solid" },
  { status: "in_progress", cls: "fill-cobalto-600", sw: "bg-cobalto-600" },
  { status: "pending", cls: "fill-neutral-solid", sw: "bg-neutral-solid" },
] as const;

/**
 * Colunas empilhadas com vãos de 4px entre os trechos: concluída (base), em execução
 * (cobalto) e pendente (neutro), uma coluna por tipo de tarefa. Canceladas ficam fora da pilha.
 */
export function StackedSplit({ data }: { data: { status: string; task_type: string; n: number }[] }) {
  const types = Object.keys(TASK_TYPE_LABELS).filter((t) => data.some((d) => d.task_type === t));
  if (!types.length) return <p className="py-6 text-center text-sm text-muted">Nenhuma tarefa registrada ainda.</p>;
  const n = (type: string, status: string) => Number(data.find((d) => d.task_type === type && d.status === status)?.n ?? 0);
  const cols = types.map((t) => ({ type: t, parts: STACK.map((s) => ({ ...s, n: n(t, s.status) })) }));
  const max = niceMax(Math.max(...cols.map((c) => c.parts.reduce((a, p) => a + p.n, 0))));
  const w = Math.max(720, cols.length * 110);
  const h = 190;
  const pad = { l: 30, r: 6, t: 8, b: 40 };
  const innerH = h - pad.t - pad.b;
  const base = pad.t + innerH;
  const slot = (w - pad.l - pad.r) / cols.length;
  const totals = [...STACK.map((s) => ({ ...s, n: data.filter((d) => d.status === s.status).reduce((a, d) => a + Number(d.n), 0) }))];
  const cancelled = data.filter((d) => d.status === "cancelled").reduce((a, d) => a + Number(d.n), 0);
  const summary = cols
    .map((c) => `${TASK_TYPE_LABELS[c.type]}: ${c.parts.map((p) => `${p.n} ${STATUS.task[p.status].label.toLowerCase()}`).join(", ")}`)
    .join("; ");
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={`Tarefas por tipo e status, escala até ${max} — ${summary}`}>
        {[0, max / 2, max].map((t) => {
          const y = base - scale(t, max, innerH);
          return (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} className="stroke-line" strokeDasharray={t ? "2 4" : undefined} />
              <text x={pad.l - 5} y={y + 3} textAnchor="end" className="fill-muted text-[10px]">
                {fmtQty(t)}
              </text>
            </g>
          );
        })}
        {cols.map((c, i) => {
          const bw = Math.min(34, slot - 12) * (0.6 + 0.4 * strokeWidth(i));
          const cx = pad.l + slot * i + slot / 2;
          let y = base;
          return (
            <g key={c.type}>
              <title>{`${TASK_TYPE_LABELS[c.type]} — ${c.parts.map((p) => `${STATUS.task[p.status].label}: ${p.n}`).join(" · ")}`}</title>
              {c.parts.map((p) => {
                const hh = scale(p.n, max, innerH);
                if (!hh) return null;
                const top = y - hh;
                const rect = <rect key={p.status} x={cx - bw / 2} y={top} width={bw} height={Math.max(1, hh - (y < base ? GAP : 0))} className={p.cls} />;
                y = top;
                return rect;
              })}
              <text x={cx} y={base + 14} textAnchor="middle" className="fill-fg-2 text-[10px]">
                {TASK_TYPE_LABELS[c.type].slice(0, 12)}
              </text>
              <text x={cx} y={base + 27} textAnchor="middle" className="fill-muted text-[10px]">
                {c.parts.reduce((a, p) => a + p.n, 0)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-3 text-xs text-fg-2">
        {totals.map((s) => (
          <Link key={s.status} href={`/tarefas?status=${s.status}`} className="flex items-center gap-1.5 hover:underline">
            <span className={`h-3 w-1.5 ${s.sw}`} />
            {STATUS.task[s.status].label}: <strong className="tabular-nums">{s.n}</strong>
          </Link>
        ))}
        {cancelled ? (
          <Link href="/tarefas?status=cancelled" className="text-muted hover:underline">
            Canceladas (fora do gráfico): {cancelled}
          </Link>
        ) : null}
      </figcaption>
    </figure>
  );
}
