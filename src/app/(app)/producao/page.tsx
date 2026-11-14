import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { listErpProductionOrders, listProductionLines, listRequisitions } from "@/server/services/production";
import { createRequisitionAction } from "@/server/actions/comex";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Checkbox, Field, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { fmtDate, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";

export const metadata = { title: "Produção" };

export default async function ProductionPage() {
  const ctx = await requireCtx();
  const manage = can(ctx.user.role, "production.manage");
  const [requisitions, orders, lines] = await Promise.all([
    listRequisitions(ctx),
    listErpProductionOrders(ctx),
    manage ? listProductionLines(ctx) : Promise.resolve([]),
  ]);
  const pending = orders.filter((o) => !o.requisition_id && ["open", "in_progress"].includes(o.status));

  return (
    <>
      <PageHeader
        title="Produção"
        description="Abastecimento de produção a partir das ordens do MRP do ERP: reserva FEFO dos componentes, separação até a linha, entrega com confirmação, devolução de sobras e entrada do produto acabado."
        breadcrumbs={[{ label: "Operações" }, { label: "Produção" }]}
      />

      <Card className="mb-5">
        <CardHeader title={`Requisições de material (${requisitions.length})`} />
        {requisitions.length ? (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Requisição</th>
                  <th>Ordem</th>
                  <th>Produto acabado</th>
                  <th>Linha</th>
                  <th className="num">Requerido</th>
                  <th className="num">Reservado</th>
                  <th className="num">Entregue</th>
                  <th className="num">Acabado</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {requisitions.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/producao/${r.id}`} className="link font-mono">
                        {r.code}
                      </Link>
                    </td>
                    <td>{r.order_number}</td>
                    <td>
                      <span className="font-medium">{r.sku}</span>
                      <span className="block text-xs text-muted">lote {r.output_lot_code}</span>
                    </td>
                    <td className="font-mono text-[11px]">{r.line_code}</td>
                    <td className="num">{fmtQty(r.required)}</td>
                    <td className="num">{fmtQty(r.reserved)}</td>
                    <td className="num">{fmtQty(r.delivered)}</td>
                    <td className="num">
                      {fmtQty(r.output_qty)} / {fmtQty(r.planned_output_qty)}
                    </td>
                    <td>
                      <StatusBadge kind="productionRequisition" status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState title="Nenhuma requisição" description="Crie uma requisição a partir de uma ordem de produção do ERP." />
        )}
      </Card>

      <Card>
        <CardHeader title={`Ordens de produção do ERP (${orders.length})`} description="Cadastro do ATLAS.ERP (MRP). O WMS apenas lê a ordem e a lista de componentes." />
        {orders.length ? (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Ordem</th>
                  <th>Produto</th>
                  <th className="num">Quantidade</th>
                  <th>Previsão</th>
                  <th className="num">Componentes</th>
                  <th>Situação no ERP</th>
                  <th>Requisição</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className="font-mono">{o.number}</td>
                    <td>
                      <span className="font-medium">{o.sku}</span>
                      <span className="block text-xs text-muted">{o.description}</span>
                    </td>
                    <td className="num">{fmtQty(o.quantity)}</td>
                    <td>{fmtDate(o.due_date)}</td>
                    <td className="num">{o.component_count}</td>
                    <td>
                      <Badge tone="neutral">{o.status}</Badge>
                    </td>
                    <td>
                      {o.requisition_id ? (
                        <Link href={`/producao/${o.requisition_id}`} className="link">
                          {o.requisition_code}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState title="Nenhuma ordem de produção" />
        )}
        {manage && pending.length ? (
          <CardBody className="border-t border-subtle">
            {lines.length ? (
              <ActionForm action={createRequisitionAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Ordem de produção" required>
                  <Select name="productionOrderId" required options={pending.map((o) => ({ value: o.id, label: `${o.number} — ${o.sku}` }))} />
                </Field>
                <Field label="Linha (endereço de produção)" required>
                  <Select name="lineLocationId" required options={lines.map((l) => ({ value: l.id, label: `${l.code} (${l.zone_name})` }))} />
                </Field>
                <div className="flex items-end">
                  <Checkbox name="allOrNothing" defaultChecked label="Reserva tudo ou nada" />
                </div>
                <div className="flex items-end">
                  <SubmitButton>Criar requisição</SubmitButton>
                </div>
              </ActionForm>
            ) : (
              <p className="text-sm text-muted">
                Cadastre uma zona do tipo Produção com um endereço de linha em{" "}
                <Link href="/armazem/estrutura" className="link">
                  Estrutura física
                </Link>
                .
              </p>
            )}
          </CardBody>
        ) : null}
      </Card>
    </>
  );
}
