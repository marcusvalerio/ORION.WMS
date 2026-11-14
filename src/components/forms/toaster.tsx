"use client";

import { useSyncExternalStore } from "react";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { cn } from "@/components/ui/cn";

interface Toast {
  id: number;
  ok: boolean;
  message: string;
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Exibe uma notificação que sobrevive à re-renderização da tela após a ação. */
export function toast(message: string, ok = true) {
  const id = ++seq;
  toasts = [...toasts.slice(-3), { id, ok, message }];
  emit();
  setTimeout(() => dismiss(id), ok ? 6000 : 10000);
}

const EMPTY: Toast[] = [];

export function Toaster() {
  const items = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
    () => EMPTY,
  );
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end" aria-live="polite">
      {items.map((t) => {
        const Icon = t.ok ? CircleCheck : CircleAlert;
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-lg border bg-surface px-3 py-2.5 text-sm shadow-lg",
              t.ok ? "border-ok-line" : "border-crit-line",
            )}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", t.ok ? "text-ok-fg" : "text-crit-fg")} aria-hidden />
            <p className="flex-1 text-fg">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} className="text-muted hover:text-fg-2" aria-label="Fechar">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
