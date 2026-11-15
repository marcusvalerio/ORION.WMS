"use client";

import { useActionState, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { loginAction } from "@/server/actions/auth";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";

const DEMO_PASSWORD_HINT = "orion-demo";

const INPUT =
  "h-12 w-full rounded-xl border border-noite-600 bg-[#03061A] px-3.5 text-[15px] text-creme-100 placeholder:text-gelo-500 focus:border-ceu-400 focus:ring-2 focus:ring-ceu-400/30 focus:outline-none";

export function LoginForm({ demoUsers }: { demoUsers: { email: string; name: string; role: string; roleLabel: string }[] }) {
  const [state, action, pending] = useActionState(loginAction, INITIAL_ACTION_STATE);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <>
      <form action={action} className="flex flex-col gap-[18px]" aria-label="Entrar">
        <label className="flex flex-col gap-1.5 text-[13px] text-ceu-300">
          E-mail
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            placeholder="voce@empresa.com.br"
            className={INPUT}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-ceu-300">
          Senha
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            className={INPUT}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <p className="-mt-1 text-right text-[13px] text-ceu-300">Esqueceu a senha? Peça ao administrador.</p>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-[54px] items-center justify-center gap-2 rounded-full bg-creme-100 text-[15px] font-semibold text-noite-900 hover:bg-white disabled:opacity-70"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          Entrar
        </button>
        {state.message && !state.ok ? (
          <p role="alert" className="rounded-xl bg-crit-solid/15 px-3 py-2 text-sm text-[#FFA3A9]">
            {state.message}
          </p>
        ) : null}
      </form>
      {demoUsers.length ? (
        <div className="border-t border-noite-600 pt-4">
          <p className="text-xs font-medium text-creme-100">Perfis de demonstração</p>
          <p className="mt-0.5 text-xs text-ceu-300">
            Clique para preencher. Senha: <code className="font-mono">{DEMO_PASSWORD_HINT}</code>
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {demoUsers.map((u) => (
              <button
                key={u.email}
                type="button"
                onClick={() => {
                  setEmail(u.email);
                  setPassword(DEMO_PASSWORD_HINT);
                }}
                className="rounded-xl border border-noite-600 px-2.5 py-2 text-left hover:border-ceu-400 hover:bg-noite-800"
              >
                <span className="block text-xs font-medium text-creme-100">{u.roleLabel}</span>
                <span className="block truncate text-[11px] text-ceu-300">{u.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
