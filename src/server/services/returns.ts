import "server-only";
import { z } from "zod";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError, NotFoundError } from "../errors";
import { parse, uuid, optionalText, nonNegQty } from "../validation";
import { audit, enqueueIntegrationEvent, nextCode, round3, runOperation, type OpOptions } from "./common";
import { getSetting } from "./settings";
import { createPutawayTasks, createQualityHold } from "./quality";
import { addStock, insertMovement, lockBalance, removeStock, validateDestination } from "./stock-core";

/**
 * Devolução de cliente vinculada a um pedido de saída expedido.
 *  - quantidade devolvida por linha ≤ expedida (somando devoluções não canceladas, sob lock do pedido);
 *  - inspeção por item: apto → tarefa de armazenagem normal; avariado → quarentena com saldo
 *    bloqueado; descarte → entrada na quarentena e baixa imediata com movimento "discard";
 *  - ao concluir, o ERP é avisado pelo evento "customer_return.completed" na outbox.
 */

export const RETURN_REASONS = ["damaged_in_transit", "wrong_item", "quality", "regret", "excess", "other"] as const;
export const RETURN_STATUSES = ["pending", "completed", "cancelled"] as const;

const createSchema = z.object({
  outboundOrderId: uuid("Pedido de saída"),
  reason: z.enum(RETURN_REASONS, { error: "Motivo inválido." }),
  reasonNotes: optionalText,
  items: z
    .array(
      z.object({
        orderLineId: uuid("Linha do pedido"),
        quantity: z.union([z.literal("").transform(() => 0), nonNegQty("Quantidade devolvida")]),
        lotCode: z.string().trim().max(40).nullish(),
      }),
    )
    .min(1, "Informe ao menos um item."),
});

/** Saldo devolvível por linha de um pedido expedido. */
export async function returnableLines(q: Queryable, companyId: string, outboundOrderId: string) {
  return q.query<{
    id: string;
    line_no: number;
    product_id: string;
    sku: string;
    description: string;
    uom: string;
    shipped_qty: number;
    returned_qty: number;
    returnable: number;
    lots: string[];
  }>(
    `select l.id, l.line_no, l.product_id, p.sku, p.description, p.uom, l.shipped_qty,
            coalesce((select sum(ri.quantity) from wms.customer_return_items ri join wms.customer_returns r on r.id = ri.return_id
                      where ri.order_line_id = l.id and r.status <> 'cancelled'), 0) as returned_qty,
            l.shipped_qty - coalesce((select sum(ri.quantity) from wms.customer_return_items ri join wms.customer_returns r on r.id = ri.return_id
                      where ri.order_line_id = l.id and r.status <> 'cancelled'), 0) as returnable,
            coalesce((select array_agg(distinct s.lot_code) from wms.stock_reservations s where s.order_line_id = l.id and s.status = 'consumed'), '{}') as lots
     from wms.outbound_order_lines l join erp.products p on p.id = l.product_id join wms.outbound_orders o on o.id = l.order_id
     where l.order_id = $1 and o.company_id = $2 order by l.line_no`,
    [outboundOrderId, companyId],
  );
}

