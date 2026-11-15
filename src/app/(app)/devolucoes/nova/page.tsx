import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { listReturnableOrders, returnableLines, RETURN_REASONS } from "@/server/services/returns";
import { createReturnAction } from "@/server/actions/inbound";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { RETURN_REASON_LABELS } from "@/lib/labels";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid, readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Registrar devolução" };

export default async function NewReturnPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  const header = (
    <PageHeader
      title="Registrar devolução"
      description="Escolha o pedido expedido e informe as quantidades devolvidas (no máximo o expedido, descontadas devoluções anteriores)."
      breadcrumbs={[{ label: "Entrada" }, { label: "Devoluções", href: "/devolucoes" }, { label: "Nova" }]}
    />
  );
  if (!can(ctx.user.role, "return.create")) {
    return (
      <>
        {header}
        <Alert level="warning">Seu perfil não permite registrar devoluções.</Alert>
      </>
    );
  }
  const orders = await listReturnableOrders(ctx);
  const orderId = isUuid(params.pedido) ? params.pedido : undefined;
  const order = orders.find((o) => o.id === orderId);
  const lines = order ? await returnableLines(ctx.db, ctx.user.companyId, order.id) : [];

  return (
    <>
      {header}
      <Card className="mb-5">
        <CardHeader title="Pedidos expedidos" />
        {orders.length ? (
          <ul className="divide-y divide-line text-sm">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>
                  <span className="font-medium">{o.code}</span> — {o.customer_name}
                  <span className="block text-xs text-muted">
                    Expedido {fmtDateTime(o.shipped_at)} · {fmtQty(o.shipped)} un · já devolvido {fmtQty(o.returned)}
                  </span>
                </span>
                {o.id === orderId ? (
                  <span className="text-xs font-medium text-link">Selecionado</span>
                ) : o.shipped > o.returned ? (
                  <Link className="link text-xs" href={`/devolucoes/nova?pedido=${o.id}`}>
                    Selecionar
                  </Link>
                ) : (
                  <span className="text-xs text-muted">Tudo devolvido</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nenhum pedido expedido" description="Só é possível devolver pedidos com expedição confirmada." />
        )}
      </Card>
      {order ? (
        <Card>
          <CardHeader title={`Itens do pedido ${order.code}`} />
          <ActionForm action={createReturnAction}>
            <input type="hidden" name="outboundOrderId" value={order.id} />
            <TableWrap>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="num">Expedido</th>
                    <th className="num">Já devolvido</th>
                    <th>Lote</th>
                    <th className="w-32">Devolver</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.id}>
                      <td>
                        <input type="hidden" name={`items.${i}.orderLineId`} value={l.id} />
                        <span className="font-medium">{l.sku}</span>
                        <span className="block text-xs text-muted">{l.description}</span>
                      </td>
                      <td className="num">
                        {fmtQty(l.shipped_qty)} {l.uom}
                      </td>
                      <td className="num">{fmtQty(l.returned_qty)}</td>
                      <td>
                        {l.lots.length > 1 ? (
                          <Select name={`items.${i}.lotCode`} options={l.lots.map((x) => ({ value: x, label: x || "(sem lote)" }))} aria-label={`Lote ${l.sku}`} />
                        ) : (
                          <span className="text-xs">{l.lots[0] || "—"}</span>
                        )}
                      </td>
                      <td>
                        <Input name={`items.${i}.quantity`} type="number" min={0} max={l.returnable} step="any" defaultValue="" aria-label={`Devolver ${l.sku}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <CardBody className="grid grid-cols-1 gap-3 border-t border-line md:grid-cols-3 md:items-end">
              <Field label="Motivo" required>
                <Select name="reason" required options={RETURN_REASONS.map((r) => ({ value: r, label: RETURN_REASON_LABELS[r] }))} />
              </Field>
              <Field label="Detalhes do motivo">
                <Input name="reasonNotes" maxLength={500} />
              </Field>
              <SubmitButton>Registrar devolução</SubmitButton>
            </CardBody>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
