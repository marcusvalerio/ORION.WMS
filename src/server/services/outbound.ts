import "server-only";
import { z } from "zod";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError, NotFoundError } from "../errors";
import { parse, uuid, optionalText, qty, nonNegQty } from "../validation";
import * as erp from "../integrations/erp/gateway";
import { audit, enqueueIntegrationEvent, nextCode, recordTaskEvent, round3, runOperation, type OpOptions } from "./common";
import { availableOf, changeReserved, insertMovement, lockBalanceById, removeStock, type BalanceRow } from "./stock-core";

export const OUTBOUND_STATUSES = ["open", "reserved", "picking", "picked", "checked", "shipped", "cancelled"] as const;
export type OutboundStatus = (typeof OUTBOUND_STATUSES)[number];

interface OrderHeader {
  id: string;
  code: string;
  status: OutboundStatus;
  warehouse_id: string;
  sales_order_id: string | null;
  priority: number;
  staging_location_id: string | null;
}

async function lockOrder(tx: Queryable, ctx: Ctx, id: string): Promise<OrderHeader> {
  const [o] = await tx.query<OrderHeader>(
    `select id, code, status, warehouse_id, sales_order_id, priority, staging_location_id
     from wms.outbound_orders where id = $1 and company_id = $2 for update`,
    [id, ctx.user.companyId],
  );
  if (!o) throw new NotFoundError("Pedido de saída");
  return o;
}

