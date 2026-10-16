import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/** Painel expansível nativo (details/summary) para formulários secundários. */
export function Disclosure({ title, children, defaultOpen, icon }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; icon?: ReactNode }) {
  return (
    <details className="group rounded-lg border border-slate-200 bg-white shadow-xs" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-slate-800 select-none hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-slate-400 transition-transform group-open:rotate-90" aria-hidden />
        {icon}
        {title}
      </summary>
      <div className="border-t border-slate-100 p-4">{children}</div>
    </details>
  );
}
