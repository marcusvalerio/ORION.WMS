"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, Keyboard, ScanLine } from "lucide-react";
import { cn } from "@/components/ui/cn";

export type Tone = "ok" | "error" | "info";
export interface Feedback {
  tone: Tone;
  text: string;
}

/** Vibra o aparelho quando suportado (coletores Android e celulares). */
export function buzz(tone: Tone) {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  navigator.vibrate(tone === "error" ? [220, 90, 220] : tone === "ok" ? 70 : 0);
}

/** Estado de feedback que já dispara a vibração correspondente. */
export function useFeedback(initial: Feedback | null = null) {
  const [feedback, setFeedback] = useState<Feedback | null>(initial);
  const show = (tone: Tone, text: string) => {
    buzz(tone);
    setFeedback({ tone, text });
  };
  return { feedback, show, clear: () => setFeedback(null) };
}

const TONES: Record<Tone, string> = {
  ok: "border-emerald-700 bg-emerald-600 text-white",
  error: "border-red-800 bg-red-600 text-white",
  info: "border-slate-300 bg-white text-slate-900",
};

export function FeedbackBanner({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  const Icon = feedback.tone === "ok" ? CircleCheck : feedback.tone === "error" ? CircleAlert : Info;
  return (
    <div
      role={feedback.tone === "error" ? "alert" : "status"}
      aria-live="assertive"
      className={cn("flex items-start gap-3 rounded-xl border-2 p-4 text-lg font-semibold", TONES[feedback.tone])}
    >
      <Icon className="mt-0.5 size-7 shrink-0" aria-hidden />
      <span>{feedback.text}</span>
    </div>
  );
}

/**
 * Campo de leitura. Leitores físicos funcionam como teclado: digitam o código e
 * enviam Enter. O campo fica sempre focado; por padrão o teclado virtual não abre
 * (inputMode "none") — o botão de teclado libera a digitação manual.
 */
export function ScanField({
  label,
  hint,
  onScan,
  busy,
  numeric,
  initial = "",
  submitLabel = "Confirmar",
}: {
  label: string;
  hint?: string;
  onScan: (value: string) => void | Promise<void>;
  busy?: boolean;
  numeric?: boolean;
  initial?: string;
  submitLabel?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const [manual, setManual] = useState(numeric ?? false);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    // Mantém o foco: ao tocar em área vazia da tela o leitor continua funcionando.
    const refocus = () =>
      window.setTimeout(() => {
        const active = document.activeElement;
        if (!active || active === document.body) input.focus();
      }, 60);
    input.addEventListener("blur", refocus);
    return () => input.removeEventListener("blur", refocus);
  }, [manual]);

  useEffect(() => {
    if (!busy) ref.current?.focus();
  }, [busy]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const v = value.trim();
    if (!v || busy) return;
    await onScan(v);
    if (!numeric) setValue("");
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="mb-1 flex items-center gap-2 text-lg font-bold text-slate-900">
          <ScanLine className="size-6 text-brand-600" aria-hidden />
          {label}
        </span>
        {hint ? <span className="mb-2 block text-base text-slate-600">{hint}</span> : null}
        <div className="flex gap-2">
          <input
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode={numeric ? "decimal" : manual ? "text" : "none"}
            type="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="go"
            aria-label={label}
            className="h-16 min-w-0 flex-1 rounded-xl border-2 border-slate-900 bg-white px-4 font-mono text-2xl text-slate-950 outline-none focus:border-brand-600 focus:ring-4 focus:ring-brand-200"
          />
          {!numeric ? (
            <button
              type="button"
              onClick={() => {
                setManual((m) => !m);
                ref.current?.focus();
              }}
              aria-pressed={manual}
              aria-label={manual ? "Ocultar teclado" : "Digitar manualmente"}
              className={cn(
                "flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border-2",
                manual ? "border-brand-700 bg-brand-600 text-white" : "border-slate-900 bg-white text-slate-900",
              )}
            >
              <Keyboard className="size-7" aria-hidden />
            </button>
          ) : null}
        </div>
      </label>
      <BigButton type="submit" disabled={busy || !value.trim()}>
        {busy ? "Validando…" : submitLabel}
      </BigButton>
    </form>
  );
}

export function BigButton({
  children,
  variant = "primary",
  className,
  ...props
}: React.ComponentProps<"button"> & { variant?: "primary" | "secondary" | "success" | "danger" }) {
  return (
    <button
      {...props}
      className={cn(
        "flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-xl font-bold transition-colors disabled:opacity-50",
        variant === "primary" && "bg-brand-700 text-white active:bg-brand-800",
        variant === "secondary" && "border-2 border-slate-900 bg-white text-slate-900 active:bg-slate-100",
        variant === "success" && "bg-emerald-700 text-white active:bg-emerald-800",
        variant === "danger" && "bg-red-700 text-white active:bg-red-800",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function InfoRow({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="flex flex-col border-b border-slate-200 py-2 last:border-0">
      <span className="text-sm font-semibold tracking-wide text-slate-600 uppercase">{label}</span>
      <span className={cn("break-words text-slate-950", strong ? "font-mono text-2xl font-bold" : "text-lg")}>{children}</span>
    </div>
  );
}

export function StepDots({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex gap-1.5" aria-label="Etapas">
      {steps.map((s, i) => (
        <li
          key={s}
          aria-current={i === current ? "step" : undefined}
          className={cn(
            "flex-1 rounded-md py-1.5 text-center text-xs font-bold uppercase",
            i < current ? "bg-emerald-700 text-white" : i === current ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-600",
          )}
        >
          {s}
        </li>
      ))}
    </ol>
  );
}