function requireStatus(o: OrderHeader, allowed: OutboundStatus[], action: string) {
  if (!allowed.includes(o.status)) {
    throw new DomainError(`Não é possível ${action}: o pedido ${o.code} está com status "${o.status}".`, "INVALID_STATUS");
  }
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export interface OrderListRow {
  id: string;
  code: string;
  status: OutboundStatus;
  customer_name: string;
  source: string;
  so_number: string | null;
  warehouse_code: string;
  priority: number;
  requested: number;
  reserved: number;
  picked: number;
  shipped: number;
  open_tasks: number;
  created_at: string;
  shipped_at: string | null;
  is_demo: boolean;
}

export async function listOrders(ctx: Ctx, f: { status?: string | null; q?: string | null } = {}) {
  const statuses = f.status ? f.status.split(",") : null;
  return ctx.db.query<OrderListRow>(
    `select o.id, o.code, o.status, o.customer_name, o.source, so.number as so_number, w.code as warehouse_code, o.priority,
            o.created_at::text as created_at, o.shipped_at::text as shipped_at, o.is_demo,
            coalesce(sum(l.requested_qty), 0) as requested, coalesce(sum(l.reserved_qty), 0) as reserved,
            coalesce(sum(l.picked_qty), 0) as picked, coalesce(sum(l.shipped_qty), 0) as shipped,
            (select count(*) from wms.tasks t where t.order_id = o.id and t.status in ('pending', 'in_progress')) as open_tasks
     from wms.outbound_orders o
     join wms.warehouses w on w.id = o.warehouse_id
     left join erp.sales_orders so on so.id = o.sales_order_id
     left join wms.outbound_order_lines l on l.order_id = o.id
     where o.company_id = $1 and ($2::text[] is null or o.status = any($2::text[]))
       and ($3::text is null or o.code ilike '%' || $3 || '%' or o.customer_name ilike '%' || $3 || '%' or so.number ilike '%' || $3 || '%')
     group by o.id, w.code, so.number
     order by o.priority, o.created_at desc`,
    [ctx.user.companyId, statuses, f.q || null],
  );
}

export async function getOrder(ctx: Ctx, id: string) {
  const [o] = await ctx.db.query<{
    id: string;
    code: string;
    status: OutboundStatus;
    customer_name: string;
    source: string;
    sales_order_id: string | null;
    so_number: string | null;
    warehouse_id: string;
    warehouse_code: string;
    warehouse_name: string;
    priority: number;
    staging_code: string | null;
    notes: string | null;
    created_by_name: string;
    created_at: string;
    reserved_at: string | null;
    picked_at: string | null;
    checked_at: string | null;
    shipped_at: string | null;
    is_demo: boolean;
  }>(
    `select o.id, o.code, o.status, o.customer_name, o.source, o.sales_order_id, so.number as so_number, o.warehouse_id,
            w.code as warehouse_code, w.name as warehouse_name, o.priority, sl.code as staging_code, o.notes,
            u.name as created_by_name, o.created_at::text as created_at, o.reserved_at::text as reserved_at,
            o.picked_at::text as picked_at, o.checked_at::text as checked_at, o.shipped_at::text as shipped_at, o.is_demo
     from wms.outbound_orders o join wms.warehouses w on w.id = o.warehouse_id join wms.users u on u.id = o.created_by
     left join erp.sales_orders so on so.id = o.sales_order_id left join wms.locations sl on sl.id = o.staging_location_id
     where o.id = $1 and o.company_id = $2`,
    [id, ctx.user.companyId],
  );
  if (!o) return null;
  const lines = await ctx.db.query<{
    id: string;
    line_no: number;
    product_id: string;
    sku: string;
    description: string;
    uom: string;
    requested_qty: number;
    reserved_qty: number;
    picked_qty: number;
    checked_qty: number;
    shipped_qty: number;
    available_now: number;
  }>(
    `select l.id, l.line_no, l.product_id, p.sku, p.description, p.uom, l.requested_qty, l.reserved_qty, l.picked_qty,
            l.checked_qty, l.shipped_qty,
            coalesce((select sum(b.quantity - b.reserved_qty - b.blocked_qty) from wms.stock_balances b
                      join wms.locations bl on bl.id = b.location_id join wms.zones z on z.id = bl.zone_id
                      where b.product_id = l.product_id and b.warehouse_id = $2 and bl.status = 'active' and z.active
                        and z.zone_type in ('storage', 'picking') and (b.expiry_date is null or b.expiry_date >= current_date)), 0) as available_now
     from wms.outbound_order_lines l join erp.products p on p.id = l.product_id
     where l.order_id = $1 order by l.line_no`,
    [id, o.warehouse_id],
  );
  const reservations = await ctx.db.query<{
    id: string;
    sku: string;
    location_code: string;
    lot_code: string;
    quantity: number;
    picked_qty: number;
    status: string;
  }>(
    `select r.id, p.sku, l.code as location_code, r.lot_code, r.quantity, r.picked_qty, r.status
     from wms.stock_reservations r join wms.outbound_order_lines ol on ol.id = r.order_line_id
     join erp.products p on p.id = r.product_id join wms.locations l on l.id = r.location_id
     where ol.order_id = $1 order by r.created_at`,
    [id],
  );
  const [shipment] = await ctx.db.query<{
    code: string;
    carrier: string | null;
    vehicle_plate: string | null;
    document_ref: string | null;
    shipped_at: string;
    shipped_by_name: string;
  }>(
    `select s.code, s.carrier, s.vehicle_plate, s.document_ref, s.shipped_at::text as shipped_at, u.name as shipped_by_name
     from wms.shipments s join wms.users u on u.id = s.shipped_by where s.order_id = $1`,
    [id],
  );
  return { ...o, lines, reservations, shipment: shipment ?? null };
}

// -----------------------------------------------------------------------------
// Criação / importação
// -----------------------------------------------------------------------------

const importSchema = z.object({
  salesOrderId: uuid("Pedido de venda"),
  warehouseId: uuid("Depósito"),
  priority: z.coerce.number().int().min(1).max(3).default(2),
});

export async function importSalesOrder(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "outbound.create");
  const d = parse(importSchema, input);
  return runOperation(ctx, "outbound.import", opts, async (tx) => {
    const [so] = (await erp.listSalesOrders(tx, ctx.user.companyId)).filter((s) => s.id === d.salesOrderId);
    if (!so) throw new NotFoundError("Pedido de venda");
    if (so.outbound_code) throw new DomainError(`O pedido ${so.number} já foi importado como ${so.outbound_code}.`, "DUPLICATE");
    if (so.status !== "open") throw new DomainError(`O pedido ${so.number} não está aberto no ERP.`);
    const items = await erp.getSalesOrderItems(tx, so.id);
    if (!items.length) throw new DomainError("O pedido de venda não possui itens.");
    return insertOrder(tx, ctx, {
      warehouseId: d.warehouseId,
      salesOrderId: so.id,
      source: "erp",
      customerName: so.customer_name,
      priority: d.priority,
      notes: `Importado do pedido de venda ${so.number}`,
      lines: items.map((i) => ({ productId: i.product_id, quantity: i.quantity })),
    });
  });
}

