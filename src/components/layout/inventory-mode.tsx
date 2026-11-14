import type { ReactNode } from "react";
import { ClipboardCheck } from "lucide-react";
import { cn } from "@/components/ui/cn";

/** Container do "modo inventário": tema escuro de alto contraste e faixa de identificação. */
export function InventoryMode({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-mode="inventory" className={cn("rounded-xl border border-line text-fg", className)}>
      <div
        role="note"
        className="flex items-center gap-2 rounded-t-xl border-b border-line bg-accent px-4 py-2 text-sm font-semibold tracking-wide text-on-action uppercase"
      >
        <ClipboardCheck className="size-4" aria-hidden />
        Modo inventário
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </div>
  );
}
