import Link from "next/link";
import { Download } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { listOrders, listShipments } from "@/server/services/outbound";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap } from "@/components/ui/table";
import { OrderTable } from "@/components/wms/order-table";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";

export const metadata = { title: "Expedição" };

export default async function ShippingPage() {
  const ctx = await requireCtx();
  const [toCheck, ready, shipments] = await Promise.all([listOrders(ctx, { status: "picked" }), listOrders(ctx, { status: "checked" }), listShipments(ctx)]);
  return (
    <>
      <PageHeader
        title="Expedição"
        description="Pedidos separados aguardando conferência final, pedidos conferidos prontos para embarque e histórico de expedições confirmadas."
        breadcrumbs={[{ label: "Operações" }, { label: "Expedição" }]}
        actions={
          can(ctx.user.role, "reports.export") ? (
            <ButtonLink href="/api/relatorios/expedicoes" size="sm" prefetch={false}>
              <Download className="size-4" /> CSV
            </ButtonLink>
          ) : null
        }
      />
      <div className="space-y-5">
        <Card>
          <CardHeader title={`Aguardando conferência final (${toCheck.length})`} />
          <OrderTable rows={toCheck} empty="Nenhum pedido aguardando conferência" />
        </Card>
        <Card>
          <CardHeader title={`Conferidos, prontos para expedir (${ready.length})`} />
          <OrderTable rows={ready} empty="Nenhum pedido pronto para expedição" />
        </Card>
        <Card>
          <CardHeader title="Expedições confirmadas" />
          {shipments.length ? (
            <TableWrap>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Expedição</th>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th>Transportadora / placa</th>
                    <th>Documento</th>
                    <th className="num">Quantidade</th>
                    <th>Expedido em</th>
                    <th>Responsável</th>
                  </tr>
                </thead>
                <tbody>
                  {shipments.map((s) => (
                    <tr key={s.id}>
                      <td className="font-medium">{s.code}</td>
                      <td>
                        <Link href={`/separacao/${s.order_id}`} className="link">
                          {s.order_code}
                        </Link>
                      </td>
                      <td>{s.customer_name}</td>
                      <td>
                        {s.carrier ?? "—"}
                        <span className="block text-xs text-slate-500">{s.vehicle_plate ?? ""}</span>
                      </td>
                      <td>{s.document_ref ?? "—"}</td>
                      <td className="num">{fmtQty(s.total)}</td>
                      <td className="whitespace-nowrap">{fmtDateTime(s.shipped_at)}</td>
                      <td>{s.shipped_by_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState title="Nenhuma expedição confirmada" />
          )}
        </Card>
      </div>
    </>
  );
}
