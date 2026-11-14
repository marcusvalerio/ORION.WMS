import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { listCollectorTasks } from "@/server/services/collector";
import { ClaimButton } from "@/components/collector/claim-button";
import { PRIORITY_LABELS, TASK_TYPE_LABELS } from "@/lib/labels";
import { fmtQty } from "@/lib/format";

export const metadata = { title: "Minhas tarefas" };

export default async function CollectorTasks() {
  const ctx = await requireCtx();
  const tasks = await listCollectorTasks(ctx);
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Minhas tarefas</h1>
      <p className="text-base text-slate-700">Armazenagem, separação e transferência atribuídas a você ou sem responsável.</p>
      {tasks.length === 0 ? (
        <p className="rounded-xl border-2 border-slate-300 bg-white p-4 text-lg">Nenhuma tarefa aberta no momento.</p>
      ) : null}
      {tasks.map((t) => {
        const mine = t.status === "in_progress" && t.assigned_to === ctx.user.id;
        return (
          <article key={t.id} className="space-y-2 rounded-xl border-2 border-slate-300 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-lg font-bold">{TASK_TYPE_LABELS[t.task_type] ?? t.task_type}</span>
              <span className="font-mono text-base text-slate-700">{t.code}</span>
            </div>
            <p className="text-lg">
              <strong className="font-mono">{t.sku}</strong> · {fmtQty(t.quantity ?? 0)} {t.uom}
              <span className="block text-base text-slate-700">{t.description}</span>
            </p>
            <p className="font-mono text-base break-all">
              {t.from_code ?? "—"} → {t.to_code ?? t.suggested_code ?? "—"}
            </p>
            <p className="text-sm font-semibold text-slate-700">
              Prioridade {PRIORITY_LABELS[t.priority]?.label ?? t.priority}
              {t.order_code ? ` · Pedido ${t.order_code}` : ""}
              {t.receipt_code ? ` · Receb. ${t.receipt_code}` : ""}
            </p>
            {mine ? (
              <Link
                href={`/coletor/tarefas/${t.id}`}
                className="flex min-h-14 w-full items-center justify-center rounded-xl bg-emerald-700 px-4 text-xl font-bold text-white"
              >
                Continuar
              </Link>
            ) : (
              <ClaimButton taskId={t.id} label="Pegar tarefa" />
            )}
          </article>
        );
      })}
    </div>
  );
}
