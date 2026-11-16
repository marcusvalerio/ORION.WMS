import { Check } from "lucide-react";
import { importTimeline, type ImportTimelineInput } from "@/lib/comex-panel";
import { fmtDay } from "@/lib/format";
import { cn } from "@/components/ui/cn";

const short = (v: string | null | undefined) => (v ? fmtDay(v) : null);

/**
 * Linha do tempo do processo de importação (embarque → chegada → registro → desembaraço →
 * recebimento → armazenagem). Compacta: pontos com o rótulo e a data do último marco
 * concluído e do próximo marco; os demais ficam no título (passar o mouse) e no leitor de tela.
 */
export function ImportTimeline({ row }: { row: ImportTimelineInput }) {
  const steps = importTimeline(row);
  const lastDone = steps.reduce((acc, s, i) => (s.done ? i : acc), -1);
  const next = steps[lastDone + 1];
  const describe = steps
    .map((s) => `${s.label}: ${s.done ? (short(s.at) ?? "concluído") : s.planned ? `previsto ${short(s.planned)}` : "pendente"}`)
    .join("; ");
  return (
    <div className="min-w-44" title={describe}>
      <ol className="flex items-center" aria-label={`Linha do tempo — ${describe}`}>
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center">
            <span
              className={cn(
                "flex size-3.5 items-center justify-center rounded-full",
                s.done ? "bg-ok-solid text-on-action" : i === lastDone + 1 ? "bg-surface ring-2 ring-action" : "bg-line",
              )}
              aria-hidden
            >
              {s.done ? <Check className="size-2.5" strokeWidth={3} /> : null}
            </span>
            {i < steps.length - 1 ? <span className={cn("h-0.5 w-4", steps[i + 1].done ? "bg-ok-solid" : "bg-line")} aria-hidden /> : null}
          </li>
        ))}
      </ol>
      <p className="mt-1 text-xs text-muted" aria-hidden>
        {lastDone >= 0 ? (
          <>
            <span className="text-fg-2">{steps[lastDone].label}</span>
            {steps[lastDone].at ? ` ${short(steps[lastDone].at)}` : ""}
          </>
        ) : (
          "Sem marcos"
        )}
        {next ? <> · próx.: {next.label}{next.planned ? ` (prev. ${short(next.planned)})` : ""}</> : null}
      </p>
    </div>
  );
}

/** Versão detalhada (vertical) para o detalhe do recebimento. */
export function ImportTimelineFull({ row }: { row: ImportTimelineInput }) {
  const steps = importTimeline(row);
  return (
    <ol className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Linha do tempo da importação">
      {steps.map((s) => (
        <li key={s.key} className="flex items-start gap-2">
          <span
            className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full", s.done ? "bg-ok-solid text-on-action" : "bg-line")}
            aria-hidden
          >
            {s.done ? <Check className="size-3" strokeWidth={3} /> : null}
          </span>
          <span className="text-xs">
            <span className={cn("block font-medium", s.done ? "text-fg" : "text-muted")}>{s.label}</span>
            <span className="block text-muted">
              {s.done ? (short(s.at) ?? "Concluído") : s.planned ? `Previsto ${short(s.planned)}` : "Pendente"}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
