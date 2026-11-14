import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound, LogOut, Smartphone } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { logoutAction } from "@/server/actions/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { TopSearch } from "@/components/layout/top-search";
import { Toaster } from "@/components/forms/toaster";
import { DemoBadge } from "@/components/ui/badge";
import { PERMISSIONS, ROLE_LABELS, can, type Permission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireCtx();
  if (user.mustChangePassword) redirect("/trocar-senha");
  const allowed = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(user.role, p));
  return (
    <div className="min-h-dvh">
      <Sidebar allowed={allowed} />
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 hidden h-14 items-center justify-between border-b border-slate-200 bg-white/90 px-6 backdrop-blur lg:flex">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-slate-800">{user.companyName}</span>
            {user.companyIsDemo ? <DemoBadge /> : null}
          </div>
          <TopSearch className="mx-6 w-full max-w-md" />
          <div className="flex shrink-0 items-center gap-3">
            {user.role === "operator" ? <CollectorLink /> : null}
            <UserMenu name={user.name} role={ROLE_LABELS[user.role]} />
          </div>
        </header>
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 text-xs lg:hidden">
          <span className="flex items-center gap-2 truncate">
            <span className="truncate font-medium text-slate-700">{user.companyName}</span>
            {user.companyIsDemo ? <DemoBadge /> : null}
          </span>
          <span className="flex items-center gap-2">
            {user.role === "operator" ? <CollectorLink /> : null}
            <UserMenu name={user.name} role={ROLE_LABELS[user.role]} compact />
          </span>
        </div>
        <TopSearch className="border-b border-slate-200 bg-white px-4 py-2 lg:hidden" />
        <main className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 lg:py-6">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}

function UserMenu({ name, role, compact }: { name: string; role: string; compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-right leading-tight">
        <p className={compact ? "text-xs font-medium text-slate-700" : "text-sm font-medium text-slate-800"}>{name}</p>
        {!compact ? <p className="text-xs text-slate-500">{role}</p> : null}
      </div>
      <Link href="/trocar-senha" className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Trocar senha" aria-label="Trocar senha">
        <KeyRound className="size-4" />
      </Link>
      <form action={logoutAction}>
        <button type="submit" className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Sair" aria-label="Sair">
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}

/** Atalho para o modo coletor, exibido no topo para o perfil operador. */
function CollectorLink() {
  return (
    <Link
      href="/coletor"
      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700"
    >
      <Smartphone className="size-4" aria-hidden />
      Coletor
    </Link>
  );
}
