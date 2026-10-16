import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { listOrders } from "@/server/services/outbound";
import { listSalesOrders } from "@/server/integrations/erp/gateway";
import { listWarehouses } from "@/server/services/warehouse";
import { importSalesOrderAction } from "@/server/actions/outbound";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { OrderTable } from "@/components/wms/order-table";
import { STATUS } from "@/lib/labels";
import { fmtDate, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Separação" };

const SO_STATUS: Record<string, string> = { open: "Aberto", in_fulfillment: "Em atendimento", shipped: "Expedido", cancelled: "Cancelado" };

export default async function PickingPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  const create = can(ctx.user.role, "outbound.create");
  const [orders, salesOrders, warehouses] = await Promise.all([
    listOrders(ctx, { status: params.status ?? "open,reserved,picking,picked,checked", q: params.q }),
    create ? listSalesOrders(ctx.db, ctx.user.companyId) : Promise.resolve([]),
    create ? listWarehouses(ctx) : Promise.resolve([]),
  ]);
  const pendingSo = salesOrders.filter((s) => s.status === "open" && !s.outbound_code);
  const qs = new URLSearchParams(Object.entries({ status: params.status, q: params.q }).filter(([, v]) => v) as [string, string][]);

  return (
    <>
      <PageHeader
        title="Pedidos e separação"
        description="Fluxo de saída: pedido aberto → reservado → em separação → separado → conferido → expedido. Reservar não baixa estoque; a baixa física ocorre só na expedição."
        breadcrumbs={[{ label: "Operações" }, { label: "Separação" }]}
        actions={
          <>
            {create ? (
              <ButtonLink href="/separacao/novo" size="sm" variant="primary">
                <Plus className="size-4" /> Pedido manual
              </ButtonLink>
            ) : null}
            {can(ctx.user.role, "reports.export") ? (
              <ButtonLink href={`/api/relatorios/pedidos?${qs}`} size="sm" prefetch={false}>
                <Download className="size-4" /> CSV
              </ButtonLink>
            ) : null}
          </>
        }
      />
      {create && pendingSo.length ? (
        <Card className="mb-5">
          <CardHeader title={`Pedidos de venda do ERP aguardando importação (${pendingSo.length})`} />
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Pedido ERP</th>
                  <th>Cliente</th>
                  <th>Emissão</th>
                  <th className="num">Quantidade</th>
                  <th>Situação</th>
                  <th className="min-w-[320px]">Importar para o WMS</th>
                </tr>
              </thead>
              <tbody>
                {pendingSo.map((so) => (
                  <tr key={so.id}>
                    <td className="font-medium">{so.number}</td>
                    <td>{so.customer_name}</td>
                    <td>{fmtDate(so.issue_date)}</td>
                    <td className="num">{fmtQty(so.total_qty)}</td>
                    <td>
                      <Badge tone="info">{SO_STATUS[so.status]}</Badge>
                    </td>
                    <td>
                      <ActionForm action={importSalesOrderAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="salesOrderId" value={so.id} />
                        <Select name="warehouseId" className="w-auto" aria-label="Depósito" options={warehouses.filter((w) => w.active).map((w) => ({ value: w.id, label: w.code }))} />
                        <Select
                          name="priority"
                          className="w-auto"
                          aria-label="Prioridade"
                          defaultValue="2"
                          options={[
                            { value: "1", label: "Alta" },
                            { value: "2", label: "Normal" },
                            { value: "3", label: "Baixa" },
                          ]}
                        />
                        <SubmitButton size="sm">Importar</SubmitButton>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      ) : null}
      <Card>
        <FilterBar resetHref="/separacao">
          <FilterField label="Buscar" className="w-full sm:w-64">
            <Input name="q" defaultValue={params.q} placeholder="Pedido, cliente ou pedido ERP" />
          </FilterField>
          <FilterField label="Status" className="w-full sm:w-52">
            <Select
              name="status"
              defaultValue={params.status}
              placeholder="Em andamento"
              options={[
                { value: "open,reserved,picking,picked,checked,shipped,cancelled", label: "Todos" },
                ...Object.entries(STATUS.outbound).map(([v, s]) => ({ value: v, label: s.label })),
              ]}
            />
          </FilterField>
        </FilterBar>
        <OrderTable rows={orders} empty="Nenhum pedido em andamento" />
      </Card>
      <p className="mt-3 text-xs text-slate-500">
        Pedidos expedidos ficam em <Link href="/expedicao" className="link">Expedição</Link>.
      </p>
    </>
  );
}
