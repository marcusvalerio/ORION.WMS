import Link from "next/link";
import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { buttonClass } from "./button";

/** Barra de filtros via GET (funciona sem JavaScript e mantém a URL compartilhável). */
export function FilterBar({ children, resetHref, action }: { children: ReactNode; resetHref: string; action?: string }) {
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3">
      {children}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass("secondary", "md")}>
          <Search className="size-4" aria-hidden />
          Filtrar
        </button>
        <Link href={resetHref} className={buttonClass("ghost", "md")}>
          Limpar
        </Link>
      </div>
    </form>
  );
}

export function FilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    // o rótulo envolve o campo: associação implícita para leitores de tela
    <label className={`block ${className ?? "w-full sm:w-48"}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
