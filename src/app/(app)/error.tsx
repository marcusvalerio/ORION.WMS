"use client";

import { useEffect } from "react";
import { buttonClass } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-xl py-10">
      <Alert level="danger" title="Não foi possível carregar esta tela">
        Ocorreu um erro inesperado. Nenhuma operação parcial foi gravada: operações críticas são transacionais.
        {error.digest ? <span className="mt-1 block font-mono text-xs">Código: {error.digest}</span> : null}
      </Alert>
      <button type="button" onClick={reset} className={buttonClass("secondary", "md", "mt-4")}>
        Tentar novamente
      </button>
    </div>
  );
}
