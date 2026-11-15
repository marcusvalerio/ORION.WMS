import { blockLayout, litCount } from "@/lib/charts";
import { fmtPct, fmtQty } from "@/lib/format";
import { cn } from "@/components/ui/cn";

const W = 240;
const H = 12;

/**
 * Faixa horizontal de blocos de larguras variadas separados por vãos de 4px; o valor é lido
 * pela quantidade de blocos cheios. Acima de `warnAt`% os blocos cheios ficam em alerta.
 */
export function BlockBar({
  used,
  capacity,
  label = "Ocupação",
  blocks = 12,
  warnAt = 70,
  fillClass,
  showLabel = true,
  className,
}: {
  used: number;
  capacity: number;
  label?: string;
  blocks?: number;
  warnAt?: number;
  /** Força a cor dos blocos cheios (ex.: classe ABC). */
  fillClass?: string;
  showLabel?: boolean;
  className?: string;
}) {
  const pct = capacity > 0 ? Math.min(100, (used / capacity) * 100) : 0;
  const lit = litCount(pct, blocks);
  const on = fillClass ?? (pct > warnAt ? "fill-warn-solid" : "fill-info-solid");
  return (
    <div className={cn("min-w-[120px]", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block h-3 w-full"
        role="img"
        aria-label={`${label}: ${fmtPct(pct)} (${fmtQty(used)} de ${fmtQty(capacity)}) — ${lit} de ${blocks} blocos cheios`}
      >
        {blockLayout(blocks, W).map((b, i) => (
          <rect key={i} x={b.x} y={0} width={b.w} height={H} className={i < lit ? on : "fill-chart-off"} />
        ))}
      </svg>
      {showLabel ? (
        <p className="mt-1 text-[11px] text-muted tabular-nums">
          {fmtPct(pct)} · {fmtQty(used)}/{fmtQty(capacity)} un
        </p>
      ) : null}
    </div>
  );
}
