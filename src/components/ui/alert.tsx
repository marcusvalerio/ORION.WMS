import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "./cn";

type Level = "info" | "success" | "warning" | "danger";
const styles: Record<Level, string> = {
  info: "border-info-line bg-info-bg text-info-fg",
  success: "border-ok-line bg-ok-bg text-ok-fg",
  warning: "border-warn-line bg-warn-bg text-warn-fg",
  danger: "border-crit-line bg-crit-bg text-crit-fg",
};
const icons = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert };

export function Alert({ level = "info", title, children, className }: { level?: Level; title?: ReactNode; children?: ReactNode; className?: string }) {
  const Icon = icons[level];
  return (
    <div role={level === "danger" ? "alert" : "status"} className={cn("flex gap-2.5 rounded-md border px-3 py-2.5 text-sm", styles[level], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className={cn(title ? "mt-0.5" : "", "opacity-90")}>{children}</div> : null}
      </div>
    </div>
  );
}
