"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { claimTaskAction } from "@/server/actions/collector";
import { buzz } from "./kit";

/** Pega a tarefa (inicia e atribui ao operador) e abre a execução. */
export function ClaimButton({ taskId, label }: { taskId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await claimTaskAction(taskId);
          if (!r.ok) {
            buzz("error");
            setError(r.message);
            setBusy(false);
            return;
          }
          buzz("ok");
          router.push(`/coletor/tarefas/${taskId}`);
        }}
        className="flex min-h-14 w-full items-center justify-center rounded-xl bg-brand-700 px-4 text-xl font-bold text-white disabled:opacity-50"
      >
        {busy ? "Abrindo…" : label}
      </button>
      {error ? (
        <p role="alert" className="mt-2 rounded-lg bg-red-600 p-3 text-base font-semibold text-white">
          {error}
        </p>
      ) : null}
    </div>
  );
}