const manualSchema = z.object({
  warehouseId: uuid("Depósito"),
  customerName: z.string().trim().min(3, "Informe o cliente/destinatário.").max(160),
  priority: z.coerce.number().int().min(1).max(3).default(2),
  notes: optionalText,
  lines: z.array(z.object({ productId: uuid("Produto"), quantity: qty() })).min(1, "Informe ao menos um item."),
});

export async function createManualOrder(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "outbound.create");
  const d = parse(manualSchema, input);
  return runOperation(ctx, "outbound.create", opts, async (tx) =>
    insertOrder(tx, ctx, { ...d, salesOrderId: null, source: "manual", lines: d.lines }),
  );
}

async function insertOrder(
  tx: Queryable,
  ctx: Ctx,
  d: {
    warehouseId: string;
    salesOrderId: string | null;
    source: "erp" | "manual";
    customerName: string;
    priority: number;
    notes: string | null;
    lines: { productId: string; quantity: number }[];
  },
) {
  const [wh] = await tx.query<{ active: boolean }>(`select active from wms.warehouses where id = $1 and company_id = $2`, [
    d.warehouseId,
    ctx.user.companyId,
  ]);
  if (!wh) throw new NotFoundError("Depósito");
  if (!wh.active) throw new DomainError("Depósito inativo.");
  const [company] = await tx.query<{ is_demo: boolean }>(`select is_demo from erp.companies where id = $1`, [ctx.user.companyId]);
  const code = await nextCode(tx, ctx.user.companyId, "PS");
  const [o] = await tx.query<{ id: string }>(
    `insert into wms.outbound_orders (company_id, warehouse_id, code, sales_order_id, source, customer_name, priority, notes,
                                      is_demo, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [
      ctx.user.companyId,
      d.warehouseId,
      code,
      d.salesOrderId,
      d.source,
      d.customerName,
      d.priority,
      d.notes,
      company?.is_demo ?? false,
      ctx.user.id,
    ],
  );
  let lineNo = 1;
  for (const line of d.lines) {
    const [p] = await tx.query<{ status: string }>(`select status from erp.products where id = $1 and company_id = $2`, [
      line.productId,
      ctx.user.companyId,
    ]);
    if (!p) throw new NotFoundError("Produto");
    if (p.status !== "active") throw new DomainError("Produto inativo não pode ser incluído em pedido de saída.");
    await tx.query(`insert into wms.outbound_order_lines (order_id, line_no, product_id, requested_qty) values ($1,$2,$3,$4)`, [
      o.id,
      lineNo++,
      line.productId,
      line.quantity,
    ]);
  }
  await audit(tx, ctx, "outbound.created", "outbound_order", o.id, code, { source: d.source, lines: d.lines });
  return { id: o.id, code };
}

// -----------------------------------------------------------------------------
// Reserva (tudo ou nada, FEFO)
// -----------------------------------------------------------------------------

/**
 * Reserva o estoque elegível para todas as linhas. Regras:
 *  - somente saldos disponíveis (físico − reservado − bloqueado) em endereços
 *    ativos de zonas de armazenagem/picking, não vencidos;
 *  - ordem FEFO (validade mais próxima primeiro), depois menor saldo;
 *  - tudo ou nada: se alguma linha não puder ser atendida, nada é reservado.
 * Não há baixa física na reserva.
 */
export async function reserveOrder(ctx: Ctx, orderId: string, opts?: OpOptions) {
  assertCan(ctx, "outbound.reserve");
  return runOperation(ctx, "outbound.reserve", opts, async (tx) => {
    const o = await lockOrder(tx, ctx, orderId);
    requireStatus(o, ["open"], "reservar");
    const lines = await tx.query<{ id: string; line_no: number; product_id: string; sku: string; requested_qty: number }>(
      `select l.id, l.line_no, l.product_id, p.sku, l.requested_qty from wms.outbound_order_lines l
       join erp.products p on p.id = l.product_id where l.order_id = $1 order by l.line_no for update of l`,
      [orderId],
    );
    const shortages: string[] = [];
    let reservations = 0;
    for (const line of lines) {
      const balances = await tx.query<BalanceRow>(
        `select b.id, b.warehouse_id, b.location_id, b.product_id, b.lot_code, b.expiry_date::text as expiry_date,
                b.quantity, b.reserved_qty, b.blocked_qty
         from wms.stock_balances b join wms.locations l on l.id = b.location_id join wms.zones z on z.id = l.zone_id
         where b.company_id = $1 and b.warehouse_id = $2 and b.product_id = $3
           and l.status = 'active' and z.active and z.zone_type in ('storage', 'picking')
           and (b.expiry_date is null or b.expiry_date >= current_date)
           and b.quantity - b.reserved_qty - b.blocked_qty > 0
         order by b.expiry_date asc nulls last, b.quantity asc, l.code
         for update of b`,
        [ctx.user.companyId, o.warehouse_id, line.product_id],
      );
      let remaining = line.requested_qty;
      for (const b of balances) {
        if (remaining <= 0) break;
        const take = round3(Math.min(availableOf(b), remaining));
        if (take <= 0) continue;
        await changeReserved(tx, b.id, take);
        await tx.query(
          `insert into wms.stock_reservations (company_id, order_line_id, balance_id, location_id, product_id, lot_code, quantity, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [ctx.user.companyId, line.id, b.id, b.location_id, line.product_id, b.lot_code, take, ctx.user.id],
        );
        reservations++;
        remaining = round3(remaining - take);
      }
      if (remaining > 0) {
        const available = round3(line.requested_qty - remaining);
        shortages.push(`${line.sku}: solicitado ${line.requested_qty}, disponível ${available}`);
      } else {
        await tx.query(`update wms.outbound_order_lines set reserved_qty = requested_qty where id = $1`, [line.id]);
      }
    }
    if (shortages.length) {
      // Lança erro: a transação inteira é desfeita (nenhuma reserva parcial permanece).
      throw new DomainError(`Estoque disponível insuficiente para reservar o pedido ${o.code} — ${shortages.join("; ")}.`, "INSUFFICIENT_STOCK");
    }
    await tx.query(
      `update wms.outbound_orders set status = 'reserved', reserved_at = now(), updated_at = now(), version = version + 1 where id = $1`,
      [orderId],
    );
    if (o.sales_order_id) await erp.setSalesOrderStatus(tx, o.sales_order_id, "in_fulfillment");
    await audit(tx, ctx, "outbound.reserved", "outbound_order", orderId, o.code, { reservations });
    return { id: orderId, reservations };
  });
}

