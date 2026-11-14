"use client";

import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";
import { changeOwnPasswordAction } from "@/server/actions/users";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { buttonClass } from "@/components/ui/button";
import { FormMessage } from "@/components/forms/action-form";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changeOwnPasswordAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="mt-5 space-y-4">
      <div>
        <label htmlFor="currentPassword" className="label">
          Senha atual
        </label>
        <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className="input" />
      </div>
      <div>
        <label htmlFor="newPassword" className="label">
          Nova senha
        </label>
        <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={8} className="input" />
      </div>
      <div>
        <label htmlFor="confirmPassword" className="label">
          Confirme a nova senha
        </label>
        <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required minLength={8} className="input" />
      </div>
      <button type="submit" disabled={pending} className={buttonClass("primary", "md", "w-full")}>
        {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
        Salvar nova senha
      </button>
      {state.message ? <FormMessage state={state} /> : null}
    </form>
  );
}
