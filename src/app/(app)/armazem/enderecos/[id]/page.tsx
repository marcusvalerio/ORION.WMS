import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getLocation, LOCATION_TYPES, STORAGE_CLASSES } from "@/server/services/warehouse";
import { listMovements, listStock } from "@/server/services/stock";
import { entityHistory } from "@/server/services/audit";
import { deleteLocationAction, setLocationStatusAction, updateLocationAction } from "@/server/actions/warehouse";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { OccupancyBar } from "@/components/ui/occupancy";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { AUDIT_ACTION_LABELS, LOCATION_TYPE_LABELS, MOVEMENT_LABELS, STATUS, STORAGE_CLASS_LABELS, ZONE_TYPE_LABELS } from "@/lib/labels";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Endereço" };

export default async function LocationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const loc = await getLocation(ctx, id);
  if (!loc) notFound();
  const [stock, movements, history] = await Promise.all([
    listStock(ctx, { locationId: id, pageSize: 0 }),
    listMovements(ctx, { locationId: id, pageSize: 20 }),
    entityHistory(ctx, "location", id),
  ]);
  const manage = can(ctx.user.role, "warehouse.manage");

  return (
    <>
      <PageHeader
        title={<span className="font-mono text-lg">{loc.code}</span>}
        badges={<StatusBadge kind="location" status={loc.status} />}
        description={`${loc.zone_code} — ${loc.zone_name} (${ZONE_TYPE_LABELS[loc.zone_type]})`}
        breadcrumbs={[{ label: "Armazém" }, { label: "Endereços", href: "/armazem/enderecos" }, { label: loc.code }]}
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Dados do endereço" />
            <CardBody>
              <DefinitionList
                items={[
                  ["Depósito", loc.warehouse_code],
                  ["Rua / Módulo / Nível / Posição", `${loc.aisle} / ${loc.bay} / ${loc.level} / ${loc.position}`],
                  ["Tipo", LOCATION_TYPE_LABELS[loc.location_type]],
                  ["Classe de armazenagem", loc.storage_class ? STORAGE_CLASS_LABELS[loc.storage_class] : "Geral"],
                  ["Capacidade", `${fmtQty(loc.capacity_units)} un`],
                  ["Peso máximo", loc.max_weight_kg ? `${fmtQty(loc.max_weight_kg)} kg` : "—"],
                  ["Reservado", `${fmtQty(loc.reserved)} un`],
                  ["Bloqueado", `${fmtQty(loc.blocked)} un`],
                  ["Observações", loc.notes],
                ]}
              />
              <OccupancyBar used={loc.occupied} capacity={loc.capacity_units} className="mt-4 max-w-sm" />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Produtos armazenados" description="Saldo físico, reservado, bloqueado e disponível neste endereço." />
            {stock.rows.length ? (
              <TableWrap>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Lote</th>
                      <th>Validade</th>
                      <th className="num">Físico</th>
                      <th className="num">Reservado</th>
                      <th className="num">Bloqueado</th>
                      <th className="num">Disponível</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock.rows.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <Link href={`/estoque/saldo/${b.id}`} className="link">
                            {b.sku}
                          </Link>
                          <span className="block text-xs text-slate-500">{b.description}</span>
                        </td>
                        <td className="code">{b.lot_code || "—"}</td>
                        <td>{fmtDate(b.expiry_date)}</td>
                        <td className="num">{fmtQty(b.quantity)}</td>
                        <td className="num">{fmtQty(b.reserved_qty)}</td>
                        <td className="num">{fmtQty(b.blocked_qty)}</td>
                        <td className="num font-medium">{fmtQty(b.available_qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState title="Endereço vazio" />
            )}
          </Card>
          <Card>
            <CardHeader
              title="Movimentações recentes"
              actions={
                <Link href={`/estoque/movimentacoes?locationId=${id}`} className="link text-xs">
                  Ver todas
                </Link>
              }
            />
            {movements.rows.length ? (
              <TableWrap>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Data/hora</th>
                      <th>Tipo</th>
                      <th>Produto</th>
                      <th className="num">Qtd.</th>
                      <th>Origem → destino</th>
                      <th>Usuário</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.rows.map((m) => (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap">{fmtDateTime(m.created_at)}</td>
                        <td>{MOVEMENT_LABELS[m.movement_type]}</td>
                        <td>{m.sku}</td>
                        <td className="num">{fmtQty(m.quantity)}</td>
                        <td className="text-xs">
                          {m.from_code ?? "—"} → {m.to_code ?? "—"}
                        </td>
                        <td>{m.user_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState title="Sem movimentações" />
            )}
          </Card>
        </div>
        <div className="space-y-5">
          {manage ? (
            <>
              <Card>
                <CardHeader title="Editar endereço" />
                <CardBody>
                  <ActionForm action={updateLocationAction} className="grid grid-cols-2 gap-3">
                    <input type="hidden" name="_id" value={id} />
                    <Field label="Tipo">
                      <Select name="locationType" defaultValue={loc.location_type} options={LOCATION_TYPES.map((t) => ({ value: t, label: LOCATION_TYPE_LABELS[t] }))} />
                    </Field>
                    <Field label="Classe">
                      <Select
                        name="storageClass"
                        defaultValue={loc.storage_class ?? "general"}
                        options={STORAGE_CLASSES.map((c) => ({ value: c, label: STORAGE_CLASS_LABELS[c] }))}
                      />
                    </Field>
                    <Field label="Capacidade (un)" required>
                      <Input name="capacityUnits" type="number" min={1} step="any" defaultValue={loc.capacity_units} required />
                    </Field>
                    <Field label="Peso máx. (kg)">
                      <Input name="maxWeightKg" type="number" step="any" defaultValue={loc.max_weight_kg ?? ""} />
                    </Field>
                    <Field label="Observações" className="col-span-2">
                      <Input name="notes" defaultValue={loc.notes ?? ""} maxLength={500} />
                    </Field>
                    <div className="col-span-2">
                      <SubmitButton>Salvar alterações</SubmitButton>
                    </div>
                  </ActionForm>
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Status" description="Bloqueado: não recebe armazenagem nem é usado em reservas. Inativo: exige endereço vazio." />
                <CardBody>
                  <ActionForm action={setLocationStatusAction} className="space-y-3" resetOnSuccess>
                    <input type="hidden" name="_id" value={id} />
                    <Field label="Novo status">
                      <Select name="status" defaultValue={loc.status} options={Object.entries(STATUS.location).map(([v, s]) => ({ value: v, label: s.label }))} />
                    </Field>
                    <Field label="Motivo" required>
                      <Input name="reason" required minLength={3} maxLength={500} />
                    </Field>
                    <SubmitButton variant="secondary">Alterar status</SubmitButton>
                  </ActionForm>
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Excluir endereço" description="Permitido somente para endereços sem estoque, movimentações ou tarefas. Caso contrário, inative-o." />
                <CardBody>
                  <ActionForm action={deleteLocationAction} confirm={`Excluir definitivamente ${loc.code}?`}>
                    <input type="hidden" name="_id" value={id} />
                    <SubmitButton variant="danger" size="sm">
                      Excluir endereço
                    </SubmitButton>
                  </ActionForm>
                </CardBody>
              </Card>
            </>
          ) : null}
          <Card>
            <CardHeader title="Histórico de alterações" />
            {history.length ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="px-4 py-2.5">
                    <p className="font-medium text-slate-800">{AUDIT_ACTION_LABELS[h.action] ?? h.action}</p>
                    <p className="text-xs text-slate-500">
                      {h.user_name} · {fmtDateTime(h.created_at)}
                      {typeof h.details.reason === "string" ? ` · ${h.details.reason}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Sem alterações registradas" />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
