import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { getBalance, listMovements } from "@/server/services/stock";
import { blockStockAction, unblockStockAction } from "@/server/actions/stock";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { MOVEMENT_LABELS } from "@/lib/labels";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Saldo" };

export default async function BalancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const b = await getBalance(ctx, id);
  if (!b) notFound();
  const movements = await listMovements(ctx, { productId: b.product_id, locationId: b.location_id, pageSize: 30 });
  const canBlock = can(ctx.user.role, "stock.block");

  return (
    <>
      <PageHeader
        title={`${b.sku} em ${b.location_code}`}
        description={b.description}
        breadcrumbs={[{ label: "Armazém" }, { label: "Estoque", href: "/estoque" }, { label: "Saldo" }]}
        actions={
          can(ctx.user.role, "stock.transfer") && b.available_qty > 0 ? (
            <ButtonLink href={`/estoque/transferir?balance=${b.id}`} size="sm" variant="primary">
              <ArrowLeftRight className="size-4" /> Transferir
            </ButtonLink>
          ) : null
        }
      />
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardBody>
              <DefinitionList
                items={[
                  ["Endereço", <Link key="l" href={`/armazem/enderecos/${b.location_id}`} className="link font-mono text-xs">{b.location_code}</Link>],
                  ["Produto", <Link key="p" href={`/produtos/${b.product_id}`} className="link">{b.sku}</Link>],
                  ["Lote", b.lot_code || "—"],
                  ["Validade", fmtDate(b.expiry_date)],
                  ["Físico", fmtQty(b.quantity)],
                  ["Reservado", fmtQty(b.reserved_qty)],
                  ["Bloqueado", fmtQty(b.blocked_qty)],
                  ["Disponível", <strong key="d" className="text-emerald-700">{fmtQty(b.available_qty)}</strong>],
                  ["Última atualização", fmtDateTime(b.updated_at)],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Histórico deste saldo" description="Movimentações do produto neste endereço (todas as origens e destinos)." />
            {movements.rows.length ? (
              <TableWrap>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Data/hora</th>
                      <th>Tipo</th>
                      <th className="num">Qtd.</th>
                      <th>Origem → destino</th>
                      <th>Documento</th>
                      <th>Motivo</th>
                      <th>Usuário</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.rows.map((m) => (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap">{fmtDateTime(m.created_at)}</td>
                        <td>{MOVEMENT_LABELS[m.movement_type]}</td>
                        <td className="num">{fmtQty(m.quantity)}</td>
                        <td className="text-xs">
                          {m.from_code ?? "—"} → {m.to_code ?? "—"}
                        </td>
                        <td>{m.reference_code ?? m.task_code ?? "—"}</td>
                        <td className="max-w-xs truncate text-xs" title={m.reason ?? ""}>
                          {m.reason ?? "—"}
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
          {canBlock ? (
            <>
              <Card>
                <CardHeader title="Bloquear quantidade" description="Retira do disponível (ex.: avaria, inspeção). Gera movimentação e auditoria." />
                <CardBody>
                  <ActionForm action={blockStockAction} resetOnSuccess className="space-y-3">
                    <input type="hidden" name="_id" value={b.id} />
                    <Field label={`Quantidade (máx. ${fmtQty(b.available_qty)})`} required>
                      <Input name="quantity" type="number" min={0} step="any" max={b.available_qty} required />
                    </Field>
                    <Field label="Motivo" required>
                      <Input name="reason" required minLength={5} />
                    </Field>
                    <SubmitButton variant="secondary" disabled={b.available_qty <= 0}>
                      Bloquear
                    </SubmitButton>
                  </ActionForm>
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Desbloquear quantidade" />
                <CardBody>
                  <ActionForm action={unblockStockAction} resetOnSuccess className="space-y-3">
                    <input type="hidden" name="_id" value={b.id} />
                    <Field label={`Quantidade (máx. ${fmtQty(b.blocked_qty)})`} required>
                      <Input name="quantity" type="number" min={0} step="any" max={b.blocked_qty} required />
                    </Field>
                    <Field label="Motivo" required>
                      <Input name="reason" required minLength={5} />
                    </Field>
                    <SubmitButton variant="secondary" disabled={b.blocked_qty <= 0}>
                      Desbloquear
                    </SubmitButton>
                  </ActionForm>
                </CardBody>
              </Card>
            </>
          ) : (
            <Card>
              <CardBody className="text-sm text-slate-500">Bloqueios e desbloqueios exigem perfil de supervisor ou administrador.</CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
