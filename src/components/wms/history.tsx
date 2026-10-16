import type { AuditRow } from "@/server/services/audit";
import { AUDIT_ACTION_LABELS } from "@/lib/labels";
import { fmtDateTime } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";

function summary(details: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const key of ["reason", "justification", "resolution", "notes", "shipment", "staging"]) {
    if (typeof details[key] === "string" && details[key]) parts.push(String(details[key]));
  }
  if (Array.isArray(details.tasks) && details.tasks.length) parts.push(`Tarefas: ${details.tasks.join(", ")}`);
  if (typeof details.divergences === "number" && details.divergences) parts.push(`${details.divergences} divergência(s)`);
  if (Array.isArray(details.mismatches)) parts.push(details.mismatches.join("; "));
  return parts.length ? parts.join(" · ") : null;
}

/** Linha do tempo de auditoria de um registro (quem fez o quê e quando). */
export function HistoryList({ rows }: { rows: AuditRow[] }) {
  if (!rows.length) return <EmptyState title="Sem histórico" />;
  return (
    <ol className="relative space-y-4 px-4 py-4">
      {rows.map((h) => {
        const extra = summary(h.details);
        return (
          <li key={h.id} className="relative pl-5">
            <span className="absolute top-1.5 left-0 size-2 rounded-full bg-brand-500" aria-hidden />
            <p className="text-sm font-medium text-slate-800">{AUDIT_ACTION_LABELS[h.action] ?? h.action}</p>
            <p className="text-xs text-slate-500">
              {h.user_name ?? "Sistema"} · {fmtDateTime(h.created_at)}
            </p>
            {extra ? <p className="mt-0.5 text-xs text-slate-600">{extra}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
