import "server-only";
import { z } from "zod";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError, NotFoundError } from "../errors";
import { parse, uuid, optionalDate, qty } from "../validation";
import { audit, runOperation, type OpOptions } from "./common";
import { addStock, availableOf, insertMovement, lockBalance, lockBalanceById, removeStock, validateDestination } from "./stock-core";

export interface BalanceListRow {
  id: string;
  warehouse_id: string;
  warehouse_code: string;
  location_id: string;
  location_code: string;
  zone_type: string;
  location_status: string;
  product_id: string;
  sku: string;
  description: string;
  uom: string;
  lot_code: string;
  expiry_date: string | null;
  quantity: number;
  reserved_qty: number;
  blocked_qty: number;
  available_qty: number;
  updated_at: string;
}

export interface StockFilters {
  productId?: string | null;
  warehouseId?: string | null;
  locationId?: string | null;
  q?: string | null;
  lot?: string | null;
  expiryBefore?: string | null;
  status?: "available" | "reserved" | "blocked" | "expired" | null;
  includeZero?: boolean;
  sort?: string | null;
  page?: number;
  pageSize?: number;
}

const STOCK_SORTS: Record<string, string> = {
  location: "l.code, p.sku",
  product: "p.sku, l.code",
  expiry: "b.expiry_date asc nulls last, p.sku",
  "-quantity": "b.quantity desc",
  "-available": "(b.quantity - b.reserved_qty - b.blocked_qty) desc",
};

function stockWhere(ctx: Ctx, f: StockFilters) {
  const params: unknown[] = [ctx.user.companyId];
  const where = ["b.company_id = $1"];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replaceAll("?", `$${params.length}`));
  };
  if (!f.includeZero) where.push("b.quantity > 0");
  if (f.productId) add("b.product_id = ?::uuid", f.productId);
  if (f.warehouseId) add("b.warehouse_id = ?::uuid", f.warehouseId);
  if (f.locationId) add("b.location_id = ?::uuid", f.locationId);
  if (f.q) add("(p.sku ilike '%' || ? || '%' or p.description ilike '%' || ? || '%' or l.code ilike '%' || ? || '%')", f.q);
  if (f.lot) add("b.lot_code ilike '%' || ? || '%'", f.lot);
  if (f.expiryBefore) add("b.expiry_date <= ?::date", f.expiryBefore);
  if (f.status === "available") where.push("b.quantity - b.reserved_qty - b.blocked_qty > 0");
  if (f.status === "reserved") where.push("b.reserved_qty > 0");
  if (f.status === "blocked") where.push("(b.blocked_qty > 0 or l.status = 'blocked')");
  if (f.status === "expired") where.push("b.expiry_date < current_date");
  return { params, where: where.join(" and ") };
}

const STOCK_FROM = `from wms.stock_balances b
  join wms.locations l on l.id = b.location_id
  join wms.zones z on z.id = l.zone_id
  join wms.warehouses w on w.id = b.warehouse_id
  join erp.products p on p.id = b.product_id`;

export async function listStock(ctx: Ctx, f: StockFilters = {}) {
  const pageSize = f.pageSize ?? 50;
  const page = Math.max(1, f.page ?? 1);
  const { params, where } = stockWhere(ctx, f);
  const [totals] = await ctx.db.query<{ total: number; quantity: number; reserved: number; blocked: number; available: number }>(
    `select count(*) as total, coalesce(sum(b.quantity), 0) as quantity, coalesce(sum(b.reserved_qty), 0) as reserved,
            coalesce(sum(b.blocked_qty), 0) as blocked, coalesce(sum(b.quantity - b.reserved_qty - b.blocked_qty), 0) as available
     ${STOCK_FROM} where ${where}`,
    params,
  );
  const rows = await ctx.db.query<BalanceListRow>(
    `select b.id, b.warehouse_id, w.code as warehouse_code, b.location_id, l.code as location_code, z.zone_type,
            l.status as location_status, b.product_id, p.sku, p.description, p.uom, b.lot_code, b.expiry_date::text as expiry_date,
            b.quantity, b.reserved_qty, b.blocked_qty, (b.quantity - b.reserved_qty - b.blocked_qty) as available_qty,
            b.updated_at::text as updated_at
     ${STOCK_FROM} where ${where}
     order by ${STOCK_SORTS[f.sort ?? "location"] ?? STOCK_SORTS.location}
     ${pageSize > 0 ? `limit ${pageSize} offset ${(page - 1) * pageSize}` : ""}`,
    params,
  );
  return { rows, totals, page, pageSize };
}

