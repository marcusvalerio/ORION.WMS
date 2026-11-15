import Link from "next/link";
import { redirect } from "next/navigation";
import { getLoggedUser } from "@/server/auth/session";
import { isDemoMode } from "@/server/demo-mode";
import { getDb } from "@/server/db";
import { listDemoUsers } from "@/server/auth/users";
import { OrionRing } from "@/components/brand/orion-ring";
import { LoginForm } from "./login-form";
import { ROLE_LABELS, type Role } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar" };

export default async function LoginPage() {
  if (await getLoggedUser()) redirect("/");
  const demoUsers = await listDemoUsers(await getDb());
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#03061A] px-4 py-10 text-creme-100" style={{ colorScheme: "dark" }}>
      {/* Dois anéis "O" gigantes, girando em sentidos opostos, com a onda percorrendo as barras. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <OrionRing size="max(1640px, 180vmin)" bars={84} palette="externo" direction="cw" spinSeconds={240} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        <OrionRing
          size="max(1100px, 120vmin)"
          bars={64}
          palette="interno"
          direction="ccw"
          spinSeconds={180}
          barWidth={220}
          barLength={300}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(3,6,26,0)_0%,rgba(3,6,26,0)_30%,rgba(3,6,26,0.55)_75%)]" />
      </div>

      <div className="relative flex w-full max-w-[380px] flex-col gap-[18px] rounded-[28px] border border-noite-600 bg-noite-900 p-8 sm:p-10">
        <span className="font-display text-[34px] leading-none font-bold tracking-[-0.03em]">orion</span>
        <div>
          <h1 className="font-display text-2xl font-semibold">Bom te ver de novo</h1>
          <p className="mt-1.5 text-sm text-ceu-300">Entre para abrir o seu armazém.</p>
        </div>
        <LoginForm demoUsers={demoUsers.map((u) => ({ ...u, roleLabel: ROLE_LABELS[u.role as Role] }))} />
        {isDemoMode() ? (
          <p className="text-center text-xs text-ceu-300">
            Modo demonstração: sem login, o sistema abre como administradora.{" "}
            <Link href="/" className="font-medium text-ceu-400 underline-offset-2 hover:text-creme-100 hover:underline">
              Voltar ao sistema
            </Link>
          </p>
        ) : null}
        {demoUsers.length ? (
          <p className="text-center text-xs text-ceu-300">
            Ambiente com <strong className="text-creme-100">dados de demonstração</strong> (empresa fictícia MetalSupply Componentes).
          </p>
        ) : null}
        <p className="text-center text-xs text-ceu-300">
          Ecossistema <b className="font-display font-semibold tracking-[0.14em] text-creme-100">ASTRAEUS</b>
        </p>
      </div>
    </div>
  );
}
