import Link from "next/link";
import type { DivergenceRow } from "@/server/services/divergences";
import { resolveDivergenceAction } from "@/server/actions/receiving";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/fields";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { DIVERGENCE_SOURCE_LABELS, DIVERGENCE_TYPE_LABELS } from "@/lib/labels";
import { fmtDateTime, fmtQty } from "@/lib/format";

export function DivergenceList({ rows, canResolve, showDocument = false }: { rows: DivergenceRow[]; canResolve: boolean; showDocument?: boolean }) {
  if (!rows.length) return <EmptyState title="Nenhuma divergência" />;
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((d) => {
        const docHref = d.receipt_id ? `/recebimentos/${d.receipt_id}` : d.order_id ? `/separacao/${d.order_id}` : d.inventory_id ? `/inventario/${d.inventory_id}` : null;
        const docCode = d.receipt_code ?? d.order_code ?? d.inventory_code;
        return (
          <li key={d.id} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={d.divergence_type === "damage" || d.divergence_type === "shortage" || d.divergence_type === "short_pick" ? "danger" : "warning"}>
                    {DIVERGENCE_TYPE_LABELS[d.divergence_type]}
                  </Badge>
                  <StatusBadge kind="divergence" status={d.status} />
                  {showDocument ? (
                    <span className="text-xs text-slate-500">
                      {DIVERGENCE_SOURCE_LABELS[d.source]}
                      {docHref && docCode ? (
                        <>
                          {" · "}
                          <Link href={docHref} className="link">
                            {docCode}
                          </Link>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                  {d.sku ? <span className="text-xs font-medium text-slate-700">{d.sku}</span> : null}
                  {d.quantity !== null ? <span className="text-xs text-slate-500">{fmtQty(d.quantity)} un</span> : null}
                </div>
                <p className="mt-1 text-sm text-slate-700">{d.description}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Registrada por {d.created_by_name} em {fmtDateTime(d.created_at)}
                  {d.task_code ? ` · tarefa ${d.task_code}` : ""}
                </p>
                {d.status === "resolved" ? (
                  <p className="mt-1 rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                    Tratamento: {d.resolution} — {d.resolved_by_name}, {fmtDateTime(d.resolved_at)}
                  </p>
                ) : null}
              </div>
            </div>
            {d.status === "open" && canResolve && d.source !== "inventory" ? (
              <ActionForm action={resolveDivergenceAction} className="mt-2 flex flex-wrap items-start gap-2">
                <input type="hidden" name="_id" value={d.id} />
                <Input name="resolution" required minLength={10} placeholder="Descreva o tratamento (ex.: nota de débito emitida ao fornecedor)" className="min-w-0 flex-1 sm:min-w-[320px]" aria-label="Tratamento" />
                <SubmitButton size="sm" variant="secondary">
                  Registrar tratamento
                </SubmitButton>
              </ActionForm>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
