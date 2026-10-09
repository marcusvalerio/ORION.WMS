import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getTask, listAssignableUsers, suggestForTask } from "@/server/services/tasks";
import { listLocations } from "@/server/services/warehouse";
import { assignTaskAction, cancelTaskAction, completeTaskAction, startTaskAction } from "@/server/actions/tasks";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/fields";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { taskDocument } from "@/components/wms/task-table";
import { STATUS, TASK_TYPE_LABELS } from "@/lib/labels";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Tarefa" };

const EVENT_LABELS: Record<string, string> = { created: "Criada", started: "Iniciada", completed: "Concluída", cancelled: "Cancelada", assigned: "Atribuição/prioridade alterada" };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const task = await getTask(ctx, id);
  if (!task) notFound();
  const open = task.status === "pending" || task.status === "in_progress";
  const role = ctx.user.role;
  const canExecute = can(role, "task.execute") && (!task.assigned_to || task.assigned_to === ctx.user.id || role !== "operator");
  const [suggestion, destinations, users] = await Promise.all([
    open && task.task_type === "putaway" ? suggestForTask(ctx, task) : Promise.resolve(null),
    open && (task.task_type === "putaway" || task.task_type === "transfer")
      ? listLocations(ctx, { warehouseId: task.warehouse_id, status: "active", pageSize: 1000 })
      : Promise.resolve(null),
    can(role, "task.manage") && open ? listAssignableUsers(ctx) : Promise.resolve([]),
  ]);
  const doc = taskDocument(task);
  const eligibleIds = new Set(suggestion?.candidates.map((c) => c.location.id) ?? []);

  return (
    <>
      <PageHeader
        title={`${TASK_TYPE_LABELS[task.task_type]} ${task.code}`}
        badges={
          <>
            <StatusBadge kind="task" status={task.status} />
            <PriorityBadge priority={task.priority} />
          </>
        }
        breadcrumbs={[{ label: "Operações" }, { label: "Tarefas", href: "/tarefas" }, { label: task.code }]}
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardBody>
              <DefinitionList
                items={[
                  ["Produto", task.sku ? `${task.sku} — ${task.description}` : "—"],
                  ["Quantidade", task.quantity !== null ? `${fmtQty(task.quantity)} ${task.uom ?? ""}` : "—"],
                  ["Lote / validade", `${task.lot_code || "—"} / ${fmtDate(task.expiry_date)}`],
                  ["Origem", task.from_code ? <span className="font-mono text-xs">{task.from_code}</span> : "—"],
                  ["Destino", task.to_code ?? task.suggested_code ? <span className="font-mono text-xs">{task.to_code ?? task.suggested_code}</span> : "—"],
                  ["Documento", doc ? <Link href={doc.href} className="link">{doc.label}</Link> : "—"],
                  ["Depósito", task.warehouse_code],
                  ["Responsável", task.assigned_name],
                  ["Confirmado", task.confirmed_qty !== null ? `${fmtQty(task.confirmed_qty)} por ${task.completed_by_name}` : "—"],
                ]}
              />
              {task.notes ? <p className="mt-4 rounded bg-slate-50 px-3 py-2 text-sm text-slate-600">{task.notes}</p> : null}
            </CardBody>
          </Card>

          {!open ? (
            <Alert level={task.status === "completed" ? "success" : "warning"} title={task.status === "completed" ? "Tarefa concluída" : "Tarefa cancelada"}>
              {task.status === "completed"
                ? `Concluída em ${fmtDateTime(task.completed_at)} por ${task.completed_by_name}. Ela não pode ser executada novamente.`
                : `Motivo: ${task.cancel_reason}`}
            </Alert>
          ) : null}

          {open && task.task_type === "inventory" ? (
            <Alert level="info" title="Tarefa de contagem">
              Registre as quantidades contadas na tela do inventário. A tarefa é concluída ao submeter a contagem.{" "}
              {task.inventory_id ? (
                <Link className="link" href={`/inventario/${task.inventory_id}`}>
                  Abrir {task.inventory_code}
                </Link>
              ) : null}
            </Alert>
          ) : null}

          {open && canExecute && task.task_type !== "inventory" ? (
            <Card>
              <CardHeader
                title="Execução"
                description={
                  task.task_type === "putaway"
                    ? "Leve o produto ao endereço e confirme o endereço efetivamente utilizado. Capacidade e compatibilidade são validadas na confirmação."
                    : task.task_type === "picking"
                      ? "Retire o produto do endereço de origem e confirme a quantidade separada. Quantidade menor gera divergência de separação."
                      : "Confirme a movimentação física entre os endereços."
                }
              />
              <CardBody className="space-y-4">
                {task.status === "pending" ? (
                  <ActionForm action={startTaskAction}>
                    <input type="hidden" name="_id" value={task.id} />
                    <SubmitButton variant="secondary">Iniciar tarefa</SubmitButton>
                  </ActionForm>
                ) : null}

                {task.task_type === "putaway" && suggestion ? (
                  suggestion.best ? (
                    <Alert level="info" title={`Endereço sugerido: ${suggestion.best.code}`}>
                      Regras: zona preferencial do produto, consolidação com o mesmo produto/lote e melhor encaixe de capacidade, respeitando classe de armazenagem,
                      capacidade e peso.
                    </Alert>
                  ) : (
                    <Alert level="danger" title="Nenhum endereço elegível">
                      {suggestion.reason} Ajuste a estrutura (capacidade/classe) ou libere espaço antes de confirmar.
                    </Alert>
                  )
                ) : null}

                <ActionForm action={completeTaskAction} confirm="Confirmar a execução física desta tarefa?" className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="_id" value={task.id} />
                  {task.task_type === "putaway" || task.task_type === "transfer" ? (
                    <Field label="Endereço de destino confirmado" required className="sm:col-span-2">
                      <Select
                        name="locationId"
                        required
                        defaultValue={task.to_location_id ?? suggestion?.best?.id ?? ""}
                        placeholder="Selecione o endereço utilizado…"
                        options={(destinations?.rows ?? [])
                          .filter((l) => ["storage", "picking"].includes(l.zone_type) && l.id !== task.from_location_id)
                          .map((l) => ({
                            value: l.id,
                            label: `${l.code} · livre ${fmtQty(l.capacity_units - l.occupied)}${task.task_type === "putaway" && !eligibleIds.has(l.id) ? " (inelegível)" : ""}`,
                          }))}
                      />
                    </Field>
                  ) : null}
                  {task.task_type === "picking" ? (
                    <>
                      <Field label="Endereço de origem (confirmação)" hint="Confirme o endereço de onde o produto foi retirado.">
                        <Select name="locationId" defaultValue={task.from_location_id ?? ""} options={task.from_location_id ? [{ value: task.from_location_id, label: task.from_code ?? "" }] : []} />
                      </Field>
                      <Field label={`Quantidade separada (reservado ${fmtQty(task.quantity)})`} required>
                        <Input name="quantity" type="number" min={0} max={task.quantity ?? undefined} step="any" defaultValue={task.quantity ?? ""} required />
                      </Field>
                      <Field label="Observação (obrigatória em caso de falta)" className="sm:col-span-2">
                        <Input name="notes" maxLength={500} />
                      </Field>
                    </>
                  ) : null}
                  <div className="sm:col-span-2">
                    <SubmitButton variant="success">Confirmar e concluir</SubmitButton>
                  </div>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {open && !canExecute && task.task_type !== "inventory" ? (
            <Alert level="warning">{can(role, "task.execute") ? "Esta tarefa está atribuída a outro operador." : "Seu perfil permite apenas consulta."}</Alert>
          ) : null}
        </div>

        <div className="space-y-5">
          {can(role, "task.manage") && open ? (
            <Card>
              <CardHeader title="Gestão" />
              <CardBody className="space-y-4">
                <ActionForm action={assignTaskAction} className="space-y-3">
                  <input type="hidden" name="_id" value={task.id} />
                  <Field label="Responsável">
                    <Select name="userId" defaultValue={task.assigned_to ?? ""} placeholder="Sem responsável" options={users.map((u) => ({ value: u.id, label: u.name }))} />
                  </Field>
                  <Field label="Prioridade">
                    <Select
                      name="priority"
                      defaultValue={String(task.priority)}
                      options={[
                        { value: "1", label: "Alta" },
                        { value: "2", label: "Normal" },
                        { value: "3", label: "Baixa" },
                      ]}
                    />
                  </Field>
                  <SubmitButton variant="secondary" size="sm">
                    Salvar
                  </SubmitButton>
                </ActionForm>
                {task.task_type === "transfer" ? (
                  <ActionForm action={cancelTaskAction} confirm="Cancelar esta tarefa?" className="space-y-3 border-t border-slate-100 pt-4">
                    <input type="hidden" name="_id" value={task.id} />
                    <Field label="Motivo do cancelamento" required>
                      <Input name="reason" required minLength={5} />
                    </Field>
                    <SubmitButton variant="danger" size="sm">
                      Cancelar tarefa
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Eventos da tarefa" />
            <ol className="space-y-3 px-4 py-4">
              {task.events.map((e) => (
                <li key={e.id} className="relative pl-5 text-sm">
                  <span className="absolute top-1.5 left-0 size-2 rounded-full bg-brand-500" aria-hidden />
                  <p className="font-medium text-slate-800">
                    {EVENT_LABELS[e.event_type] ?? e.event_type}
                    {e.to_status && e.from_status !== e.to_status ? <span className="font-normal text-slate-500"> → {STATUS.task[e.to_status]?.label}</span> : null}
                  </p>
                  <p className="text-xs text-slate-500">
                    {e.user_name} · {fmtDateTime(e.created_at)}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
          {doc ? (
            <ButtonLink href={doc.href} size="sm" className="w-full">
              Abrir documento {doc.label}
            </ButtonLink>
          ) : null}
        </div>
      </div>
    </>
  );
}