export async function createReturn(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "return.create");
  const d = parse(createSchema, input);
  return runOperation(ctx, "return.create", opts, async (tx) => {
    // Lock do pedido: devoluções simultâneas do mesmo pedido serializam e não superam o expedido.
    const [o] = await tx.query<{ id: string; code: string; status: string; warehouse_id: string; customer_name: string; is_demo: boolean }>(
      `select id, code, status, warehouse_id, customer_name, is_demo from wms.outbound_orders where id = $1 and company_id = $2 for update`,
      [d.outboundOrderId, ctx.user.companyId],
    );
    if (!o) throw new NotFoundError("Pedido de saída");
    if (o.status !== "shipped") throw new DomainError(`Só é possível devolver pedido expedido (${o.code} está "${o.status}").`, "INVALID_STATUS");
    const lines = new Map((await returnableLines(tx, ctx.user.companyId, o.id)).map((l) => [l.id, l]));
    const items = d.items.filter((i) => i.quantity > 0);
    if (!items.length) throw new DomainError("Informe a quantidade devolvida de ao menos um item.", "VALIDATION");
    const perLine = new Map<string, number>();
    for (const i of items) {
      const l = lines.get(i.orderLineId);
      if (!l) throw new DomainError("Item não pertence ao pedido.", "VALIDATION");
      perLine.set(l.id, round3((perLine.get(l.id) ?? 0) + i.quantity));
      if (perLine.get(l.id)! > l.returnable) {
        throw new DomainError(`Devolução de ${l.sku} acima do expedido: expedido ${l.shipped_qty}, já devolvido ${l.returned_qty}.`, "RETURN_EXCEEDS_SHIPPED");
      }
      const lot = (i.lotCode ?? "").toUpperCase();
      if (lot && !l.lots.includes(lot)) throw new DomainError(`Lote ${lot} não foi expedido neste pedido para ${l.sku}.`, "VALIDATION");
    }
    const code = await nextCode(tx, ctx.user.companyId, "DEV");
    const [r] = await tx.query<{ id: string }>(
      `insert into wms.customer_returns (company_id, warehouse_id, code, outbound_order_id, customer_name, reason, reason_notes, is_demo, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [ctx.user.companyId, o.warehouse_id, code, o.id, o.customer_name, d.reason, d.reasonNotes, o.is_demo, ctx.user.id],
    );
    let lineNo = 1;
    for (const i of items) {
      const l = lines.get(i.orderLineId)!;
      const lot = (i.lotCode ?? "").toUpperCase() || (l.lots.length === 1 ? l.lots[0] : "");
      const [exp] = await tx.query<{ expiry_date: string | null }>(
        `select expiry_date::text as expiry_date from wms.stock_movements where reference_id = $1 and movement_type = 'shipment'
           and product_id = $2 and lot_code = $3 limit 1`,
        [o.id, l.product_id, lot],
      );
      await tx.query(
        `insert into wms.customer_return_items (return_id, line_no, order_line_id, product_id, lot_code, expiry_date, quantity)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [r.id, lineNo++, l.id, l.product_id, lot, exp?.expiry_date ?? null, i.quantity],
      );
    }
    await audit(tx, ctx, "return.created", "customer_return", r.id, code, { order: o.code, reason: d.reason, items });
    return { id: r.id, code };
  });
}

const inspectSchema = z.object({
  approvedQty: z.union([z.literal("").transform(() => 0), nonNegQty("Quantidade apta")]).default(0),
  damagedQty: z.union([z.literal("").transform(() => 0), nonNegQty("Quantidade avariada")]).default(0),
  discardedQty: z.union([z.literal("").transform(() => 0), nonNegQty("Quantidade para descarte")]).default(0),
  notes: optionalText,
});

async function lockReturn(tx: Queryable, ctx: Ctx, id: string) {
  const [r] = await tx.query<{ id: string; code: string; status: string; warehouse_id: string; outbound_order_id: string }>(
    `select id, code, status, warehouse_id, outbound_order_id from wms.customer_returns where id = $1 and company_id = $2 for update`,
    [id, ctx.user.companyId],
  );
  if (!r) throw new NotFoundError("Devolução");
  return r;
}

async function quarantineLocation(tx: Queryable, warehouseId: string) {
  const [loc] = await tx.query<{ id: string; code: string }>(
    `select l.id, l.code from wms.locations l join wms.zones z on z.id = l.zone_id
     where l.warehouse_id = $1 and z.zone_type = 'quarantine' and z.active and l.status = 'active' order by l.code limit 1`,
    [warehouseId],
  );
  if (!loc) throw new DomainError("Cadastre um endereço ativo em zona de quarentena para receber devoluções avariadas ou para descarte.");
  return loc;
}

