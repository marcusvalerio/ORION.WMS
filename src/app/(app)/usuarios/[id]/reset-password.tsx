"use client";

import { useActionState, startTransition } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { resetPasswordAction, type ResetPasswordState } from "@/server/actions/users";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { buttonClass } from "@/components/ui/button";
import { FormMessage } from "@/components/forms/action-form";

/** Redefinição de senha: a senha temporária aparece só nesta resposta. */
export function ResetPassword({ userId, disabled }: { userId: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState<ResetPasswordState, FormData>(resetPasswordAction, INITIAL_ACTION_STATE);
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!window.confirm("Gerar uma senha temporária? A senha atual deixa de valer imediatamente.")) return;
    const fd = new FormData(event.currentTarget);
    startTransition(() => action(fd));
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="_id" value={userId} />
      <button type="submit" disabled={pending || disabled} className={buttonClass("secondary", "sm")}>
        {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
        Redefinir senha
      </button>
      {state.ok && state.temporaryPassword ? (
        <div role="status" className="rounded-md border border-warn-line bg-warn-bg p-3 text-sm text-warn-fg">
          <p className="font-medium">Senha temporária (exibida só agora):</p>
          <p className="mt-1 font-mono text-base tracking-wide select-all">{state.temporaryPassword}</p>
          <p className="mt-1 text-xs">Entregue ao usuário por um canal seguro. A troca será exigida no próximo acesso.</p>
        </div>
      ) : null}
      {state.message && !state.ok ? <FormMessage state={state} /> : null}
    </form>
  );
}
