"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Camera, CircleAlert, CircleCheck, Info, Keyboard, ScanLine } from "lucide-react";
import { CameraScanner, cameraPreferred, saveCameraPreference } from "./camera-scanner";
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

const noSubscribe = () => () => {};

const TONES: Record<Tone, string> = {
  ok: "border-ok-solid bg-ok-solid text-on-solid",
  error: "border-crit-solid bg-crit-solid text-on-solid",
  info: "border-line-strong bg-surface text-fg",
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
 *
 * No celular sem leitor físico a câmera abre sozinha e lê a etiqueta; o botão de
 * câmera abre e fecha, e a escolha fica guardada no aparelho. Se um leitor físico
 * digitar no campo com a câmera aberta, a câmera fecha (o aparelho tem leitor).
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
  // No servidor a câmera começa fechada; no navegador segue a preferência do aparelho.
  const preferred = useSyncExternalStore(noSubscribe, () => !numeric && cameraPreferred(), () => false);
  const [override, setOverride] = useState<boolean | null>(null);
  const camera = override ?? preferred;

  function toggleCamera(on: boolean) {
    setOverride(on);
    saveCameraPreference(on);
    if (!on) ref.current?.focus();
  }

  async function fromCamera(code: string) {
    if (busy) return;
    setValue(code);
    await onScan(code);
    if (!numeric) setValue("");
  }

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
        <span className="mb-1 flex items-center gap-2 text-lg font-bold text-fg">
          <ScanLine className="size-6 text-link" aria-hidden />
          {label}
        </span>
        {hint ? <span className="mb-2 block text-base text-fg-2">{hint}</span> : null}
        <div className="flex gap-2">
          <input
            ref={ref}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              // Digitou sem o teclado virtual com a câmera aberta: é um leitor físico.
              if (camera && !manual) toggleCamera(false);
            }}
            inputMode={numeric ? "decimal" : manual ? "text" : "none"}
            type="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="go"
            aria-label={label}
            className="h-16 min-w-0 flex-1 rounded-xl border-2 border-fg bg-surface px-4 font-mono text-2xl text-fg outline-none focus:border-focus focus:ring-4 focus:ring-focus"
          />
          {!numeric ? (
            <button
              type="button"
              onClick={() => toggleCamera(!camera)}
              aria-pressed={camera}
              aria-label={camera ? "Fechar câmera" : "Ler com a câmera"}
              className={cn(
                "flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border-2",
                camera ? "border-focus bg-action text-on-action" : "border-fg bg-surface text-fg",
              )}
            >
              <Camera className="size-7" aria-hidden />
            </button>
          ) : null}
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
                manual ? "border-focus bg-action text-on-action" : "border-fg bg-surface text-fg",
              )}
            >
              <Keyboard className="size-7" aria-hidden />
            </button>
          ) : null}
        </div>
      </label>
      {camera && !numeric ? <CameraScanner onDetect={fromCamera} onClose={() => toggleCamera(false)} /> : null}
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
        variant === "primary" && "bg-action text-on-action active:bg-action",
        variant === "secondary" && "border-2 border-fg bg-surface text-fg active:bg-subtle",
        variant === "success" && "bg-ok-solid text-on-solid active:brightness-90",
        variant === "danger" && "bg-crit-solid text-on-solid active:brightness-90",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function InfoRow({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="flex flex-col border-b border-line py-2 last:border-0">
      <span className="text-sm font-semibold tracking-wide text-fg-2 uppercase">{label}</span>
      <span className={cn("break-words text-fg", strong ? "font-mono text-2xl font-bold" : "text-lg")}>{children}</span>
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
            i < current ? "bg-ok-solid text-on-solid" : i === current ? "bg-action text-on-action" : "bg-line text-fg-2",
          )}
        >
          {s}
        </li>
      ))}
    </ol>
  );
}
