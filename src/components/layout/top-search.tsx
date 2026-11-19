import Link from "next/link";
import { ScanBarcode, Search } from "lucide-react";

/**
 * Busca do topo: pesquisa no estoque (SKU, descrição ou endereço). O ícone de
 * leitor de código de barras, à direita do campo, abre o modo coletor.
 */
export function TopSearch({ className }: { className?: string }) {
  return (
    <form action="/estoque" method="get" role="search" className={className}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          name="q"
          type="search"
          placeholder="Buscar SKU, descrição ou endereço"
          aria-label="Buscar no estoque"
          className="h-9 w-full rounded-md border border-line-strong bg-surface pr-11 pl-8 text-sm placeholder:text-muted focus:border-focus focus:ring-2 focus:ring-focus/20 focus:outline-none"
        />
        <Link
          href="/coletor"
          data-tour="leitor"
          title="Abrir o coletor (leitura de código de barras)"
          aria-label="Abrir o coletor (leitura de código de barras)"
          className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded text-muted hover:bg-subtle hover:text-link"
        >
          <ScanBarcode className="size-5" aria-hidden />
        </Link>
      </div>
    </form>
  );
}
