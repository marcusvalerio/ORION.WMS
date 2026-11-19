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
import { Novidades, NovidadesGift } from "@/components/novidades/novidades";
import { RELEASES } from "@/content/novidades";
import { NOVIDADES_COOKIE, novidadesDoUsuario, parseVistas } from "@/lib/novidades";
import { versoesVistas } from "@/server/services/novidades";
import { isDemoMode } from "@/server/demo-mode";
import { OnboardingReopen, OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { ONBOARDING_COOKIE, onboardingVistoNoCookie, passosOnboarding } from "@/lib/onboarding";
import { empresaVinculadaAtlas, prepararPrimeiroAcesso } from "@/server/services/onboarding";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, db } = await requireCtx();
  if (user.mustChangePassword) redirect("/trocar-senha");
  const company = await getCompanyProfile(db, user.companyId);
  const companyTitle = [company.legal_name, company.document_formatted ? `CNPJ ${company.document_formatted}` : null].filter(Boolean).join(" — ");
  const cookieStore = await cookies();
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);
  // Novidades: "visto" fica no banco por usuário; no modo demonstração, em cookie.
  // Primeiros passos: só no primeiro acesso; enquanto pendente, as Novidades não abrem.
  const demo = isDemoMode();
  const primeiro = demo
    ? { pendente: !onboardingVistoNoCookie(cookieStore.get(ONBOARDING_COOKIE)?.value), vinculadaAtlas: await empresaVinculadaAtlas({ db, user }) }
    : await prepararPrimeiroAcesso({ db, user }, RELEASES[0]?.versao);
  const vistas = demo ? parseVistas(cookieStore.get(NOVIDADES_COOKIE)?.value) : await versoesVistas({ db, user });
  const novidadesBase = novidadesDoUsuario(RELEASES, user.role, vistas);
  const novidades = novidadesBase && primeiro.pendente ? { ...novidadesBase, pendente: false } : novidadesBase;
  const gift = novidades ? <NovidadesGift pendente={novidades.pendente} total={novidades.itens.length} /> : null;
  const allowed = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(user.role, p));
  return (
    <div className="min-h-dvh">
      <Sidebar allowed={allowed} />
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 hidden h-14 items-center justify-between border-b border-line bg-surface/90 px-6 backdrop-blur lg:flex">
          <div className="flex shrink-0 items-center gap-2 text-sm" title={companyTitle || undefined}>
            <span className="font-medium whitespace-nowrap text-fg">{user.companyName}</span>
            {company.document_formatted ? <span className="hidden text-xs whitespace-nowrap text-muted xl:inline">CNPJ {company.document_formatted}</span> : null}
            {user.companyIsDemo ? <DemoBadge /> : null}
          </div>
          <TopSearch className="mx-6 w-full max-w-md" />
          <div className="flex shrink-0 items-center gap-3">
            {user.role === "operator" ? <CollectorLink /> : null}
            {gift}
            <UserMenu name={user.name} role={ROLE_LABELS[user.role]} theme={theme} />
          </div>
        </header>
        <div className="flex items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2 text-xs lg:hidden">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate font-medium text-fg-2">{user.companyName}</span>
            {user.companyIsDemo ? <DemoBadge className="shrink-0" /> : null}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {user.role === "operator" ? <CollectorLink /> : null}
            {gift}
            <UserMenu name={user.name} role={ROLE_LABELS[user.role]} theme={theme} compact />
          </span>
        </div>
        <TopSearch className="border-b border-line bg-surface px-4 py-2 lg:hidden" />
        <main className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 lg:py-6">{children}</main>
        <footer className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-4 text-xs text-muted sm:px-6">
          <span>
            <b className="font-display font-semibold text-fg-2">orion</b> wms · versão {RELEASES[0].versao}
          </span>
          <Link href="/sobre" className="hover:text-fg">
            Ecossistema <b className="font-display font-semibold tracking-[0.14em] text-fg-2">ASTRAEUS</b>
          </Link>
        </footer>
      </div>
      <Toaster />
      {novidades ? <Novidades view={novidades} /> : null}
      <OnboardingTour
        nome={user.name}
        passos={passosOnboarding(user.role, primeiro.vinculadaAtlas)}
        pendente={primeiro.pendente}
        versaoNovidades={RELEASES[0]?.versao}
      />
    </div>
  );
}

function UserMenu({ name, role, theme, compact }: { name: string; role: string; theme: ThemePref; compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {/* no celular o nome sai da barra compacta para não espremer a empresa */}
      <div className={compact ? "hidden text-right leading-tight sm:block" : "text-right leading-tight"}>
        <p className={compact ? "text-xs font-medium text-fg-2" : "text-sm font-medium text-fg"}>{name}</p>
        {!compact ? <p className="text-xs text-muted">{role}</p> : null}
      </div>
      <ThemeSwitcher initial={theme} />
      <OnboardingReopen />
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
      data-tour="coletor"
      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-action px-3 text-sm font-semibold text-on-action hover:bg-action-hover"
    >
      <Smartphone className="size-4" aria-hidden />
      Coletor
    </Link>
  );
}