export async function getBalance(ctx: Ctx, id: string) {
  const [row] = await ctx.db.query<BalanceListRow>(
    `select b.id, b.warehouse_id, w.code as warehouse_code, b.location_id, l.code as location_code, z.zone_type,
            l.status as location_status, b.product_id, p.sku, p.description, p.uom, b.lot_code, b.expiry_date::text as expiry_date,
            b.quantity, b.reserved_qty, b.blocked_qty, (b.quantity - b.reserved_qty - b.blocked_qty) as available_qty,
            b.updated_at::text as updated_at
     ${STOCK_FROM} where b.id = $1 and b.company_id = $2`,
    [id, ctx.user.companyId],
  );
  return row ?? null;
}

/** Saldo consolidado por produto. */
export async function stockByProduct(ctx: Ctx, productId: string) {
  const [row] = await ctx.db.query<{ quantity: number; reserved: number; blocked: number; available: number }>(
    `select coalesce(sum(quantity), 0) as quantity, coalesce(sum(reserved_qty), 0) as reserved,
            coalesce(sum(blocked_qty), 0) as blocked, coalesce(sum(quantity - reserved_qty - blocked_qty), 0) as available
     from wms.stock_balances where company_id = $1 and product_id = $2`,
    [ctx.user.companyId, productId],
  );
  return row;
}

// -----------------------------------------------------------------------------
// Movimentações (consulta)
// -----------------------------------------------------------------------------

export interface MovementRow {
  id: string;
  created_at: string;
  movement_type: string;
  sku: string;
  description: string;
  product_id: string;
  lot_code: string;
  quantity: number;
  from_code: string | null;
  to_code: string | null;
  reason: string | null;
  reference_type: string | null;
  reference_id: string | null;
  reference_code: string | null;
  task_id: string | null;
  task_code: string | null;
  user_name: string;
  warehouse_code: string;
}

export interface MovementFilters {
  productId?: string | null;
  locationId?: string | null;
  type?: string | null;
  from?: string | null;
  to?: string | null;
  q?: string | null;
  page?: number;
  pageSize?: number;
}

export async function listMovements(ctx: Ctx, f: MovementFilters = {}) {
  const pageSize = f.pageSize ?? 50;
  const page = Math.max(1, f.page ?? 1);
  const params = [
    ctx.user.companyId,
    f.productId || null,
    f.locationId || null,
    f.type || null,
    f.from || null,
    f.to || null,
    f.q || null,
  ];
  const where = `where m.company_id = $1 and ($2::uuid is null or m.product_id = $2::uuid)
    and ($3::uuid is null or m.from_location_id = $3::uuid or m.to_location_id = $3::uuid)
    and ($4::text is null or m.movement_type = $4) and ($5::date is null or m.created_at >= $5::date)
    and ($6::date is null or m.created_at < ($6::date + 1))
    and ($7::text is null or p.sku ilike '%' || $7 || '%' or p.description ilike '%' || $7 || '%'
         or m.reference_code ilike '%' || $7 || '%' or m.lot_code ilike '%' || $7 || '%')`;
  const from = `from wms.stock_movements m join erp.products p on p.id = m.product_id
    join wms.users u on u.id = m.created_by join wms.warehouses w on w.id = m.warehouse_id
    left join wms.locations lf on lf.id = m.from_location_id left join wms.locations lt on lt.id = m.to_location_id
    left join wms.tasks t on t.id = m.task_id`;
  const [count] = await ctx.db.query<{ total: number }>(`select count(*) as total ${from} ${where}`, params);
  const rows = await ctx.db.query<MovementRow>(
    `select m.id, m.created_at::text as created_at, m.movement_type, p.sku, p.description, m.product_id, m.lot_code, m.quantity,
            lf.code as from_code, lt.code as to_code, m.reason, m.reference_type, m.reference_id, m.reference_code,
            m.task_id, t.code as task_code, u.name as user_name, w.code as warehouse_code
     ${from} ${where} order by m.created_at desc, m.id
     ${pageSize > 0 ? `limit ${pageSize} offset ${(page - 1) * pageSize}` : ""}`,
    params,
  );
  return { rows, total: count.total, page, pageSize };
}

// -----------------------------------------------------------------------------
// Ajuste manual (permissão específica + justificativa + auditoria)
// -----------------------------------------------------------------------------

const adjustSchema = z.object({
  locationId: uuid("Endereço"),
  productId: uuid("Produto"),
  lotCode: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ?? "").toUpperCase()),
  expiryDate: optionalDate,
  direction: z.enum(["in", "out"], { error: "Informe se o ajuste é de entrada ou saída." }),
  quantity: qty(),
  reason: z.string().trim().min(10, "Justificativa obrigatória (mínimo 10 caracteres).").max(1000),
});

