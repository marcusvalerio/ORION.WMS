import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas px-4 text-center">
      <p className="text-sm font-semibold text-link">404</p>
      <h1 className="text-xl font-semibold text-fg">Página ou registro não encontrado</h1>
      <p className="max-w-md text-sm text-muted">O endereço pode estar incorreto ou o registro não pertence à sua empresa.</p>
      <Link href="/painel" className={buttonClass("primary")}>
        Voltar ao dashboard
      </Link>
    </div>
  );
}
