import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "./cn";

export { EmptyState, EmptyMark } from "./empty-state";

const LOAD_BARS: { w: number; h: number; c: string }[] = [
  { w: 10, h: 40, c: "bg-ceu-400" },
  { w: 14, h: 56, c: "bg-ceu-400" },
  { w: 9, h: 62, c: "bg-ceu-600" },
  { w: 12, h: 64, c: "bg-ceu-600" },
  { w: 7, h: 58, c: "bg-fg" },
  { w: 5, h: 46, c: "bg-fg" },
];

/** Carregando: as barras do símbolo pulsando. */
export function LoadingBars({ label = "Carregando…", scale = 1, className, skeleton = false }: { label?: string; scale?: number; className?: string; skeleton?: boolean }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-col items-center justify-center gap-4", className)}>
      <div className="flex items-end" style={{ gap: 6 * scale, height: 64 * scale }} aria-hidden>
        {LOAD_BARS.map((b, i) => (
          <span key={i} className={cn("orion-load-bar block rounded-[2px]", b.c)} style={{ width: b.w * scale, height: b.h * scale, animationDelay: `${i * 0.1}s` }} />
        ))}
      </div>
      <p className="text-sm text-muted">{label}</p>
      {skeleton ? (
        <div className="flex w-full max-w-md flex-col gap-2" aria-hidden>
          <div className="h-3.5 rounded bg-subtle" />
          <div className="h-3.5 w-4/5 rounded bg-subtle" />
          <div className="h-3.5 w-3/5 rounded bg-subtle" />
        </div>
      ) : null}
    </div>
  );
}

/** Erro com explicação humana e ações (ex.: falha ao falar com o ATLAS). */
export function ErrorState({ title, description, actions, detail, className }: { title: string; description?: ReactNode; actions?: ReactNode; detail?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center gap-3 px-6 py-8 text-center", className)}>
      <span className="flex size-16 items-center justify-center rounded-full bg-crit-bg text-crit-fg">
        <CircleAlert className="size-7" aria-hidden />
      </span>
      <h2 className="font-display text-xl font-semibold text-fg">{title}</h2>
      {description ? <p className="max-w-md text-sm text-fg-2">{description}</p> : null}
      {detail ? <p className="font-mono text-xs text-muted">{detail}</p> : null}
      {actions ? <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type NoticeTone = "neutral" | "ok" | "warn" | "crit" | "info";

const NOTICE: Record<NoticeTone, { box: string; dot: string }> = {
  neutral: { box: "bg-noite-900 text-creme-100", dot: "bg-ok-solid" },
  ok: { box: "bg-ok-bg text-ok-fg", dot: "bg-ok-solid" },
  warn: { box: "bg-warn-bg text-warn-fg", dot: "bg-warn-solid" },
  crit: { box: "bg-crit-bg text-crit-fg", dot: "bg-crit-solid" },
  info: { box: "bg-info-bg text-info-fg", dot: "bg-ceu-600" },
};

/** Aviso em linha no estilo dos toasts: ponto colorido, texto e ação opcional. */
export function Notice({ tone = "info", children, action, className }: { tone?: NoticeTone; children: ReactNode; action?: ReactNode; className?: string }) {
  const s = NOTICE[tone];
  return (
    <div role={tone === "crit" ? "alert" : "status"} className={cn("flex items-center gap-3 rounded-2xl px-4 py-3 text-sm", s.box, className)}>
      <span className={cn("size-2 shrink-0 rounded-full", s.dot)} aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      {action ? <span className="shrink-0 font-semibold">{action}</span> : null}
    </div>
  );
}

/** Sucesso de fim de processo (ex.: inventário concluído) com número grande. */
export function SuccessHero({ value, title, detail, action, className }: { value: string; title: string; detail?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <section className={cn("relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl bg-[#03061A] px-6 py-10 text-center text-creme-100", className)}>
      <span className="font-display text-7xl leading-none font-bold tracking-tighter sm:text-8xl">{value}</span>
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {detail ? <p className="text-sm text-ceu-300">{detail}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </section>
  );
}
