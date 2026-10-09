import { fmtDate, fmtQty } from "@/lib/format";

/** Gráfico de barras agrupadas (SVG puro): unidades armazenadas × expedidas por dia. */
export function FlowChart({ data }: { data: { day: string; received: number; shipped: number }[] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.received, d.shipped)));
  const w = 640;
  const h = 180;
  const pad = { l: 36, r: 8, t: 10, b: 24 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const slot = innerW / data.length;
  const bw = Math.max(3, Math.min(14, slot / 2 - 3));
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const ticks = [...new Set([0, 0.5, 1].map((f) => Math.round(max * f)))];
  const total = data.reduce((s, d) => ({ r: s.r + d.received, s: s.s + d.shipped }), { r: 0, s: 0 });
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label="Unidades armazenadas e expedidas por dia">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeDasharray={t ? "3 3" : undefined} />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
              {fmtQty(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + slot * i + slot / 2;
          return (
            <g key={d.day}>
              <rect x={cx - bw - 1} y={y(d.received)} width={bw} height={pad.t + innerH - y(d.received)} rx={2} className="fill-brand-500">
                <title>{`${fmtDate(d.day)} — armazenado: ${fmtQty(d.received)} un`}</title>
              </rect>
              <rect x={cx + 1} y={y(d.shipped)} width={bw} height={pad.t + innerH - y(d.shipped)} rx={2} className="fill-emerald-500">
                <title>{`${fmtDate(d.day)} — expedido: ${fmtQty(d.shipped)} un`}</title>
              </rect>
              {i % 2 === data.length % 2 ? (
                <text x={cx} y={h - 6} textAnchor="middle" className="fill-slate-400 text-[10px]">
                  {fmtDate(d.day).slice(0, 5)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-brand-500" /> Armazenado (entrada) · {fmtQty(total.r)} un
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-emerald-500" /> Expedido (saída) · {fmtQty(total.s)} un
        </span>
      </figcaption>
    </figure>
  );
}
