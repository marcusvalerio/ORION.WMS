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
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          name="q"
          type="search"
          placeholder="Buscar SKU, descrição ou endereço"
          aria-label="Buscar no estoque"
          className="h-9 w-full rounded-md border border-slate-300 bg-white pr-11 pl-8 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
        />
        <Link
          href="/coletor"
          title="Abrir o coletor (leitura de código de barras)"
          aria-label="Abrir o coletor (leitura de código de barras)"
          className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-brand-700"
        >
          <ScanBarcode className="size-5" aria-hidden />
        </Link>
      </div>
    </form>
  );
}
