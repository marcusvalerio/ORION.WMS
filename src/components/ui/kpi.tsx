import Link from "next/link";
import { Info } from "lucide-react";
import { fmtPct, fmtQty } from "@/lib/format";
import type { Kpi } from "@/server/services/dashboard";
import { cn } from "./cn";
import { BarSpark } from "@/components/charts/bar-spark";

/** Situação do indicador: selo com rótulo (nunca só cor), só quando pede atenção. */
const toneBadge: Partial<Record<NonNullable<Kpi["tone"]>, { label: string; cls: string }>> = {
  warning: { label: "Atenção", cls: "bg-warn-bg text-warn-fg before:bg-warn-solid" },
  danger: { label: "Crítico", cls: "bg-crit-bg text-crit-fg before:bg-crit-solid" },
};

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const value = kpi.format === "percent" ? fmtPct(kpi.value) : fmtQty(kpi.value);
  const badge = kpi.tone ? toneBadge[kpi.tone] : undefined;
  const body = (
    <div className="h-full rounded-lg border border-line bg-surface p-3.5 transition-colors hover:border-accent">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <p className="text-xs font-medium text-muted">{kpi.label}</p>
          {badge ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 text-[11px] leading-5 font-medium before:size-1.5 before:rounded-full",
                badge.cls,
              )}
            >
              {badge.label}
            </span>
          ) : null}
        </div>
        <span title={kpi.definition} className="text-muted hover:text-muted">
          <Info className="size-3.5" aria-label={`Definição: ${kpi.definition}`} />
        </span>
      </div>
      <p className="mt-1 text-[28px] leading-8 font-medium text-fg tabular-nums">
        {value}
        {kpi.format === "qty" ? <span className="ml-1 text-sm font-normal text-muted">un</span> : null}
      </p>
      {kpi.hint ? <p className="mt-0.5 text-xs text-muted">{kpi.hint}</p> : null}
      {kpi.series?.length ? (
        <div className="mt-2 overflow-hidden" title={`${kpi.seriesLabel ?? kpi.label} — últimos ${kpi.series.length} dias (barra azul = hoje)`}>
          <BarSpark data={kpi.series} label={kpi.seriesLabel ?? kpi.label} height={22} />
        </div>
      ) : null}
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