/** Inspeção de um item: as três destinações devem somar a quantidade devolvida. */
export async function inspectReturnItem(ctx: Ctx, itemId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "return.inspect");
  const d = parse(inspectSchema, input ?? {});
  return runOperation(ctx, "return.inspect", opts, async (tx) => {
    const [head] = await tx.query<{ return_id: string }>(
      `select i.return_id from wms.customer_return_items i join wms.customer_returns r on r.id = i.return_id where i.id = $1 and r.company_id = $2`,
      [itemId, ctx.user.companyId],
    );
    if (!head) throw new NotFoundError("Item da devolução");
    const ret = await lockReturn(tx, ctx, head.return_id);
    if (ret.status !== "pending") throw new DomainError(`A devolução ${ret.code} não está aguardando inspeção.`, "INVALID_STATUS");
    const [item] = await tx.query<{ id: string; product_id: string; sku: string; lot_code: string; expiry_date: string | null; quantity: number; inspected: boolean }>(
      `select i.id, i.product_id, p.sku, i.lot_code, i.expiry_date::text as expiry_date, i.quantity, i.inspected
       from wms.customer_return_items i join erp.products p on p.id = i.product_id where i.id = $1 for update of i`,
      [itemId],
    );
    if (item.inspected) throw new DomainError(`O item ${item.sku} já foi inspecionado.`, "INVALID_STATUS");
    const total = round3(d.approvedQty + d.damagedQty + d.discardedQty);
    if (total !== item.quantity) {
      throw new DomainError(`Apto + avariado + descarte (${total}) deve ser igual à quantidade devolvida (${item.quantity}).`, "VALIDATION");
    }
    const ref = { referenceType: "customer_return", referenceId: ret.id, referenceCode: ret.code };
    const base = { warehouseId: ret.warehouse_id, productId: item.product_id, lotCode: item.lot_code, expiryDate: item.expiry_date };
    const tasks: string[] = [];

    let hold: string | null = null;
    if (d.approvedQty > 0) {
      if (await getSetting(tx, ctx.user.companyId, "quality.required_for_output")) {
        // R1: devolução apta aguarda a qualidade com saldo bloqueado; armazenagem só após aprovar
        hold = (
          await createQualityHold(tx, ctx, {
            source: "customer_return",
            warehouseId: ret.warehouse_id,
            productionRequisitionId: null,
            customerReturnId: ret.id,
            referenceCode: ret.code,
            productId: item.product_id,
            lotCode: item.lot_code,
            expiryDate: item.expiry_date,
            quantity: d.approvedQty,
            fallbackLocationId: null,
          })
        ).code;
      } else {
        tasks.push(
          ...(await createPutawayTasks(tx, ctx, {
            ...base,
            quantity: d.approvedQty,
            fromLocationId: null,
            productionRequisitionId: null,
            customerReturnId: ret.id,
            note: `Devolução ${ret.code}`,
            ref: ret.code,
          })),
        );
      }
    }

    if (d.damagedQty > 0 || d.discardedQty > 0) {
      const qua = await quarantineLocation(tx, ret.warehouse_id);
      const inQty = round3(d.damagedQty + d.discardedQty);
      await validateDestination(tx, ctx, { locationId: qua.id, warehouseId: ret.warehouse_id, productId: item.product_id, quantity: inQty, anyZone: true });
      if (d.damagedQty > 0) {
        await addStock(tx, ctx, { ...base, locationId: qua.id, quantity: d.damagedQty, blocked: d.damagedQty });
        await insertMovement(tx, ctx, {
          ...base,
          ...ref,
          movementType: "return_in",
          quantity: d.damagedQty,
          toLocationId: qua.id,
          reason: `Devolução avariada — quarentena (bloqueado)${d.notes ? `: ${d.notes}` : ""}`,
        });
      }
      if (d.discardedQty > 0) {
        await addStock(tx, ctx, { ...base, locationId: qua.id, quantity: d.discardedQty });
        await insertMovement(tx, ctx, {
          ...base,
          ...ref,
          movementType: "return_in",
          quantity: d.discardedQty,
          toLocationId: qua.id,
          reason: "Devolução destinada a descarte",
        });
        const bal = await lockBalance(tx, ctx.user.companyId, qua.id, item.product_id, item.lot_code);
        await removeStock(tx, ctx, { balanceId: bal!.id, quantity: d.discardedQty, requireAvailable: true });
        await insertMovement(tx, ctx, {
          ...base,
          ...ref,
          movementType: "discard",
          quantity: d.discardedQty,
          fromLocationId: qua.id,
          reason: `Descarte de devolução${d.notes ? `: ${d.notes}` : ""}`,
        });
      }
    }

    await tx.query(
      `update wms.customer_return_items set approved_qty = $2, damaged_qty = $3, discarded_qty = $4, inspected = true,
              inspection_notes = $5, inspected_by = $6, inspected_at = now() where id = $1`,
      [item.id, d.approvedQty, d.damagedQty, d.discardedQty, d.notes, ctx.user.id],
    );
    await audit(tx, ctx, "return.item_inspected", "customer_return", ret.id, ret.code, { sku: item.sku, ...d, tasks, hold });

    const [left] = await tx.query<{ n: number }>(`select count(*) as n from wms.customer_return_items where return_id = $1 and not inspected`, [ret.id]);
    let completed = false;
    if (left.n === 0) {
      completed = true;
      await tx.query(`update wms.customer_returns set status = 'completed', completed_at = now() where id = $1`, [ret.id]);
      const items = await tx.query(
        `select p.sku, i.lot_code, i.quantity, i.approved_qty, i.damaged_qty, i.discarded_qty, l.line_no as order_line
         from wms.customer_return_items i join erp.products p on p.id = i.product_id join wms.outbound_order_lines l on l.id = i.order_line_id
         where i.return_id = $1 order by i.line_no`,
        [ret.id],
      );
      const [o] = await tx.query<{ code: string; so_number: string | null }>(
        `select o.code, so.number as so_number from wms.outbound_orders o left join erp.sales_orders so on so.id = o.sales_order_id where o.id = $1`,
        [ret.outbound_order_id],
      );
      await enqueueIntegrationEvent(tx, ctx, "customer_return.completed", "customer_return", ret.id, {
        code: ret.code,
        outboundOrder: o.code,
        salesOrder: o.so_number,
        items,
      });
      await audit(tx, ctx, "return.completed", "customer_return", ret.id, ret.code);
    }
    return { id: ret.id, tasks, completed };
  });
}

