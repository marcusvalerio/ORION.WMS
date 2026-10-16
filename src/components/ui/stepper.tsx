import { Check } from "lucide-react";
import { cn } from "./cn";

/** Indicador de etapas do fluxo (somente leitura). */
export function Stepper({ steps, current, cancelled }: { steps: string[]; current: number; cancelled?: boolean }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs" aria-label="Etapas">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current && !cancelled;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full text-[10px] font-semibold",
                done ? "bg-emerald-500 text-white" : active ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-500",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check className="size-3" /> : i + 1}
            </span>
            <span className={cn(active ? "font-medium text-slate-900" : done ? "text-slate-700" : "text-slate-400")}>{label}</span>
            {i < steps.length - 1 ? <span className="h-px w-5 bg-slate-200" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}
