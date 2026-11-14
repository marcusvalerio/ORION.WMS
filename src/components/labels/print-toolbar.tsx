"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";

/** Barra de ações da tela de impressão (oculta no papel). */
export function PrintToolbar({ backHref, title, count, children }: { backHref: string; title: string; count: number; children?: React.ReactNode }) {
  return (
    <div className="no-print sticky top-0 z-10 mb-4 border-b border-slate-200 bg-white px-4 py-3">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        <Link href={backHref} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50">
          <ArrowLeft className="size-4" aria-hidden /> Voltar
        </Link>
        <h1 className="text-base font-semibold text-slate-900">{title}</h1>
        <span className="text-sm text-slate-500">{count} etiqueta(s)</span>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={count === 0}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-600 px-3.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          <Printer className="size-4" aria-hidden /> Imprimir
        </button>
      </div>
      {children ? <div className="mx-auto mt-3 max-w-5xl">{children}</div> : null}
    </div>
  );
}
