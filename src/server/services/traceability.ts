import "server-only";
import { z } from "zod";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError, NotFoundError } from "../errors";
import { parse, uuid } from "../validation";
import { audit, nextCode, runOperation, type OpOptions } from "./common";
import { insertMovement } from "./stock-core";

/**
 * Rastreabilidade e recall (R5). A genealogia é gravada na entrega à linha
 * (componente/lote → acabado/lote da ordem). Para trás: acabado → componentes.
 * Para frente: componente → acabados → pedidos expedidos → cliente.
 */

const lotSchema = z.object({ productId: uuid("Produto"), lotCode: z.string().trim().max(60).default("") });

type Node = { product_id: string; sku: string; description: string; lot: string; qty: number; depth: number };

export async function traceBackward(ctx: Ctx, input: unknown) {
  assertCan(ctx, "reports.view");
  const d = parse(lotSchema, input);
  return ctx.db.query<Node>(
    `with recursive t(product_id, lot, qty, depth) as (
       select child_product, child_lot, qty, 1 from wms.lot_genealogy where company_id = $1 and parent_product = $2 and parent_lot = $3
       union all
       select g.child_product, g.child_lot, g.qty, t.depth + 1 from wms.lot_genealogy g join t on g.parent_product = t.product_id and g.parent_lot = t.lot
       where g.company_id = $1 and t.depth < 6
     )
     select t.product_id, p.sku, p.description, t.lot, sum(t.qty) as qty, min(t.depth) as depth
     from t join erp.products p on p.id = t.product_id group by t.product_id, p.sku, p.description, t.lot order by depth, p.sku, t.lot`,
    [ctx.user.companyId, d.productId, d.lotCode],
  );
}

/** Lotes afetados para frente (o próprio lote + acabados que o consumiram, em cascata). */
async function forwardLots(ctx: Ctx, productId: string, lotCode: string) {
  return ctx.db.query<Node>(
    `with recursive t(product_id, lot, qty, depth) as (
       select $2::uuid, $3::text, 0::numeric, 0
       union all
       select g.parent_product, g.parent_lot, g.qty, t.depth + 1 from wms.lot_genealogy g join t on g.child_product = t.product_id and g.child_lot = t.lot
       where g.company_id = $1 and t.depth < 6
     )
     select t.product_id, p.sku, p.description, t.lot, sum(t.qty) as qty, min(t.depth) as depth
     from t join erp.products p on p.id = t.product_id where p.company_id = $1
     group by t.product_id, p.sku, p.description, t.lot order by depth, p.sku, t.lot`,
    [ctx.user.companyId, productId, lotCode],
  );
}

export async function traceForward(ctx: Ctx, input: unknown) {
  assertCan(ctx, "reports.view");
  const d = parse(lotSchema, input);
  const lots = await forwardLots(ctx, d.productId, d.lotCode);
  if (!lots.length) throw new NotFoundError("Produto");
  const orders = await ctx.db.query<{ code: string; customer: string; sales_order: string | null; sku: string; lot: string; qty: number; shipped_at: string | null }>(
    `select o.code, o.customer_name as customer, so.number as sales_order, p.sku, r.lot_code as lot, sum(r.picked_qty) as qty,
            o.shipped_at::text as shipped_at
     from wms.stock_reservations r join wms.outbound_order_lines ol on ol.id = r.order_line_id join wms.outbound_orders o on o.id = ol.order_id
     join erp.products p on p.id = r.product_id left join erp.sales_orders so on so.id = o.sales_order_id
     where o.company_id = $1 and r.status = 'picked' and (r.product_id, r.lot_code) in (select x.pid, x.lot from unnest($2::uuid[], $3::text[]) as x(pid, lot))
     group by o.code, o.customer_name, so.number, p.sku, r.lot_code, o.shipped_at order by o.code`,
    [ctx.user.companyId, lots.map((l) => l.product_id), lots.map((l) => l.lot)],
  );
  return { lots, orders };
}

/**
 * Inicia o recall: bloqueia todo o saldo disponível dos lotes afetados, gera a lista de
 * clientes e pedidos e registra o processo na auditoria.
 */
export async function startRecall(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "quality.release");
  const d = parse(lotSchema.extend({ reason: z.string().trim().min(5, "Informe o motivo do recall (mínimo de 5 caracteres).") }), input);
  const { lots, orders } = await traceForward(ctx, d);
  return runOperation(ctx, "quality.recall", opts, async (tx) => {
    const code = await nextCode(tx, ctx.user.companyId, "RCL");
    let blocked = 0;
    for (const l of lots) {
      const balances = await tx.query<{ id: string; warehouse_id: string; location_id: string; free: number; expiry_date: string | null }>(
        `select id, warehouse_id, location_id, quantity - reserved_qty - blocked_qty as free, expiry_date::text as expiry_date
         from wms.stock_balances where company_id = $1 and product_id = $2 and lot_code = $3 and quantity - reserved_qty - blocked_qty > 0 for update`,
        [ctx.user.companyId, l.product_id, l.lot],
      );
      for (const b of balances) {
        await tx.query(`update wms.stock_balances set blocked_qty = blocked_qty + $2, version = version + 1, updated_at = now() where id = $1`, [
          b.id,
          b.free,
        ]);
        await insertMovement(tx, ctx, {
          warehouseId: b.warehouse_id,
          movementType: "block",
          productId: l.product_id,
          lotCode: l.lot,
          expiryDate: b.expiry_date,
          quantity: Number(b.free),
          fromLocationId: b.location_id,
          reason: `Recall ${code}: ${d.reason}`,
          referenceType: "recall",
          referenceCode: code,
        });
        blocked += Number(b.free);
      }
    }
    const customers = [...new Set(orders.map((o) => o.customer))];
    await tx.query(
      `insert into wms.recalls (company_id, code, product_id, lot_code, reason, affected, customers, blocked_qty, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [ctx.user.companyId, code, d.productId, d.lotCode, d.reason, JSON.stringify(lots), JSON.stringify(orders), blocked, ctx.user.id],
    );
    if (!lots.length) throw new DomainError("Lote não encontrado.");
    await audit(tx, ctx, "quality.recall_started", "recall", null, code, { ...d, lots: lots.length, orders: orders.length, customers, blocked });
    return { code, lots: lots.length, orders, customers, blocked };
  });
}
