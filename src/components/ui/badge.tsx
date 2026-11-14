import type { ReactNode } from "react";
import { STATUS, PRIORITY_LABELS, type Tone } from "@/lib/labels";
import { cn } from "./cn";

const tones: Record<Tone, string> = {
  neutral: "bg-neutral-bg text-neutral-fg ring-neutral-line",
  info: "bg-info-bg text-info-fg ring-info-line",
  progress: "bg-prog-bg text-prog-fg ring-prog-line",
  warning: "bg-warn-bg text-warn-fg ring-warn-line",
  success: "bg-ok-bg text-ok-fg ring-ok-line",
  danger: "bg-crit-bg text-crit-fg ring-crit-line",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ kind, status }: { kind: keyof typeof STATUS; status: string }) {
  const s = STATUS[kind][status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function PriorityBadge({ priority }: { priority: number }) {
  const p = PRIORITY_LABELS[priority] ?? PRIORITY_LABELS[2];
  return <Badge tone={p.tone}>{p.label}</Badge>;
}

export function DemoBadge({ className }: { className?: string }) {
  return (
    <Badge tone="warning" className={className}>
      Demonstração
    </Badge>
  );
}
