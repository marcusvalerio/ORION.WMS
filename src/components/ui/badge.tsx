import type { ReactNode } from "react";
import { STATUS, PRIORITY_LABELS, type Tone } from "@/lib/labels";
import { cn } from "./cn";

const tones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
  progress: "bg-brand-50 text-brand-700 ring-brand-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
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
