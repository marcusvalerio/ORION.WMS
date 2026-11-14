import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getTask } from "@/server/services/tasks";
import { TaskRunner } from "@/components/collector/task-runner";
import { ClaimButton } from "@/components/collector/claim-button";
import { TASK_TYPE_LABELS } from "@/lib/labels";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Executar tarefa" };

export default async function CollectorTask({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const task = await getTask(ctx, id);
  if (!task) notFound();
  const supported = task.task_type === "putaway" || task.task_type === "picking" || task.task_type === "transfer";
  const open = task.status === "pending" || task.status === "in_progress";
  const mine = task.status === "in_progress" && task.assigned_to === ctx.user.id;
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">{TASK_TYPE_LABELS[task.task_type] ?? task.task_type}</h1>
        <span className="font-mono text-lg text-fg-2">{task.code}</span>
      </div>
      {!supported ? (
        <p className="rounded-xl bg-warn-solid p-4 text-lg font-semibold">Este tipo de tarefa não é executado pelo coletor.</p>
      ) : !open ? (
        <p className="rounded-xl bg-noite-900 p-4 text-lg font-semibold text-creme-50">
          Tarefa {task.status === "completed" ? "concluída" : "cancelada"}.
        </p>
      ) : !mine ? (
        <ClaimButton taskId={task.id} label="Pegar tarefa e começar" />
      ) : (
        <TaskRunner
          task={{
            id: task.id,
            code: task.code,
            task_type: task.task_type as "putaway" | "picking" | "transfer",
            sku: task.sku,
            description: task.description,
            uom: task.uom,
            lot_code: task.lot_code,
            quantity: task.quantity,
            from_code: task.from_code,
            target_code: task.to_code ?? task.suggested_code,
            order_code: task.order_code,
          }}
        />
      )}
      <Link href="/coletor/tarefas" className="block py-3 text-center text-lg font-semibold underline">
        Voltar às tarefas
      </Link>
    </div>
  );
}