export async function adjustStock(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "stock.adjust");
  const d = parse(adjustSchema, input);
  return runOperation(ctx, "stock.adjust", opts, async (tx) => {
    const [loc] = await tx.query<{ warehouse_id: string; code: string }>(
      `select warehouse_id, code from wms.locations where id = $1 and company_id = $2`,
      [d.locationId, ctx.user.companyId],
    );
    if (!loc) throw new NotFoundError("Endereço");
    const balance = await lockBalance(tx, ctx.user.companyId, d.locationId, d.productId, d.lotCode);
    if (d.direction === "out") {
      if (!balance) throw new DomainError("Não há saldo deste produto/lote no endereço.", "INSUFFICIENT_STOCK");
      if (d.quantity > availableOf(balance)) {
        throw new DomainError(
          `Ajuste de saída maior que o disponível (${availableOf(balance)}). Reservas e bloqueios não podem ser ajustados.`,
          "INSUFFICIENT_STOCK",
        );
      }
      await removeStock(tx, ctx, { balanceId: balance.id, quantity: d.quantity, requireAvailable: true });
    } else {
      await validateDestination(tx, ctx, {
        locationId: d.locationId,
        warehouseId: loc.warehouse_id,
        productId: d.productId,
        quantity: d.quantity,
        anyZone: true,
      });
      await addStock(tx, ctx, {
        warehouseId: loc.warehouse_id,
        locationId: d.locationId,
        productId: d.productId,
        lotCode: d.lotCode,
        expiryDate: d.expiryDate ?? balance?.expiry_date ?? null,
        quantity: d.quantity,
      });
    }
    const movementId = await insertMovement(tx, ctx, {
      warehouseId: loc.warehouse_id,
      movementType: d.direction === "in" ? "adjustment_in" : "adjustment_out",
      productId: d.productId,
      lotCode: d.lotCode,
      expiryDate: d.expiryDate ?? balance?.expiry_date ?? null,
      quantity: d.quantity,
      fromLocationId: d.direction === "out" ? d.locationId : null,
      toLocationId: d.direction === "in" ? d.locationId : null,
      reason: d.reason,
      referenceType: "manual_adjustment",
    });
    await audit(tx, ctx, "stock.adjusted", "stock_movement", movementId, loc.code, d);
    return { id: movementId };
  });
}

// -----------------------------------------------------------------------------
// Bloqueio / desbloqueio de saldo
// -----------------------------------------------------------------------------

const blockSchema = z.object({
  quantity: qty(),
  reason: z.string().trim().min(5, "Informe o motivo (mínimo 5 caracteres).").max(1000),
});

export async function blockStock(ctx: Ctx, balanceId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "stock.block");
  const d = parse(blockSchema, input);
  return runOperation(ctx, "stock.block", opts, async (tx) => {
    const b = await lockBalanceById(tx, ctx.user.companyId, balanceId);
    if (d.quantity > availableOf(b)) {
      throw new DomainError(`Só é possível bloquear o saldo disponível (${availableOf(b)}).`, "INSUFFICIENT_STOCK");
    }
    await tx.query(`update wms.stock_balances set blocked_qty = blocked_qty + $2, version = version + 1, updated_at = now() where id = $1`, [
      balanceId,
      d.quantity,
    ]);
    await insertMovement(tx, ctx, {
      warehouseId: b.warehouse_id,
      movementType: "block",
      productId: b.product_id,
      lotCode: b.lot_code,
      expiryDate: b.expiry_date,
      quantity: d.quantity,
      fromLocationId: b.location_id,
      reason: d.reason,
      referenceType: "stock_block",
    });
    await audit(tx, ctx, "stock.blocked", "stock_balance", balanceId, null, d);
    return { id: balanceId };
  });
}

export async function unblockStock(ctx: Ctx, balanceId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "stock.block");
  const d = parse(blockSchema, input);
  return runOperation(ctx, "stock.unblock", opts, async (tx) => {
    const b = await lockBalanceById(tx, ctx.user.companyId, balanceId);
    if (d.quantity > b.blocked_qty) throw new DomainError(`Quantidade maior que a bloqueada (${b.blocked_qty}).`);
    await tx.query(`update wms.stock_balances set blocked_qty = blocked_qty - $2, version = version + 1, updated_at = now() where id = $1`, [
      balanceId,
      d.quantity,
    ]);
    await insertMovement(tx, ctx, {
      warehouseId: b.warehouse_id,
      movementType: "unblock",
      productId: b.product_id,
      lotCode: b.lot_code,
      expiryDate: b.expiry_date,
      quantity: d.quantity,
      toLocationId: b.location_id,
      reason: d.reason,
      referenceType: "stock_block",
    });
    await audit(tx, ctx, "stock.unblocked", "stock_balance", balanceId, null, d);
    return { id: balanceId };
  });
}
