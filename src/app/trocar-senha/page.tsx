import { OrionMark } from "@/components/brand/orion-mark";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { logoutAction } from "@/server/actions/auth";
import { PASSWORD_RULE } from "@/server/services/users";
import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Trocar senha" };

export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const forced = Boolean(user.mustChangePassword);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-subtle px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex size-10 items-center justify-center rounded-lg bg-ceu-400 text-noite-900">
            <OrionMark size={32} />
          </span>
          <p className="font-display text-xl font-semibold tracking-tight text-fg">orion <span className="font-normal text-muted">wms</span></p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
          <h1 className="text-base font-semibold text-fg">{forced ? "Defina uma nova senha" : "Trocar senha"}</h1>
          <p className="mt-1 text-sm text-muted">
            {forced
              ? `${user.name}, sua senha é temporária. Para continuar, defina uma senha pessoal.`
              : `${user.name} (${user.email})`}
          </p>
          <p className="mt-2 text-xs text-muted">{PASSWORD_RULE}</p>
          <ChangePasswordForm />
        </div>
        <div className="mt-4 flex items-center justify-center gap-4 text-xs text-muted">
          {!forced ? (
            <Link href="/" className="font-medium text-link hover:underline">
              Voltar ao sistema
            </Link>
          ) : null}
          <form action={logoutAction}>
            <button type="submit" className="font-medium text-fg-2 hover:underline">
              Sair
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
