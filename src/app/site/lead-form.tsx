"use client";

import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";
import { registrarLeadAction } from "@/server/actions/novidades";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";

export function LeadForm() {
  const [state, action, pending] = useActionState(registrarLeadAction, INITIAL_ACTION_STATE);
  if (state.ok) {
    return (
      <p role="status" className="relative w-full max-w-[620px] rounded-[28px] bg-noite-900 px-6 py-5 text-lg font-semibold text-creme-100">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} aria-label="Garantir vaga" className="relative flex w-full max-w-[620px] flex-wrap justify-center gap-2.5">
      <label className="flex flex-[1_1_300px]">
        <span className="sr-only">E-mail de trabalho</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="seu e-mail de trabalho"
          className="h-[62px] flex-1 rounded-full border-2 border-noite-900 bg-white px-[22px] text-[17px] text-noite-900 placeholder:text-gelo-600 focus:ring-4 focus:ring-ceu-400/40 focus:outline-none"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-[62px] items-center gap-2 rounded-full bg-noite-900 px-8 text-[17px] font-bold text-creme-100 hover:bg-noite-700 disabled:opacity-70"
      >
        {pending ? <LoaderCircle className="size-5 motion-safe:animate-spin" aria-hidden /> : null}
        {pending ? "Enviando…" : "Garantir minha vaga"}
      </button>
      {state.message ? (
        <p role="alert" className="w-full text-sm font-medium text-crit-fg">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
