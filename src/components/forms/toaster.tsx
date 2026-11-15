"use client";

import { useSyncExternalStore } from "react";
import { X } from "lucide-react";
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
        return (
          <div
            key={t.id}
            role={t.ok ? "status" : "alert"}
            className={cn(
              "orion-in pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-lg",
              t.ok ? "bg-noite-900 text-creme-100" : "border border-crit-line bg-crit-bg text-crit-fg",
            )}
          >
            <span className={cn("size-2 shrink-0 rounded-full", t.ok ? "bg-ok-solid" : "bg-crit-solid")} aria-hidden />
            <p className="flex-1">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} className={cn("rounded-full p-1", t.ok ? "text-ceu-300 hover:text-creme-100" : "hover:opacity-80")} aria-label="Fechar aviso">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
