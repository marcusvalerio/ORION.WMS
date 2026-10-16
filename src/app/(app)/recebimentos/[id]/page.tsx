import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getReceipt, type ReceiptItemRow, type ReceiptStatus } from "@/server/services/receiving";
import { listTasks } from "@/server/services/tasks";
import { listDivergences } from "@/server/services/divergences";
import { entityHistory } from "@/server/services/audit";
import {
  addReceiptDivergenceAction,
  cancelReceiptAction,
  releaseQualityHoldAction,
  releaseReceiptAction,
  saveCountsAction,
  startCheckAction,
} from "@/server/actions/receiving";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { DemoBadge, StatusBadge, PriorityBadge } from "@/components/ui/badge";
import { Stepper } from "@/components/ui/stepper";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, Input, Select, Textarea } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { HistoryList } from "@/components/wms/history";
import { DivergenceList } from "@/components/wms/divergence-list";
import { DIVERGENCE_TYPE_LABELS } from "@/lib/labels";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Recebimento" };

const STEP: Record<ReceiptStatus, number> = { expected: 0, checking: 1, checked: 2, released: 3, completed: 5, cancelled: 0 };

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const r = await getReceipt(ctx, id);
  if (!r) notFound();
  const [tasks, divergences, history] = await Promise.all([
    listTasks(ctx, { q: r.code, type: "putaway", pageSize: 100 }),
    listDivergences(ctx, { receiptId: id }),
    entityHistory(ctx, "receipt", id),
  ]);
  const role = ctx.user.role;
  const putawayTasks = tasks.rows.filter((t) => t.receipt_id === id);
  const totals = r.items.reduce(
    (a, i) => ({
      expected: a.expected + i.expected_qty,
      counted: a.counted + (i.counted_qty ?? 0),
      released: a.released + i.released_qty,
      putaway: a.putaway + i.putaway_qty,
    }),
    { expected: 0, counted: 0, released: 0, putaway: 0 },
  );

  return (
    <>
      <PageHeader
        title={`Recebimento ${r.code}`}
        badges={
          <>
            <StatusBadge kind="receipt" status={r.status} />
            {r.is_demo ? <DemoBadge /> : null}
          </>
        }
        description={`${r.supplier_name}${r.po_number ? ` · Pedido ${r.po_number}` : " · Entrada sem pedido"}`}
        breadcrumbs={[{ label: "Entrada" }, { label: "Recebimentos", href: "/recebimentos" }, { label: r.code }]}
      />
      <Card className="mb-5">
        <CardBody className="space-y-4">
          <Stepper steps={["Previsto", "Conferência", "Conferido", "Armazenagem", "Concluído"]} current={STEP[r.status]} cancelled={r.status === "cancelled"} />
          <DefinitionList
            items={[
              ["Depósito de destino", `${r.warehouse_code} — ${r.warehouse_name}`],
              ["Nota fiscal", r.invoice_number],
              ["Chave NF-e", r.invoice_key ? <span className="font-mono text-xs">{r.invoice_key}</span> : "Não informada"],
              ["Chegada física", fmtDateTime(r.arrived_at)],
              ["Responsável pela conferência", r.checker_name],
              ["Conferência finalizada", fmtDateTime(r.checked_at)],
              ["Liberado", fmtDateTime(r.released_at)],
              ["Concluído", fmtDateTime(r.completed_at)],
              ["Criado por", `${r.created_by_name} · ${fmtDateTime(r.created_at)}`],
            ]}
          />
          {r.notes ? <p className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-600">Observações: {r.notes}</p> : null}
        </CardBody>
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {r.status === "expected" ? (
            <Card>
              <CardHeader title="Itens previstos" description="Registre a chegada física para iniciar a conferência." />
              <ItemsTable items={r.items} />
              {can(role, "receipt.check") ? (
                <CardBody className="flex flex-wrap gap-3 border-t border-slate-100">
                  <ActionForm action={startCheckAction}>
                    <input type="hidden" name="_id" value={id} />
                    <SubmitButton>Registrar chegada e iniciar conferência</SubmitButton>
                  </ActionForm>
                </CardBody>
              ) : null}
            </Card>
          ) : null}

          {r.status === "checking" ? (
            <Card>
              <CardHeader
                title="Conferência física"
                description="Informe a quantidade contada (inclui avariadas e retidas), lote e validade quando exigidos. Divergências são calculadas automaticamente ao finalizar."
              />
              {can(role, "receipt.check") ? (
                <ActionForm action={saveCountsAction}>
                  <input type="hidden" name="_id" value={id} />
                  <TableWrap>
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th className="num">Previsto</th>
                          <th className="w-28">Conferido</th>
                          <th className="w-24">Avariado</th>
                          <th className="w-24">Retido CQ</th>
                          <th className="w-32">Lote</th>
                          <th className="w-40">Validade</th>
                          <th className="min-w-[160px]">Observação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.items.map((i, idx) => (
                          <tr key={i.id}>
                            <td>
                              <input type="hidden" name={`items.${idx}.itemId`} value={i.id} />
                              <span className="font-medium">{i.sku}</span>
                              <span className="block text-xs text-slate-500">{i.description}</span>
                            </td>
                            <td className="num">
                              {fmtQty(i.expected_qty)} {i.uom}
                            </td>
                            <td>
                              <Input name={`items.${idx}.countedQty`} type="number" min={0} step="any" defaultValue={i.counted_qty ?? ""} aria-label={`Conferido ${i.sku}`} />
                            </td>
                            <td>
                              <Input name={`items.${idx}.damagedQty`} type="number" min={0} step="any" defaultValue={i.damaged_qty || ""} aria-label={`Avariado ${i.sku}`} />
                            </td>
                            <td>
                              <Input name={`items.${idx}.qualityHoldQty`} type="number" min={0} step="any" defaultValue={i.quality_hold_qty || ""} aria-label={`Retido ${i.sku}`} />
                            </td>
                            <td>
                              <Input
                                name={`items.${idx}.lotCode`}
                                defaultValue={i.lot_code}
                                placeholder={i.lot_controlled ? "Obrigatório" : "—"}
                                className={i.lot_controlled ? "border-amber-300" : undefined}
                                aria-label={`Lote ${i.sku}`}
                              />
                            </td>
                            <td>
                              <Input
                                name={`items.${idx}.expiryDate`}
                                type="date"
                                defaultValue={i.expiry_date ?? ""}
                                className={i.expiry_controlled ? "border-amber-300" : undefined}
                                aria-label={`Validade ${i.sku}`}
                              />
                            </td>
                            <td>
                              <Input name={`items.${idx}.notes`} defaultValue={i.notes ?? ""} aria-label={`Observação ${i.sku}`} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                  <CardBody className="space-y-3 border-t border-slate-100">
                    <Field label="Observações da conferência">
                      <Textarea name="checkNotes" maxLength={2000} placeholder="Condições do veículo, embalagens, temperatura…" />
                    </Field>
                    <p className="text-xs text-slate-500">Campos com borda amarela são obrigatórios para este produto (lote/validade).</p>
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton variant="secondary">Salvar contagem</SubmitButton>
                      <SubmitButton name="finish" value="1">
                        Salvar e finalizar conferência
                      </SubmitButton>
                    </div>
                  </CardBody>
                </ActionForm>
              ) : (
                <ItemsTable items={r.items} />
              )}
            </Card>
          ) : null}

          {["checked", "released", "completed"].includes(r.status) ? (
            <Card>
              <CardHeader
                title="Resultado da conferência"
                description={`Previsto ${fmtQty(totals.expected)} · Conferido ${fmtQty(totals.counted)} · Liberado ${fmtQty(totals.released)} · Armazenado ${fmtQty(totals.putaway)}`}
              />
              <ItemsTable items={r.items} showResult />
              {r.status === "checked" ? (
                <CardBody className="space-y-3 border-t border-slate-100">
                  <Alert level="info">
                    Serão liberados para armazenagem apenas os volumes elegíveis (conferido − avariado − retido). Quantidades retidas pelo controle de qualidade
                    permanecem bloqueadas até liberação explícita do supervisor.
                  </Alert>
                  {can(role, "receipt.release") ? (
                    <ActionForm action={releaseReceiptAction} confirm="Liberar os itens elegíveis e gerar as tarefas de armazenagem?">
                      <input type="hidden" name="_id" value={id} />
                      <SubmitButton>Liberar itens e gerar tarefas de armazenagem</SubmitButton>
                    </ActionForm>
                  ) : (
                    <p className="text-sm text-slate-500">Aguardando liberação por um supervisor.</p>
                  )}
                </CardBody>
              ) : null}
            </Card>
          ) : null}

          {putawayTasks.length ? (
            <Card>
              <CardHeader title="Tarefas de armazenagem" description="O estoque é criado no endereço somente quando a tarefa é confirmada." />
              <TableWrap>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Tarefa</th>
                      <th>Status</th>
                      <th>Produto</th>
                      <th className="num">Qtd.</th>
                      <th>Sugestão / destino</th>
                      <th>Prioridade</th>
                      <th>Responsável</th>
                    </tr>
                  </thead>
                  <tbody>
                    {putawayTasks.map((t) => (
                      <tr key={t.id}>
                        <td className="whitespace-nowrap">
                          <Link href={`/tarefas/${t.id}`} className="link">
                            {t.code}
                          </Link>
                        </td>
                        <td>
                          <StatusBadge kind="task" status={t.status} />
                        </td>
                        <td className="whitespace-nowrap">
                          {t.sku}
                          {t.lot_code ? <span className="block text-xs text-slate-500">Lote {t.lot_code}</span> : null}
                        </td>
                        <td className="num">{fmtQty(t.quantity)}</td>
                        <td className="font-mono text-[11px] whitespace-nowrap">{t.to_code ?? t.suggested_code ?? <span className="font-sans text-xs text-red-600">Sem endereço elegível</span>}</td>
                        <td>
                          <PriorityBadge priority={t.priority} />
                        </td>
                        <td>{t.completed_by_name ?? t.assigned_name ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          ) : null}

          {["released", "completed"].includes(r.status) && r.items.some((i) => i.quality_hold_qty > 0) && can(role, "quality.release") ? (
            <Card>
              <CardHeader title="Liberação de retenção de qualidade" description="Libera quantidade retida para armazenagem mediante justificativa (ex.: laudo aprovado)." />
              <CardBody className="space-y-4">
                {r.items
                  .filter((i) => i.quality_hold_qty > 0)
                  .map((i) => (
                    <ActionForm key={i.id} action={releaseQualityHoldAction} resetOnSuccess className="grid gap-3 sm:grid-cols-[1fr_120px_2fr_auto] sm:items-end">
                      <input type="hidden" name="_id" value={i.id} />
                      <div className="text-sm">
                        <span className="font-medium">{i.sku}</span>
                        <span className="block text-xs text-slate-500">Retido: {fmtQty(i.quality_hold_qty)}</span>
                      </div>
                      <Field label="Quantidade">
                        <Input name="quantity" type="number" min={0} max={i.quality_hold_qty} step="any" required />
                      </Field>
                      <Field label="Justificativa">
                        <Input name="justification" required minLength={10} />
                      </Field>
                      <SubmitButton variant="secondary">Liberar</SubmitButton>
                    </ActionForm>
                  ))}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title={`Divergências (${divergences.length})`} description="Faltas, sobras, avarias e retenções nunca são ocultadas: permanecem registradas mesmo após tratamento." />
            <DivergenceList rows={divergences} canResolve={can(role, "divergence.resolve")} />
            {["expected", "checking", "checked", "released"].includes(r.status) && can(role, "divergence.create") ? (
              <CardBody className="border-t border-slate-100">
                <Disclosure title="Registrar divergência ou ocorrência manual">
                  <ActionForm action={addReceiptDivergenceAction} resetOnSuccess className="grid gap-3 sm:grid-cols-3">
                    <input type="hidden" name="_id" value={id} />
                    <Field label="Tipo">
                      <Select
                        name="divergenceType"
                        defaultValue="other"
                        options={["other", "damage", "shortage", "overage", "quality_hold"].map((t) => ({ value: t, label: DIVERGENCE_TYPE_LABELS[t] }))}
                      />
                    </Field>
                    <Field label="Item (opcional)">
                      <Select name="itemId" placeholder="Recebimento todo" options={r.items.map((i) => ({ value: i.id, label: i.sku }))} />
                    </Field>
                    <Field label="Quantidade (opcional)">
                      <Input name="quantity" type="number" min={0} step="any" />
                    </Field>
                    <Field label="Descrição" required className="sm:col-span-3">
                      <Textarea name="description" required minLength={5} />
                    </Field>
                    <div className="sm:col-span-3">
                      <SubmitButton variant="secondary">Registrar</SubmitButton>
                    </div>
                  </ActionForm>
                </Disclosure>
              </CardBody>
            ) : null}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Histórico" description="Alterações e confirmações registradas." />
            <HistoryList rows={history} />
          </Card>
          {["expected", "checking"].includes(r.status) && can(role, "receipt.release") ? (
            <Card>
              <CardHeader title="Cancelar recebimento" description="Permitido antes da conclusão da conferência." />
              <CardBody>
                <ActionForm action={cancelReceiptAction} confirm="Cancelar este recebimento?" className="space-y-3">
                  <input type="hidden" name="_id" value={id} />
                  <Field label="Motivo" required>
                    <Input name="reason" required minLength={5} />
                  </Field>
                  <SubmitButton variant="danger" size="sm">
                    Cancelar recebimento
                  </SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function ItemsTable({ items, showResult }: { items: ReceiptItemRow[]; showResult?: boolean }) {
  return (
    <TableWrap>
      <table className="table-base">
        <thead>
          <tr>
            <th>#</th>
            <th>Produto</th>
            <th className="num">Previsto</th>
            {showResult ? (
              <>
                <th className="num">Conferido</th>
                <th className="num">Avariado</th>
                <th className="num">Retido</th>
                <th>Lote / validade</th>
                <th className="num">Liberado</th>
                <th className="num">Armazenado</th>
              </>
            ) : (
              <th>Controles</th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const diff = (i.counted_qty ?? 0) - i.expected_qty;
            return (
              <tr key={i.id}>
                <td className="text-slate-400">{i.line_no}</td>
                <td>
                  <span className="font-medium">{i.sku}</span>
                  <span className="block text-xs text-slate-500">{i.description}</span>
                </td>
                <td className="num">
                  {fmtQty(i.expected_qty)} {i.uom}
                </td>
                {showResult ? (
                  <>
                    <td className="num">
                      {fmtQty(i.counted_qty)}
                      {diff !== 0 ? <span className={diff < 0 ? "ml-1 text-xs text-red-600" : "ml-1 text-xs text-amber-600"}>({diff > 0 ? "+" : ""}{fmtQty(diff)})</span> : null}
                    </td>
                    <td className="num">{i.damaged_qty ? fmtQty(i.damaged_qty) : "—"}</td>
                    <td className="num">{i.quality_hold_qty ? fmtQty(i.quality_hold_qty) : "—"}</td>
                    <td className="text-xs">
                      {i.lot_code || "—"} / {fmtDate(i.expiry_date)}
                    </td>
                    <td className="num">{fmtQty(i.released_qty)}</td>
                    <td className="num font-medium">{fmtQty(i.putaway_qty)}</td>
                  </>
                ) : (
                  <td className="text-xs text-slate-500">{[i.lot_controlled && "Lote", i.expiry_controlled && "Validade"].filter(Boolean).join(", ") || "—"}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}
