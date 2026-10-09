import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
      <p className="text-sm font-semibold text-brand-600">404</p>
      <h1 className="text-xl font-semibold text-slate-900">Página ou registro não encontrado</h1>
      <p className="max-w-md text-sm text-slate-500">O endereço pode estar incorreto ou o registro não pertence à sua empresa.</p>
      <Link href="/" className={buttonClass("primary")}>
        Voltar ao dashboard
      </Link>
    </div>
  );
}
