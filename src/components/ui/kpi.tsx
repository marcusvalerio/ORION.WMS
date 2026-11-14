import Link from "next/link";
import { Info } from "lucide-react";
import { fmtPct, fmtQty } from "@/lib/format";
import type { Kpi } from "@/server/services/dashboard";
import { cn } from "./cn";

const toneBar: Record<NonNullable<Kpi["tone"]>, string> = {
  default: "bg-accent",
  warning: "bg-warn-solid",
  danger: "bg-crit-solid",
  success: "bg-ok-solid",
};

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const value = kpi.format === "percent" ? fmtPct(kpi.value) : fmtQty(kpi.value);
  const body = (
    <div className="relative h-full overflow-hidden rounded-lg border border-line bg-surface p-3.5 shadow-xs transition-colors hover:border-accent">
      <span className={cn("absolute inset-y-0 left-0 w-1", toneBar[kpi.tone ?? "default"])} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{kpi.label}</p>
        <span title={kpi.definition} className="text-muted hover:text-muted">
          <Info className="size-3.5" aria-label={`Definição: ${kpi.definition}`} />
        </span>
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-fg tabular-nums">
        {value}
        {kpi.format === "qty" ? <span className="ml-1 text-sm font-normal text-muted">un</span> : null}
      </p>
      {kpi.hint ? <p className="mt-0.5 text-xs text-muted">{kpi.hint}</p> : null}
    </div>
  );
  return kpi.href ? (
    <Link href={kpi.href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}
