"use client";

import { useEffect } from "react";
import { buttonClass } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorState
      className="py-16"
      title="Não foi possível carregar esta tela"
      description="Ocorreu um erro inesperado. Nenhuma operação parcial foi gravada: operações críticas são transacionais."
      detail={error.digest ? `Código: ${error.digest}` : undefined}
      actions={
        <button type="button" onClick={reset} className={buttonClass("primary", "md", "rounded-full")}>
          Tentar de novo
        </button>
      }
    />
  );
}
