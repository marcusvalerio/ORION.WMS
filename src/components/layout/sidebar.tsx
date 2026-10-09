"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeftRight,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FileChartColumn,
  Gauge,
  LayoutDashboard,
  ListTodo,
  MapPin,
  Menu,
  Package,
  PackageCheck,
  PackagePlus,
  ScanLine,
  ShieldCheck,
  TriangleAlert,
  Truck,
  Warehouse,
  X,
  type LucideIcon,
} from "lucide-react";
import { NAV } from "./nav";
import { cn } from "@/components/ui/cn";

const ICONS: Record<string, LucideIcon> = {
  ArrowLeftRight,
  Boxes,
  ClipboardCheck,
  ClipboardList,
  FileChartColumn,
  Gauge,
  LayoutDashboard,
  ListTodo,
  MapPin,
  Package,
  PackageCheck,
  PackagePlus,
  ScanLine,
  ShieldCheck,
  TriangleAlert,
  Truck,
  Warehouse,
};

function isActive(pathname: string, href: string, match?: string[]) {
  if (href === "/") return pathname === "/";
  if (href === "/estoque") return pathname === "/estoque" || (match ?? []).some((m) => pathname.startsWith(m));
  return pathname === href || pathname.startsWith(`${href}/`) || (match ?? []).some((m) => pathname.startsWith(m));
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-2">
      <span className="flex size-8 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white">O</span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold tracking-tight text-slate-900">ORION WMS</span>
        <span className="block text-[11px] text-slate-500">Gestão de armazéns</span>
      </span>
    </Link>
  );
}

export function Sidebar({ allowed }: { allowed: string[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const nav = (
    <nav aria-label="Menu principal" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.permission || allowed.includes(i.permission));
        if (!items.length) return null;
        return (
          <div key={group.section}>
            <p className="mb-1 px-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{group.section}</p>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActive(pathname, item.href, item.match);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                        active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                      )}
                    >
                      <Icon className={cn("size-4", active ? "text-brand-600" : "text-slate-400")} aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-14 items-center border-b border-slate-100 px-3">
          <Brand />
        </div>
        {nav}
      </aside>
      {/* Mobile / tablet */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md p-2 text-slate-600 hover:bg-slate-100"
          aria-label="Abrir menu"
          aria-expanded={open}
        >
          <Menu className="size-5" />
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Fechar menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-white shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-slate-100 px-3">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Fechar menu">
                <X className="size-5" />
              </button>
            </div>
            {nav}
          </div>
        </div>
      ) : null}
    </>
  );
}
