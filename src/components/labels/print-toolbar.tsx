"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";

/** Barra de ações da tela de impressão (oculta no papel). */
export function PrintToolbar({ backHref, title, count, children }: { backHref: string; title: string; count: number; children?: React.ReactNode }) {
  return (
    <div className="no-print sticky top-0 z-10 mb-4 border-b border-line bg-surface px-4 py-3">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <Link href={backHref} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line-strong px-3 text-sm text-fg-2 hover:bg-canvas">
          <ArrowLeft className="size-4" aria-hidden /> Voltar
        </Link>
        <h1 className="text-base font-semibold text-fg">{title}</h1>
        <span className="text-sm text-muted">{count} etiqueta(s)</span>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={count === 0}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md bg-action px-3.5 text-sm font-medium text-on-action hover:bg-action-hover disabled:opacity-50"
        >
          <Printer className="size-4" aria-hidden /> Imprimir
        </button>
      </div>
      {children ? <div className="mx-auto mt-3 max-w-5xl">{children}</div> : null}
    </div>
  );
}