/** Gera as tarefas de separação (uma por reserva) com endereço de origem e doca de destino. */
export async function releaseForPicking(ctx: Ctx, orderId: string, opts?: OpOptions) {
  assertCan(ctx, "outbound.reserve");
  return runOperation(ctx, "outbound.release_picking", opts, async (tx) => {
    const o = await lockOrder(tx, ctx, orderId);
    requireStatus(o, ["reserved"], "liberar para separação");
    const [staging] = await tx.query<{ id: string; code: string }>(
      `select l.id, l.code from wms.locations l join wms.zones z on z.id = l.zone_id
       where l.warehouse_id = $1 and z.zone_type = 'shipping' and z.active and l.status = 'active'
       order by l.code limit 1`,
      [o.warehouse_id],
    );
    if (!staging) {
      throw new DomainError("Cadastre um endereço ativo em uma zona de expedição (doca) para receber os itens separados.");
    }
    const reservations = await tx.query<{
      id: string;
      order_line_id: string;
      location_id: string;
      product_id: string;
      lot_code: string;
      quantity: number;
      expiry_date: string | null;
    }>(
      `select r.id, r.order_line_id, r.location_id, r.product_id, r.lot_code, r.quantity, b.expiry_date::text as expiry_date
       from wms.stock_reservations r join wms.outbound_order_lines l on l.id = r.order_line_id
       join wms.stock_balances b on b.id = r.balance_id join wms.locations loc on loc.id = r.location_id
       where l.order_id = $1 and r.status = 'active' order by loc.code`,
      [orderId],
    );
    const tasks: string[] = [];
    for (const r of reservations) {
      const code = await nextCode(tx, ctx.user.companyId, "TAR");
      const [t] = await tx.query<{ id: string }>(
        `insert into wms.tasks (company_id, warehouse_id, code, task_type, priority, product_id, lot_code, expiry_date, quantity,
                                from_location_id, to_location_id, order_id, order_line_id, reservation_id, created_by)
         values ($1,$2,$3,'picking',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
        [
          ctx.user.companyId,
          o.warehouse_id,
          code,
          o.priority,
          r.product_id,
          r.lot_code,
          r.expiry_date,
          r.quantity,
          r.location_id,
          staging.id,
          orderId,
          r.order_line_id,
          r.id,
          ctx.user.id,
        ],
      );
      await recordTaskEvent(tx, t.id, ctx.user.id, "created", null, "pending", { order: o.code });
      tasks.push(code);
    }
    await tx.query(
      `update wms.outbound_orders set status = 'picking', staging_location_id = $2, updated_at = now(), version = version + 1 where id = $1`,
      [orderId, staging.id],
    );
    await audit(tx, ctx, "outbound.picking_released", "outbound_order", orderId, o.code, { tasks, staging: staging.code });
    return { id: orderId, tasks };
  });
}

// -----------------------------------------------------------------------------
// Conferência final e expedição
// -----------------------------------------------------------------------------

const checkSchema = z.object({
  lines: z.array(z.object({ lineId: uuid("Linha"), checkedQty: nonNegQty("Quantidade conferida") })).min(1),
  notes: optionalText,
});

/**
 * Conferência de saída: a quantidade conferida deve ser igual à separada.
 * Diferenças são registradas como divergência e o pedido não avança.
 */
export async function checkOrder(ctx: Ctx, orderId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "outbound.check");
  const d = parse(checkSchema, input);
  return runOperation(ctx, "outbound.check", opts, async (tx) => {
    const o = await lockOrder(tx, ctx, orderId);
    requireStatus(o, ["picked"], "conferir");
    const lines = await tx.query<{ id: string; product_id: string; sku: string; picked_qty: number }>(
      `select l.id, l.product_id, p.sku, l.picked_qty from wms.outbound_order_lines l join erp.products p on p.id = l.product_id
       where l.order_id = $1 for update of l`,
      [orderId],
    );
    const byId = new Map(d.lines.map((l) => [l.lineId, l.checkedQty]));
    const mismatches: string[] = [];
    for (const line of lines) {
      const checked = byId.get(line.id);
      if (checked === undefined) throw new DomainError(`Informe a quantidade conferida de ${line.sku}.`, "VALIDATION");
      if (checked !== line.picked_qty) {
        mismatches.push(`${line.sku}: separado ${line.picked_qty}, conferido ${checked}`);
        await tx.query(
          `insert into wms.divergences (company_id, source, divergence_type, product_id, quantity, description, order_id,
                                        order_line_id, created_by)
           values ($1, 'outbound_check', $2, $3, $4, $5, $6, $7, $8)`,
          [
            ctx.user.companyId,
            checked < line.picked_qty ? "shortage" : "overage",
            line.product_id,
            Math.abs(round3(checked - line.picked_qty)),
            `Conferência de saída de ${o.code}: separado ${line.picked_qty}, conferido ${checked}.${d.notes ? ` Obs.: ${d.notes}` : ""}`,
            orderId,
            line.id,
            ctx.user.id,
          ],
        );
      }
    }
    if (mismatches.length) {
      await audit(tx, ctx, "outbound.check_divergent", "outbound_order", orderId, o.code, { mismatches });
      return { id: orderId, ok: false as const, mismatches };
    }
    for (const line of lines) {
      await tx.query(`update wms.outbound_order_lines set checked_qty = picked_qty where id = $1`, [line.id]);
    }
    await tx.query(
      `update wms.outbound_orders set status = 'checked', checked_at = now(), updated_at = now(), version = version + 1 where id = $1`,
      [orderId],
    );
    await audit(tx, ctx, "outbound.checked", "outbound_order", orderId, o.code);
    return { id: orderId, ok: true as const, mismatches: [] };
  });
}

const shipSchema = z.object({
  carrier: optionalText,
  vehiclePlate: z
    .string()
    .trim()
    .max(10)
    .nullish()
    .transform((v) => (v ? v.toUpperCase() : null)),
  documentRef: optionalText,
  notes: optionalText,
});

/**
 * Confirma a expedição: baixa física na doca, consome as reservas, registra a
 * movimentação de saída, atualiza o ERP e enfileira o evento de integração.
 * Nunca expede mais do que o conferido (que por sua vez ≤ separado ≤ solicitado).
 */
export async function shipOrder(ctx: Ctx, orderId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "outbound.ship");
  const d = parse(shipSchema, input ?? {});
  return runOperation(ctx, "outbound.ship", opts, async (tx) => {
    const o = await lockOrder(tx, ctx, orderId);
    requireStatus(o, ["checked"], "expedir");
    const reservations = await tx.query<{
      id: string;
      order_line_id: string;
      product_id: string;
      lot_code: string;
      picked_qty: number;
    }>(
      `select r.id, r.order_line_id, r.product_id, r.lot_code, r.picked_qty
       from wms.stock_reservations r join wms.outbound_order_lines l on l.id = r.order_line_id
       where l.order_id = $1 and r.status = 'picked' and r.picked_qty > 0 for update of r`,
      [orderId],
    );
    const shipmentCode = await nextCode(tx, ctx.user.companyId, "EXP");
    const shippedByLine = new Map<string, number>();
    for (const r of reservations) {
      const [staging] = await tx.query<{ id: string }>(
        `select id from wms.stock_balances where location_id = $1 and product_id = $2 and lot_code = $3`,
        [o.staging_location_id, r.product_id, r.lot_code],
      );
      if (!staging) throw new DomainError("Saldo separado não encontrado na doca de expedição.", "STAGING_MISMATCH");
      const balance = await lockBalanceById(tx, ctx.user.companyId, staging.id);
      if (balance.reserved_qty < r.picked_qty || balance.quantity < r.picked_qty) {
        throw new DomainError("Saldo na doca menor que o separado para o pedido. Verifique as movimentações.", "STAGING_MISMATCH");
      }
      await removeStock(tx, ctx, { balanceId: staging.id, quantity: r.picked_qty, consumeReserved: r.picked_qty });
      await insertMovement(tx, ctx, {
        warehouseId: o.warehouse_id,
        movementType: "shipment",
        productId: r.product_id,
        lotCode: r.lot_code,
        expiryDate: balance.expiry_date,
        quantity: r.picked_qty,
        fromLocationId: o.staging_location_id,
        reason: "Expedição de pedido",
        referenceType: "outbound_order",
        referenceId: orderId,
        referenceCode: o.code,
      });
      await tx.query(`update wms.stock_reservations set status = 'consumed', closed_at = now() where id = $1`, [r.id]);
      shippedByLine.set(r.order_line_id, round3((shippedByLine.get(r.order_line_id) ?? 0) + r.picked_qty));
    }
    let total = 0;
    for (const [lineId, shipped] of shippedByLine) {
      // A restrição shipped_qty <= checked_qty garante que nada além do conferido seja expedido.
      await tx.query(`update wms.outbound_order_lines set shipped_qty = $2 where id = $1`, [lineId, shipped]);
      total += shipped;
    }
    if (total <= 0) throw new DomainError("Não há quantidade conferida para expedir.");
    await tx.query(
      `insert into wms.shipments (company_id, order_id, code, carrier, vehicle_plate, document_ref, notes, shipped_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ctx.user.companyId, orderId, shipmentCode, d.carrier, d.vehiclePlate, d.documentRef, d.notes, ctx.user.id],
    );
    await tx.query(
      `update wms.outbound_orders set status = 'shipped', shipped_at = now(), updated_at = now(), version = version + 1 where id = $1`,
      [orderId],
    );
    if (o.sales_order_id) await erp.setSalesOrderStatus(tx, o.sales_order_id, "shipped");
    const lines = await tx.query(
      `select p.sku, l.requested_qty, l.shipped_qty from wms.outbound_order_lines l join erp.products p on p.id = l.product_id
       where l.order_id = $1 order by l.line_no`,
      [orderId],
    );
    await enqueueIntegrationEvent(tx, ctx, "outbound.shipped", "outbound_order", orderId, {
      code: o.code,
      shipment: shipmentCode,
      lines,
    });
    await audit(tx, ctx, "outbound.shipped", "outbound_order", orderId, o.code, { shipment: shipmentCode, total, ...d });
    return { id: orderId, shipment: shipmentCode, total };
  });
}

/** Cancelamento permitido antes do início da separação; libera as reservas. */
export async function cancelOrder(ctx: Ctx, orderId: string, input: unknown) {
  assertCan(ctx, "outbound.reserve");
  const d = parse(z.object({ reason: z.string().trim().min(5, "Informe o motivo do cancelamento.") }), input);
  return runOperation(ctx, "outbound.cancel", undefined, async (tx) => {
    const o = await lockOrder(tx, ctx, orderId);
    requireStatus(o, ["open", "reserved"], "cancelar");
    const reservations = await tx.query<{ id: string; balance_id: string; quantity: number }>(
      `select r.id, r.balance_id, r.quantity from wms.stock_reservations r join wms.outbound_order_lines l on l.id = r.order_line_id
       where l.order_id = $1 and r.status = 'active' for update of r`,
      [orderId],
    );
    for (const r of reservations) {
      await lockBalanceById(tx, ctx.user.companyId, r.balance_id);
      await changeReserved(tx, r.balance_id, -r.quantity);
      await tx.query(`update wms.stock_reservations set status = 'released', closed_at = now() where id = $1`, [r.id]);
    }
    await tx.query(`update wms.outbound_order_lines set reserved_qty = 0 where order_id = $1`, [orderId]);
    await tx.query(`update wms.outbound_orders set status = 'cancelled', updated_at = now(), version = version + 1 where id = $1`, [orderId]);
    if (o.sales_order_id) await erp.setSalesOrderStatus(tx, o.sales_order_id, "open");
    await audit(tx, ctx, "outbound.cancelled", "outbound_order", orderId, o.code, d);
    return { id: orderId };
  });
}

export async function listShipments(ctx: Ctx) {
  return ctx.db.query<{
    id: string;
    code: string;
    order_id: string;
    order_code: string;
    customer_name: string;
    carrier: string | null;
    vehicle_plate: string | null;
    document_ref: string | null;
    shipped_at: string;
    shipped_by_name: string;
    total: number;
  }>(
    `select s.id, s.code, s.order_id, o.code as order_code, o.customer_name, s.carrier, s.vehicle_plate, s.document_ref,
            s.shipped_at::text as shipped_at, u.name as shipped_by_name,
            coalesce((select sum(shipped_qty) from wms.outbound_order_lines l where l.order_id = o.id), 0) as total
     from wms.shipments s join wms.outbound_orders o on o.id = s.order_id join wms.users u on u.id = s.shipped_by
     where s.company_id = $1 order by s.shipped_at desc`,
    [ctx.user.companyId],
  );
}
