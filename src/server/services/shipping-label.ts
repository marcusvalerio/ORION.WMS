import "server-only";
import type { Ctx } from "../context";
import { NotFoundError } from "../errors";
import { getCompanyProfile, type CompanyProfile } from "./company";

export interface ShippingLabel {
  company: CompanyProfile;
  shipment: {
    id: string;
    code: string;
    order_code: string;
    customer_name: string;
    sales_order_number: string | null;
    carrier: string | null;
    vehicle_plate: string | null;
    document_ref: string | null;
    shipped_at: string;
    warehouse_name: string;
  };
  lines: { sku: string; description: string; uom: string; shipped_qty: number }[];
}

/** Dados da etiqueta de expedição: remetente (razão social, CNPJ, endereço) + volume. */
export async function getShippingLabel(ctx: Ctx, shipmentId: string): Promise<ShippingLabel> {
  const [shipment] = await ctx.db.query<ShippingLabel["shipment"]>(
    `select s.id, s.code, o.code as order_code, o.customer_name, so.number as sales_order_number, s.carrier, s.vehicle_plate,
            s.document_ref, s.shipped_at::text as shipped_at, w.name as warehouse_name
     from wms.shipments s join wms.outbound_orders o on o.id = s.order_id join wms.warehouses w on w.id = o.warehouse_id
     left join erp.sales_orders so on so.id = o.sales_order_id
     where s.id = $1 and s.company_id = $2`,
    [shipmentId, ctx.user.companyId],
  );
  if (!shipment) throw new NotFoundError("Expedição");
  const lines = await ctx.db.query<ShippingLabel["lines"][number]>(
    `select p.sku, p.description, p.uom, l.shipped_qty from wms.outbound_order_lines l
     join wms.shipments s on s.order_id = l.order_id join erp.products p on p.id = l.product_id
     where s.id = $1 and l.shipped_qty > 0 order by l.line_no`,
    [shipmentId],
  );
  return { company: await getCompanyProfile(ctx.db, ctx.user.companyId), shipment, lines };
}
