import Link from "next/link";
import { Info } from "lucide-react";
import { fmtPct, fmtQty } from "@/lib/format";
import type { Kpi } from "@/server/services/dashboard";
import { cn } from "./cn";

const toneBar: Record<NonNullable<Kpi["tone"]>, string> = {
  default: "bg-slate-200",
  warning: "bg-amber-400",
  danger: "bg-red-500",
  success: "bg-emerald-500",
};

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const value = kpi.format === "percent" ? fmtPct(kpi.value) : fmtQty(kpi.value);
  const body = (
    <div className="relative h-full overflow-hidden rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs transition-colors hover:border-brand-300">
      <span className={cn("absolute inset-y-0 left-0 w-1", toneBar[kpi.tone ?? "default"])} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{kpi.label}</p>
        <span title={kpi.definition} className="text-slate-300 hover:text-slate-500">
          <Info className="size-3.5" aria-label={`Definição: ${kpi.definition}`} />
        </span>
      </div>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">
        {value}
        {kpi.format === "qty" ? <span className="ml-1 text-sm font-normal text-slate-500">un</span> : null}
      </p>
      {kpi.hint ? <p className="mt-0.5 text-xs text-slate-500">{kpi.hint}</p> : null}
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
