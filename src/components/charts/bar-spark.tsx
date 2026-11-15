import { GAP, scale, splitBar, strokeWidth } from "@/lib/charts";
import { fmtDate, fmtQty } from "@/lib/format";

/**
 * Minigráfico de barras partidas (KPIs). Cada dia é uma barra vertical com a espessura
 * de uma coluna do símbolo; a última barra (hoje) fica em cobalto-600.
 */
export function BarSpark({
  data,
  label,
  height = 32,
  className,
}: {
  data: { day: string; value: number }[];
  label: string;
  height?: number;
  className?: string;
}) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.value), 0);
  const widths = data.map((_, i) => 3 + Math.round(4 * strokeWidth(i)));
  const width = widths.reduce((a, b) => a + b, 0) + GAP * (data.length - 1);
  const summary = data.map((d) => `${fmtDate(d.day).slice(0, 5)}: ${fmtQty(d.value)}`).join("; ");
  const xs = widths.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b + GAP, 0));
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}, últimos ${data.length} dias — ${summary}`}
      className={className}
    >
      {data.map((d, i) => {
        const w = widths[i];
        const bx = xs[i];
        const h = scale(d.value, max, height);
        const today = i === data.length - 1;
        const fill = today ? "fill-cobalto-600" : "fill-fg-2/70";
        return (
          <g key={d.day}>
            <rect x={bx} y={height - 2} width={w} height={2} className="fill-chart-off" />
            {splitBar(h, i, 3).map(([y0, y1], k) => (
              <rect key={k} x={bx} y={height - y1} width={w} height={Math.max(1, y1 - y0)} className={fill} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
