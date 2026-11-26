"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { ClipboardCheck, LogOut } from "lucide-react";
import { cn } from "@/components/ui/cn";

/**
 * "Modo inventário" em tela cheia: enquanto a tela está aberta, a página inteira
 * (barra superior e menu inclusive) assume os papéis do modo noite (`data-mode` no
 * <html>, canvas #03061A). Mostra a pílula "Modo inventário" e "Sair do modo".
 */
export function InventoryMode({ children, className, exitHref = "/inventario" }: { children: ReactNode; className?: string; exitHref?: string }) {
  useEffect(() => {
    const html = document.documentElement;
    const previous = html.dataset.mode;
    html.dataset.mode = "inventory";
    return () => {
      if (previous) html.dataset.mode = previous;
      else delete html.dataset.mode;
    };
  }, []);
  return (
    <div data-mode="inventory" className={cn("text-fg", className)}>
      <div role="note" className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-accent px-3.5 text-sm font-semibold tracking-wide text-accent uppercase">
          <ClipboardCheck className="size-4" aria-hidden />
          Modo inventário
        </span>
        <Link
          href={exitHref}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong px-4 text-sm text-fg-2 hover:bg-subtle"
        >
          <LogOut className="size-4" aria-hidden /> Sair do modo
        </Link>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}
