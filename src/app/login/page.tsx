import { OrionMark } from "@/components/brand/orion-mark";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLoggedUser } from "@/server/auth/session";
import { isDemoMode } from "@/server/demo-mode";
import { getDb } from "@/server/db";
import { listDemoUsers } from "@/server/auth/users";
import { LoginForm } from "./login-form";
import { ROLE_LABELS, type Role } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await getLoggedUser()) redirect("/");
  const demoUsers = await listDemoUsers(await getDb());
  return (
    <div className="flex min-h-dvh items-center justify-center bg-subtle px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex size-10 items-center justify-center rounded-lg bg-ceu-400 text-noite-900">
            <OrionMark size={32} />
          </span>
          <div>
            <p className="font-display text-xl font-semibold tracking-tight text-fg">orion <span className="font-normal text-muted">wms</span></p>
            <p className="text-xs text-muted">Gestão de armazéns integrada ao ERP</p>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
          <h1 className="text-base font-semibold text-fg">Entrar</h1>
          <p className="mt-1 text-sm text-muted">Use suas credenciais corporativas.</p>
          <LoginForm demoUsers={demoUsers.map((u) => ({ ...u, roleLabel: ROLE_LABELS[u.role as Role] }))} />
        </div>
        {isDemoMode() ? (
          <p className="mt-4 text-center text-xs text-muted">
            Modo demonstração: sem login, o sistema abre como administradora.{" "}
            <Link href="/" className="font-medium text-link hover:underline">Voltar ao sistema</Link>
          </p>
        ) : null}
        {demoUsers.length ? (
          <p className="mt-4 text-center text-xs text-muted">
            Ambiente com <strong>dados de demonstração</strong> (empresa fictícia MetalSupply Componentes).
          </p>
        ) : null}
      </div>
    </div>
  );
}
