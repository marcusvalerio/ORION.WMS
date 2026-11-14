import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getWave, listWaveCandidates } from "@/server/services/waves";
import { entityHistory } from "@/server/services/audit";
import {
  addOrderToWaveAction,
  cancelWaveAction,
  distributeWaveOrderAction,
  releaseWaveAction,
  removeOrderFromWaveAction,
} from "@/server/actions/fulfillment";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { DemoBadge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { Stepper } from "@/components/ui/stepper";
import { Field, Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { HistoryList } from "@/components/wms/history";
import { Progress } from "@/components/wms/progress";
import { WAVE_GROUPING_LABELS } from "@/lib/labels";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Onda de separação" };

const STEP: Record<string, number> = { draft: 0, released: 1, picking: 2, picked: 3, completed: 5, cancelled: 0 };

export default async function WavePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const w = await getWave(ctx, id);
  if (!w) notFound();
  const role = ctx.user.role;
  const manage = can(role, "wave.manage");
  const [history, candidates] = await Promise.all([
    entityHistory(ctx, "wave", id),
    manage && w.status === "draft" ? listWaveCandidates(ctx, w.warehouse_id) : Promise.resolve([]),
  ]);
  const live = w.tasks.filter((t) => t.status !== "cancelled");
  const done = live.filter((t) => t.status === "completed").length;
  const activeOrders = w.orders.filter((o) => o.active || w.status === "completed");

  return (
    <>
      <PageHeader
        title={`Onda ${w.code}`}
        badges={
          <>
            <StatusBadge kind="wave" status={w.status} />
            {w.is_demo ? <DemoBadge /> : null}
          </>
        }
        description={`${WAVE_GROUPING_LABELS[w.grouping]}${w.grouping_value ? `: ${w.grouping_value}` : ""} · doca ${w.dock_code}`}
        breadcrumbs={[{ label: "Operações" }, { label: "Ondas", href: "/ondas" }, { label: w.code }]}
      />
      <Card className="mb-5">
        <CardBody className="space-y-4">
          <Stepper steps={["Planejada", "Liberada", "Em separação", "Separada", "Distribuída"]} current={STEP[w.status]} cancelled={w.status === "cancelled"} />
          <DefinitionList
            items={[
              ["Depósito", w.warehouse_code],
              ["Doca de consolidação", <span key="d" className="font-mono text-xs">{w.dock_code}</span>],
              ["Criada por", `${w.created_by_name} · ${fmtDateTime(w.created_at)}`],
              ["Liberada em", fmtDateTime(w.released_at)],
              ["Separada em", fmtDateTime(w.picked_at)],
              ["Distribuída em", fmtDateTime(w.completed_at)],
              ["Progresso", <Progress key="p" done={done} total={live.length} />],
              ["Cancelamento", w.cancel_reason],
            ]}
          />
        </CardBody>
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader
              title={`Pedidos (${activeOrders.length})`}
              description="Após a separação de toda a onda, distribua os volumes de cada pedido na doca. A conferência de saída continua sendo feita por pedido."
            />
            <TableWrap>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th>Prioridade</th>
                    <th>Status</th>
                    <th className="num">Solicitado</th>
                    <th className="num">Separado</th>
                    <th>Distribuição</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {w.orders.map((o) => (
                    <tr key={o.order_id} className={o.active || w.status === "completed" ? undefined : "opacity-60"}>
                      <td>
                        <Link href={`/separacao/${o.order_id}`} className="link">
                          {o.code}
                        </Link>
                      </td>
                      <td>{o.customer_name}</td>
                      <td>
                        <PriorityBadge priority={o.priority} />
                      </td>
                      <td>
                        <StatusBadge kind="outbound" status={o.status} />
                      </td>
                      <td className="num">{fmtQty(o.requested)}</td>
                      <td className="num">{fmtQty(o.picked)}</td>
                      <td>{o.distributed_at ? fmtDateTime(o.distributed_at) : o.active ? "Pendente" : "Retirado"}</td>
                      <td className="text-right">
                        {w.status === "picked" && o.active && !o.distributed_at && can(role, "outbound.check") ? (
                          <ActionForm action={distributeWaveOrderAction}>
                            <input type="hidden" name="_id" value={w.id} />
                            <input type="hidden" name="orderId" value={o.order_id} />
                            <SubmitButton size="sm" variant="success">
                              Distribuir
                            </SubmitButton>
                          </ActionForm>
                        ) : null}
                        {w.status === "draft" && o.active && manage ? (
                          <ActionForm action={removeOrderFromWaveAction}>
                            <input type="hidden" name="_id" value={w.id} />
                            <input type="hidden" name="orderId" value={o.order_id} />
                            <SubmitButton size="sm" variant="secondary">
                              Retirar
                            </SubmitButton>
                          </ActionForm>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            {w.status === "draft" && manage && candidates.length ? (
              <CardBody className="border-t border-slate-100">
                <ActionForm action={addOrderToWaveAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="_id" value={w.id} />
                  <Field label="Incluir pedido reservado" className="w-full sm:w-72">
                    <Select name="orderId" required options={candidates.map((c) => ({ value: c.id, label: `${c.code} — ${c.customer_name}` }))} />
                  </Field>
                  <SubmitButton size="sm" variant="secondary">
                    Incluir
                  </SubmitButton>
                </ActionForm>
              </CardBody>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Roteiro de separação" description="Tarefas consolidadas por endereço/produto/lote, na ordem rua → módulo (serpentina) → nível → posição. Cada linha mostra quanto vai para cada pedido." />
            {w.tasks.length ? (
              <TableWrap>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th className="num">Seq.</th>
                      <th>Tarefa</th>
                      <th>Endereço</th>
                      <th>Produto</th>
                      <th className="num">Qtd.</th>
                      <th>Pedidos</th>
                      <th>Status</th>
                      <th>Responsável</th>
                    </tr>
                  </thead>
                  <tbody>
                    {w.tasks.map((t) => (
                      <tr key={t.id}>
                        <td className="num">{t.pick_sequence ?? "—"}</td>
                        <td>
                          <Link href={`/tarefas/${t.id}`} className="link">
                            {t.code}
                          </Link>
                        </td>
                        <td className="font-mono text-[11px] whitespace-nowrap">{t.from_code}</td>
                        <td>
                          {t.sku}
                          {t.lot_code ? <span className="block text-[11px] text-slate-500">Lote {t.lot_code}</span> : null}
                        </td>
                        <td className="num">{fmtQty(t.confirmed_qty ?? t.quantity)}</td>
                        <td className="text-xs">
                          {t.allocations.map((a, i) => (
                            <span key={i} className={a.status === "cancelled" ? "block text-slate-400 line-through" : "block"}>
                              {a.order_code}: {fmtQty(a.picked_qty ?? a.quantity)}
                              {a.picked_qty !== null && a.picked_qty < a.quantity ? ` de ${fmtQty(a.quantity)}` : ""}
                            </span>
                          ))}
                        </td>
                        <td>
                          <StatusBadge kind="task" status={t.status} />
                        </td>
                        <td>{t.assigned_name ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <CardBody>
                <p className="text-sm text-slate-500">As tarefas são geradas ao liberar a onda.</p>
              </CardBody>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {w.status === "draft" && manage ? (
            <Card>
              <CardHeader title="Liberar onda" description="Gera as tarefas consolidadas e coloca os pedidos em separação." />
              <CardBody>
                <ActionForm action={releaseWaveAction}>
                  <input type="hidden" name="_id" value={w.id} />
                  <SubmitButton>Liberar onda</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {["draft", "released"].includes(w.status) && manage ? (
            <Card>
              <CardHeader title="Cancelar onda" description="Permitido antes de qualquer tarefa iniciada. Os pedidos voltam a Reservado, com as reservas mantidas." />
              <CardBody>
                <ActionForm action={cancelWaveAction} confirm="Cancelar esta onda?" className="space-y-3">
                  <input type="hidden" name="_id" value={w.id} />
                  <Field label="Motivo" required>
                    <Input name="reason" required minLength={5} />
                  </Field>
                  <SubmitButton variant="danger" size="sm">
                    Cancelar onda
                  </SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {w.status === "picking" ? <Alert level="info">Separação em andamento. Execute as tarefas na ordem do roteiro.</Alert> : null}
          <Card>
            <CardHeader title="Histórico" />
            <HistoryList rows={history} />
          </Card>
        </div>
      </div>
    </>
  );
}