export async function cancelReturn(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx, "return.create");
  const d = parse(z.object({ reason: z.string().trim().min(5, "Informe o motivo do cancelamento.") }), input);
  return runOperation(ctx, "return.cancel", undefined, async (tx) => {
    const r = await lockReturn(tx, ctx, id);
    if (r.status !== "pending") throw new DomainError(`A devolução ${r.code} não pode ser cancelada.`, "INVALID_STATUS");
    const [ins] = await tx.query<{ n: number }>(`select count(*) as n from wms.customer_return_items where return_id = $1 and inspected`, [id]);
    if (ins.n > 0) throw new DomainError("Há itens já inspecionados: a devolução não pode mais ser cancelada.", "INVALID_STATUS");
    await tx.query(`update wms.customer_returns set status = 'cancelled' where id = $1`, [id]);
    await audit(tx, ctx, "return.cancelled", "customer_return", id, r.code, d);
    return { id };
  });
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export interface ReturnListRow {
  id: string;
  code: string;
  status: string;
  order_id: string;
  order_code: string;
  customer_name: string;
  reason: string;
  created_at: string;
  completed_at: string | null;
  quantity: number;
  approved: number;
  damaged: number;
  discarded: number;
  created_by_name: string;
  is_demo: boolean;
}

export async function listReturns(ctx: Ctx, f: { status?: string | null; q?: string | null } = {}) {
  return ctx.db.query<ReturnListRow>(
    `select r.id, r.code, r.status, o.id as order_id, o.code as order_code, r.customer_name, r.reason, r.created_at::text as created_at,
            r.completed_at::text as completed_at, u.name as created_by_name, r.is_demo,
            coalesce(sum(i.quantity), 0) as quantity, coalesce(sum(i.approved_qty), 0) as approved,
            coalesce(sum(i.damaged_qty), 0) as damaged, coalesce(sum(i.discarded_qty), 0) as discarded
     from wms.customer_returns r join wms.outbound_orders o on o.id = r.outbound_order_id join wms.users u on u.id = r.created_by
     left join wms.customer_return_items i on i.return_id = r.id
     where r.company_id = $1 and ($2::text is null or r.status = $2)
       and ($3::text is null or r.code ilike '%' || $3 || '%' or o.code ilike '%' || $3 || '%' or r.customer_name ilike '%' || $3 || '%')
     group by r.id, o.id, u.name order by r.created_at desc`,
    [ctx.user.companyId, f.status || null, f.q || null],
  );
}

