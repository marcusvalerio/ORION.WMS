import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { RefreshCw, Search } from "lucide-react";
import { collectorTaskCounts, listCollectorTasks } from "@/server/services/collector";
import { ClaimButton } from "@/components/collector/claim-button";
import { PRIORITY_LABELS, TASK_TYPE_LABELS } from "@/lib/labels";
import { fmtQty } from "@/lib/format";

export const metadata = { title: "Minhas tarefas" };

export default async function CollectorTasks() {
  const ctx = await requireCtx();
  const [tasks, counts] = await Promise.all([listCollectorTasks(ctx), collectorTaskCounts(ctx)]);
  const syncedAt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date());
  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl font-semibold">Minhas tarefas</h1>
      <p className="text-base text-fg-2">
        <strong className="tabular-nums text-fg">{counts.mine}</strong> {counts.mine === 1 ? "sua" : "suas"} ·{" "}
        <strong className="tabular-nums text-fg">{counts.team}</strong> da equipe
      </p>
      {tasks.length === 0 ? (
        <div className="space-y-3 rounded-lg border border-line-strong bg-surface p-4">
          <p className="text-lg">Nenhuma tarefa aberta para você agora.</p>
          <p className="text-sm text-fg-2">Atualizado às {syncedAt}.</p>
          <Link href="/coletor/tarefas" className="press flex min-h-14 items-center justify-center gap-2 rounded-full border border-fg px-4 font-display text-lg font-semibold">
            <RefreshCw className="size-5" aria-hidden /> Atualizar
          </Link>
          <Link href="/coletor/consulta" className="press flex min-h-14 items-center justify-center gap-2 rounded-full bg-action px-4 font-display text-lg font-semibold text-on-action">
            <Search className="size-5" aria-hidden /> Consulta rápida
          </Link>
        </div>
      ) : null}
      {tasks.map((t) => {
        const mine = t.status === "in_progress" && t.assigned_to === ctx.user.id;
        return (
          <article key={t.id} className="space-y-2 rounded-lg border border-line-strong bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-lg font-semibold">{TASK_TYPE_LABELS[t.task_type] ?? t.task_type}</span>
              <span className="font-mono text-base text-fg-2">{t.code}</span>
            </div>
            <p className="text-lg">
              <strong className="font-mono">{t.sku}</strong> · {fmtQty(t.quantity ?? 0)} {t.uom}
              <span className="block text-base text-fg-2">{t.description}</span>
            </p>
            <p className="font-mono text-base break-all">
              {t.from_code ?? "—"} → {t.to_code ?? t.suggested_code ?? "—"}
            </p>
            <p className="text-sm font-semibold text-fg-2">
              Prioridade {PRIORITY_LABELS[t.priority]?.label ?? t.priority}
              {t.order_code ? ` · Pedido ${t.order_code}` : ""}
              {t.receipt_code ? ` · Receb. ${t.receipt_code}` : ""}
            </p>
            {mine ? (
              <Link
                href={`/coletor/tarefas/${t.id}`}
                className="press flex min-h-14 w-full items-center justify-center rounded-full bg-ok-solid px-4 font-display text-xl font-semibold text-on-solid"
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
