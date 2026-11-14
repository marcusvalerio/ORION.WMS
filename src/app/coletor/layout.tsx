import Link from "next/link";
import type { Viewport } from "next";
import { House, LogOut } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { logoutAction } from "@/server/actions/auth";
import { ROLE_LABELS } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Coletor", template: "%s · Coletor ORION" } };
export const viewport: Viewport = { themeColor: "#0f172a", width: "device-width", initialScale: 1 };

/** Layout do coletor: sem menu lateral, alto contraste e alvos de toque grandes. */
export default async function CollectorLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireCtx();
  return (
    <div className="min-h-dvh bg-slate-100 text-slate-950">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-2 bg-slate-900 px-3 py-2 text-white">
        <Link href="/coletor" className="flex min-h-12 items-center gap-2 rounded-lg px-2 text-lg font-bold" aria-label="Menu do coletor">
          <House className="size-6" aria-hidden />
          Coletor
        </Link>
        <div className="min-w-0 text-right leading-tight">
          <p className="truncate text-base font-semibold">{user.name}</p>
          <p className="truncate text-xs text-slate-300">{ROLE_LABELS[user.role]}</p>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="flex size-12 items-center justify-center rounded-lg hover:bg-slate-800" aria-label="Sair">
            <LogOut className="size-6" aria-hidden />
          </button>
        </form>
      </header>
      <main className="mx-auto w-full max-w-xl px-3 py-4">{children}</main>
    </div>
  );
}
