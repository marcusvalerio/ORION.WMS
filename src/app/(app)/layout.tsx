import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound, LogOut, Smartphone } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { getCompanyProfile } from "@/server/services/company";
import { logoutAction } from "@/server/actions/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { TopSearch } from "@/components/layout/top-search";
import { Toaster } from "@/components/forms/toaster";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme, type ThemePref } from "@/lib/theme";
import { DemoBadge } from "@/components/ui/badge";
import { PERMISSIONS, ROLE_LABELS, can, type Permission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, db } = await requireCtx();
  if (user.mustChangePassword) redirect("/trocar-senha");
  const company = await getCompanyProfile(db, user.companyId);
  const companyTitle = [company.legal_name, company.document_formatted ? `CNPJ ${company.document_formatted}` : null].filter(Boolean).join(" — ");
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const allowed = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(user.role, p));
  return (
    <div className="min-h-dvh">
      <Sidebar allowed={allowed} />
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 hidden h-14 items-center justify-between border-b border-line bg-surface/90 px-6 backdrop-blur lg:flex">
          <div className="flex items-center gap-2 text-sm" title={companyTitle || undefined}>
            <span className="font-medium text-fg">{user.companyName}</span>
            {company.document_formatted ? <span className="text-xs text-muted">CNPJ {company.document_formatted}</span> : null}
            {user.companyIsDemo ? <DemoBadge /> : null}
          </div>
          <TopSearch className="mx-6 w-full max-w-md" />
          <div className="flex shrink-0 items-center gap-3">
            {user.role === "operator" ? <CollectorLink /> : null}
            <UserMenu name={user.name} role={ROLE_LABELS[user.role]} theme={theme} />
          </div>
        </header>
        <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2 text-xs lg:hidden">
          <span className="flex items-center gap-2 truncate">
            <span className="truncate font-medium text-fg-2">{user.companyName}</span>
            {user.companyIsDemo ? <DemoBadge /> : null}
          </span>
          <span className="flex items-center gap-2">
            {user.role === "operator" ? <CollectorLink /> : null}
            <UserMenu name={user.name} role={ROLE_LABELS[user.role]} theme={theme} compact />
          </span>
        </div>
        <TopSearch className="border-b border-line bg-surface px-4 py-2 lg:hidden" />
        <main className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 lg:py-6">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}

function UserMenu({ name, role, theme, compact }: { name: string; role: string; theme: ThemePref; compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="text-right leading-tight">
        <p className={compact ? "text-xs font-medium text-fg-2" : "text-sm font-medium text-fg"}>{name}</p>
        {!compact ? <p className="text-xs text-muted">{role}</p> : null}
      </div>
      <ThemeSwitcher initial={theme} />
      <Link href="/trocar-senha" className="rounded-md p-2 text-muted hover:bg-subtle hover:text-fg" title="Trocar senha" aria-label="Trocar senha">
        <KeyRound className="size-4" />
      </Link>
      <form action={logoutAction}>
        <button type="submit" className="rounded-md p-2 text-muted hover:bg-subtle hover:text-fg" title="Sair" aria-label="Sair">
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
      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-action px-3 text-sm font-semibold text-on-action hover:bg-action-hover"
    >
      <Smartphone className="size-4" aria-hidden />
      Coletor
    </Link>
  );
}
