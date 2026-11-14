import "server-only";
import type { Ctx } from "../context";
import { DomainError } from "../errors";

/** Dados para as etiquetas imprimíveis (endereço, produto e volume de expedição). */

export interface LocationLabel {
  id: string;
  code: string;
  warehouse_code: string;
  zone_code: string;
  zone_name: string;
  aisle: string;
  bay: string;
  level: string;
  position: string;
  location_type: string;
}

export const MAX_LOCATION_LABELS = 500;

export interface LocationLabelFilters {
  warehouseId?: string | null;
  zoneId?: string | null;
  aisle?: string | null;
  q?: string | null;
  ids?: string[] | null;
}

export async function listLocationLabels(ctx: Ctx, f: LocationLabelFilters = {}) {
  const rows = await ctx.db.query<LocationLabel>(
    `select l.id, l.code, w.code as warehouse_code, z.code as zone_code, z.name as zone_name, l.aisle, l.bay, l.level,
            l.position, l.location_type
     from wms.locations l join wms.zones z on z.id = l.zone_id join wms.warehouses w on w.id = l.warehouse_id
     where l.company_id = $1 and l.status <> 'inactive'
       and ($2::uuid is null or l.warehouse_id = $2::uuid)
       and ($3::uuid is null or l.zone_id = $3::uuid)
       and ($4::text is null or upper(l.aisle) = upper($4))
       and ($5::text is null or l.code ilike '%' || $5 || '%')
       and ($6::uuid[] is null or l.id = any($6::uuid[]))
     order by w.code, l.aisle, l.bay, l.level, l.position
     limit ${MAX_LOCATION_LABELS + 1}`,
    [ctx.user.companyId, f.warehouseId || null, f.zoneId || null, f.aisle || null, f.q || null, f.ids?.length ? f.ids : null],
  );
  return { rows: rows.slice(0, MAX_LOCATION_LABELS), truncated: rows.length > MAX_LOCATION_LABELS };
}

/** Ruas (aisles) existentes, para o filtro de seleção. */
export async function listAisles(ctx: Ctx, warehouseId?: string | null) {
  const rows = await ctx.db.query<{ aisle: string }>(
    `select distinct aisle from wms.locations where company_id = $1 and ($2::uuid is null or warehouse_id = $2::uuid) order by aisle`,
    [ctx.user.companyId, warehouseId || null],
  );
  return rows.map((r) => r.aisle);
}

/** Seta da etiqueta de endereço: níveis 00/01 apontam para baixo; acima, para cima. */
export function levelArrow(level: string): "up" | "down" {
  const n = Number(level);
  return Number.isFinite(n) && n <= 1 ? "down" : "up";
}

export async function getProductLabel(ctx: Ctx, productId: string) {
  const [product] = await ctx.db.query<{ id: string; sku: string; description: string; barcode: string | null; uom: string; category: string | null }>(
    `select id, sku, description, barcode, uom, category from erp.products where id = $1 and company_id = $2`,
    [productId, ctx.user.companyId],
  );
  if (!product) return null;
  const packaging = await ctx.db.query<{ code: string; description: string; units_per_package: number; barcode: string | null }>(
    `select code, description, units_per_package, barcode from wms.packaging_units
     where product_id = $1 and company_id = $2 and active order by units_per_package`,
    [productId, ctx.user.companyId],
  );
  return { ...product, packaging };
}

export const MAX_VOLUMES = 200;

/** Etiquetas de volume do pedido de saída: "volume x de y", pedido, cliente e doca. */
export async function getShippingLabels(ctx: Ctx, orderId: string, volumes: number) {
  if (!Number.isInteger(volumes) || volumes < 1 || volumes > MAX_VOLUMES) {
    throw new DomainError(`Informe de 1 a ${MAX_VOLUMES} volumes.`, "VALIDATION", "volumes");
  }
  const [order] = await ctx.db.query<{
    id: string;
    code: string;
    status: string;
    customer_name: string;
    so_number: string | null;
    warehouse_code: string;
    warehouse_name: string;
    staging_code: string | null;
    carrier: string | null;
    total_qty: number;
    lines: number;
  }>(
    `select o.id, o.code, o.status, o.customer_name, so.number as so_number, w.code as warehouse_code, w.name as warehouse_name,
            sl.code as staging_code,
            (select s.carrier from wms.shipments s where s.order_id = o.id limit 1) as carrier,
            coalesce((select sum(case when l.picked_qty > 0 then l.picked_qty else l.requested_qty end) from wms.outbound_order_lines l where l.order_id = o.id), 0) as total_qty,
            (select count(*) from wms.outbound_order_lines l where l.order_id = o.id) as lines
     from wms.outbound_orders o join wms.warehouses w on w.id = o.warehouse_id
     left join erp.sales_orders so on so.id = o.sales_order_id
     left join wms.locations sl on sl.id = o.staging_location_id
     where o.id = $1 and o.company_id = $2`,
    [orderId, ctx.user.companyId],
  );
  if (!order) return null;
  if (order.status === "cancelled") throw new DomainError("Pedido cancelado não gera etiquetas de volume.", "INVALID_STATUS");
  const labels = Array.from({ length: volumes }, (_, i) => ({
    index: i + 1,
    total: volumes,
    /** Conteúdo do código de barras: pedido + volume (ex.: SAI-000001-003). */
    barcode: `${order.code}-${String(i + 1).padStart(3, "0")}`,
  }));
  return { order, labels };
}
