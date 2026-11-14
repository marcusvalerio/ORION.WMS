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
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex size-10 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold text-white">O</span>
          <p className="text-lg font-semibold tracking-tight text-slate-900">ORION WMS</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-base font-semibold text-slate-900">{forced ? "Defina uma nova senha" : "Trocar senha"}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {forced
              ? `${user.name}, sua senha é temporária. Para continuar, defina uma senha pessoal.`
              : `${user.name} (${user.email})`}
          </p>
          <p className="mt-2 text-xs text-slate-500">{PASSWORD_RULE}</p>
          <ChangePasswordForm />
        </div>
        <div className="mt-4 flex items-center justify-center gap-4 text-xs text-slate-500">
          {!forced ? (
            <Link href="/" className="font-medium text-brand-700 hover:underline">
              Voltar ao sistema
            </Link>
          ) : null}
          <form action={logoutAction}>
            <button type="submit" className="font-medium text-slate-600 hover:underline">
              Sair
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
