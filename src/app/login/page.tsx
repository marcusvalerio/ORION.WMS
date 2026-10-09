import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listDemoUsers } from "@/server/auth/users";
import { LoginForm } from "./login-form";
import { ROLE_LABELS, type Role } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
  const demoUsers = await listDemoUsers(await getDb());
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex size-10 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold text-white">O</span>
          <div>
            <p className="text-lg font-semibold tracking-tight text-slate-900">ORION WMS</p>
            <p className="text-xs text-slate-500">Gestão de armazéns integrada ao ERP</p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-base font-semibold text-slate-900">Entrar</h1>
          <p className="mt-1 text-sm text-slate-500">Use suas credenciais corporativas.</p>
          <LoginForm demoUsers={demoUsers.map((u) => ({ ...u, roleLabel: ROLE_LABELS[u.role as Role] }))} />
        </div>
        {demoUsers.length ? (
          <p className="mt-4 text-center text-xs text-slate-500">
            Ambiente com <strong>dados de demonstração</strong> (empresa fictícia MetalSupply Componentes).
          </p>
        ) : null}
      </div>
    </div>
  );
}
