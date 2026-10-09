"use client";

import { useActionState, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { loginAction } from "@/server/actions/auth";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { buttonClass } from "@/components/ui/button";
import { FormMessage } from "@/components/forms/action-form";

const DEMO_PASSWORD_HINT = "orion-demo";

export function LoginForm({ demoUsers }: { demoUsers: { email: string; name: string; role: string; roleLabel: string }[] }) {
  const [state, action, pending] = useActionState(loginAction, INITIAL_ACTION_STATE);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <>
      <form action={action} className="mt-5 space-y-4">
        <div>
          <label htmlFor="email" className="label">
            E-mail
          </label>
          <input id="email" name="email" type="email" autoComplete="username" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="password" className="label">
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" disabled={pending} className={buttonClass("primary", "md", "w-full")}>
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          Entrar
        </button>
        {state.message ? <FormMessage state={state} /> : null}
      </form>
      {demoUsers.length ? (
        <div className="mt-6 border-t border-slate-100 pt-4">
          <p className="text-xs font-medium text-slate-600">Perfis de demonstração</p>
          <p className="mt-0.5 text-xs text-slate-500">Clique para preencher. Senha de demonstração: <code className="code">{DEMO_PASSWORD_HINT}</code></p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {demoUsers.map((u) => (
              <button
                key={u.email}
                type="button"
                onClick={() => {
                  setEmail(u.email);
                  setPassword(DEMO_PASSWORD_HINT);
                }}
                className="rounded-md border border-slate-200 px-2.5 py-2 text-left hover:border-brand-300 hover:bg-brand-50"
              >
                <span className="block text-xs font-medium text-slate-800">{u.roleLabel}</span>
                <span className="block truncate text-[11px] text-slate-500">{u.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
