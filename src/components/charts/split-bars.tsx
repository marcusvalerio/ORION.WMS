import { GAP, niceMax, scale, strokeWidth } from "@/lib/charts";
import { fmtDate, fmtQty } from "@/lib/format";

/**
 * Colunas diárias partidas em 2 trechos: armazenado (base, chart-1) e expedido (topo, chart-2),
 * separados por um vão de 4px. A altura total é a soma; a escala do eixo é "redonda".
 */
export function SplitBars({ data }: { data: { day: string; received: number; shipped: number }[] }) {
  const w = 640;
  const h = 200;
  const pad = { l: 40, r: 8, t: 10, b: 24 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = niceMax(Math.max(0, ...data.map((d) => d.received + d.shipped)));
  const slot = innerW / Math.max(1, data.length);
  const total = data.reduce((s, d) => ({ r: s.r + d.received, s: s.s + d.shipped }), { r: 0, s: 0 });
  const base = pad.t + innerH;
  const summary = data.map((d) => `${fmtDate(d.day).slice(0, 5)}: ${fmtQty(d.received)} armazenadas, ${fmtQty(d.shipped)} expedidas`).join("; ");
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={`Unidades armazenadas e expedidas por dia, escala até ${fmtQty(max)} un — ${summary}`}>
        {[0, max / 2, max].map((t) => {
          const y = base - scale(t, max, innerH);
          return (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} className="stroke-line" strokeDasharray={t ? "2 4" : undefined} />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" className="fill-muted text-[10px]">
                {fmtQty(t)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const bw = Math.max(4, Math.min(26, slot - 10) * (0.55 + 0.45 * strokeWidth(i)));
          const cx = pad.l + slot * i + slot / 2;
          const hr = scale(d.received, max, innerH);
          const hs = scale(d.shipped, max, innerH);
          // vão de 4px entre os trechos, tirado do trecho de cima para não distorcer a escala da base
          const gap = hr > 0 && hs > 0 ? GAP : 0;
          return (
            <g key={d.day}>
              <title>{`${fmtDate(d.day)} — armazenado: ${fmtQty(d.received)} un · expedido: ${fmtQty(d.shipped)} un`}</title>
              {hr > 0 ? <rect x={cx - bw / 2} y={base - hr} width={bw} height={hr} className="fill-series-1" /> : null}
              {hs > gap ? <rect x={cx - bw / 2} y={base - hr - hs} width={bw} height={hs - gap} className="fill-chart-2" /> : null}
              {!hr && !hs ? <rect x={cx - bw / 2} y={base - 2} width={bw} height={2} className="fill-chart-off" /> : null}
              {i % 2 === (data.length - 1) % 2 ? (
                <text x={cx} y={h - 6} textAnchor="middle" className="fill-muted text-[10px]">
                  {fmtDate(d.day).slice(0, 5)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-fg-2">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-1.5 bg-series-1" /> Armazenado (entrada) · {fmtQty(total.r)} un
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-1.5 bg-chart-2" /> Expedido (saída) · {fmtQty(total.s)} un
        </span>
        <span className="text-muted">Altura da coluna = entrada + saída do dia</span>
      </figcaption>
    </figure>
  );
}