export async function getReturn(ctx: Ctx, id: string) {
  const [r] = await ctx.db.query<{
    id: string;
    code: string;
    status: string;
    warehouse_code: string;
    order_id: string;
    order_code: string;
    customer_name: string;
    reason: string;
    reason_notes: string | null;
    created_at: string;
    completed_at: string | null;
    created_by_name: string;
    is_demo: boolean;
  }>(
    `select r.id, r.code, r.status, w.code as warehouse_code, o.id as order_id, o.code as order_code, r.customer_name, r.reason, r.reason_notes,
            r.created_at::text as created_at, r.completed_at::text as completed_at, u.name as created_by_name, r.is_demo
     from wms.customer_returns r join wms.outbound_orders o on o.id = r.outbound_order_id join wms.warehouses w on w.id = r.warehouse_id
     join wms.users u on u.id = r.created_by where r.id = $1 and r.company_id = $2`,
    [id, ctx.user.companyId],
  );
  if (!r) return null;
  const items = await ctx.db.query<{
    id: string;
    line_no: number;
    sku: string;
    description: string;
    uom: string;
    lot_code: string;
    expiry_date: string | null;
    quantity: number;
    approved_qty: number;
    damaged_qty: number;
    discarded_qty: number;
    inspected: boolean;
    inspection_notes: string | null;
    inspected_by_name: string | null;
    inspected_at: string | null;
  }>(
    `select i.id, i.line_no, p.sku, p.description, p.uom, i.lot_code, i.expiry_date::text as expiry_date, i.quantity, i.approved_qty,
            i.damaged_qty, i.discarded_qty, i.inspected, i.inspection_notes, u.name as inspected_by_name, i.inspected_at::text as inspected_at
     from wms.customer_return_items i join erp.products p on p.id = i.product_id left join wms.users u on u.id = i.inspected_by
     where i.return_id = $1 order by i.line_no`,
    [id],
  );
  const tasks = await ctx.db.query<{ id: string; code: string; status: string; quantity: number; sku: string }>(
    `select t.id, t.code, t.status, t.quantity, p.sku from wms.tasks t join erp.products p on p.id = t.product_id
     where t.customer_return_id = $1 order by t.code`,
    [id],
  );
  return { ...r, items, tasks };
}

/** Pedidos expedidos com saldo devolvível (para abrir uma devolução). */
export async function listReturnableOrders(ctx: Ctx) {
  return ctx.db.query<{ id: string; code: string; customer_name: string; shipped_at: string | null; shipped: number; returned: number }>(
    `select o.id, o.code, o.customer_name, o.shipped_at::text as shipped_at,
            coalesce((select sum(shipped_qty) from wms.outbound_order_lines l where l.order_id = o.id), 0) as shipped,
            coalesce((select sum(ri.quantity) from wms.customer_return_items ri join wms.customer_returns r on r.id = ri.return_id
                      where r.outbound_order_id = o.id and r.status <> 'cancelled'), 0) as returned
     from wms.outbound_orders o where o.company_id = $1 and o.status = 'shipped' order by o.shipped_at desc`,
    [ctx.user.companyId],
  );
}

