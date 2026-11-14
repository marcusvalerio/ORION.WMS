import { fmtPct, fmtQty } from "@/lib/format";
import { cn } from "./cn";

export function OccupancyBar({ used, capacity, showLabel = true, className }: { used: number; capacity: number; showLabel?: boolean; className?: string }) {
  const pct = capacity > 0 ? Math.min(100, (used / capacity) * 100) : 0;
  const color = pct >= 90 ? "bg-crit-solid" : pct >= 75 ? "bg-warn-solid" : pct > 0 ? "bg-action" : "bg-line-strong";
  return (
    <div className={cn("min-w-[110px]", className)}>
      <div className="h-1.5 overflow-hidden rounded-full bg-subtle" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Ocupação">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      {showLabel ? (
        <p className="mt-1 text-[11px] text-muted tabular-nums">
          {fmtPct(pct)} · {fmtQty(used)}/{fmtQty(capacity)} un
        </p>
      ) : null}
    </div>
  );
}
