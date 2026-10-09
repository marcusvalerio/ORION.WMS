import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  badges,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  badges?: ReactNode;
}) {
  return (
    <header className="mb-5">
      {breadcrumbs?.length ? (
        <nav aria-label="Trilha" className="mb-1.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 ? <ChevronRight className="size-3" aria-hidden /> : null}
              {b.href ? (
                <Link href={b.href} className="hover:text-slate-800 hover:underline">
                  {b.label}
                </Link>
              ) : (
                <span>{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
            {badges}
          </div>
          {description ? <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
