import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "./cn";

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("overflow-x-auto", className)}>{children}</div>;
}

/** Cabeçalho ordenável via query string (?sort=campo | -campo). */
export function SortTh({
  label,
  field,
  current,
  params,
  className,
  descFirst,
}: {
  label: string;
  field: string;
  current?: string | null;
  params: Record<string, string | undefined>;
  className?: string;
  descFirst?: boolean;
}) {
  const active = current === field || current === `-${field}`;
  const desc = current === `-${field}`;
  const next = active ? (desc ? field : `-${field}`) : descFirst ? `-${field}` : field;
  const qs = new URLSearchParams(Object.entries({ ...params, sort: next, page: undefined }).filter(([, v]) => v) as [string, string][]);
  const Icon = active ? (desc ? ArrowDown : ArrowUp) : ArrowUpDown;
  return (
    <th className={className} aria-sort={active ? (desc ? "descending" : "ascending") : "none"}>
      <Link href={`?${qs}`} className="inline-flex items-center gap-1 hover:text-slate-800">
        {label}
        <Icon className={cn("size-3", active ? "text-brand-600" : "text-slate-300")} aria-hidden />
      </Link>
    </th>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const qs = new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `?${qs}`;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
      <span>
        {from}–{to} de {total}
      </span>
      {pages > 1 ? (
        <div className="flex items-center gap-1">
          {page > 1 ? (
            <Link href={href(page - 1)} className="rounded border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50">
              Anterior
            </Link>
          ) : null}
          <span className="px-2">
            Página {page} de {pages}
          </span>
          {page < pages ? (
            <Link href={href(page + 1)} className="rounded border border-slate-200 bg-white px-2 py-1 hover:bg-slate-50">
              Próxima
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
