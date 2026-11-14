import Link from "next/link";
import type { Viewport } from "next";
import { House, LogOut } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { logoutAction } from "@/server/actions/auth";
import { OrionMark } from "@/components/brand/orion-mark";
import { ROLE_LABELS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Coletor", template: "%s · Coletor ORION" } };
export const viewport: Viewport = { themeColor: "#060B2A", width: "device-width", initialScale: 1 };

/** Layout do coletor: sem menu lateral, alto contraste e alvos de toque grandes. */
export default async function CollectorLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireCtx();
  return (
    <div className="min-h-dvh bg-subtle text-fg">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 bg-noite-900 px-3 py-2 text-creme-50">
        <Link href="/coletor" className="flex min-h-12 items-center gap-2 rounded-lg px-2 font-display text-lg font-bold" aria-label="Menu do coletor">
          <OrionMark size={26} color="#7DB7F0" />
          <House className="size-6" aria-hidden />
          Coletor
        </Link>
        <div className="min-w-0 text-right leading-tight">
          <p className="truncate text-base font-semibold">{user.name}</p>
          <p className="truncate text-xs text-noite-200">{ROLE_LABELS[user.role]}</p>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="flex size-12 items-center justify-center rounded-lg hover:bg-noite-700" aria-label="Sair">
            <LogOut className="size-6" aria-hidden />
          </button>
        </form>
      </header>
      <main className="mx-auto w-full max-w-xl px-3 py-4">{children}</main>
    </div>
  );
}
