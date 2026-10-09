import "server-only";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { DomainError, NotFoundError } from "../errors";
import { round3 } from "./common";

/**
 * Primitivas de estoque. São as ÚNICAS funções que alteram wms.stock_balances e
 * sempre devem ser chamadas dentro de uma transação, junto com insertMovement.
 */

export interface BalanceRow {
  id: string;
  warehouse_id: string;
  location_id: string;
  product_id: string;
  lot_code: string;
  expiry_date: string | null;
  quantity: number;
  reserved_qty: number;
  blocked_qty: number;
}

export const availableOf = (b: Pick<BalanceRow, "quantity" | "reserved_qty" | "blocked_qty">) =>
  round3(b.quantity - b.reserved_qty - b.blocked_qty);

const BALANCE_COLS = `id, warehouse_id, location_id, product_id, lot_code, expiry_date::text as expiry_date,
  quantity, reserved_qty, blocked_qty`;

/** Lê e bloqueia (SELECT ... FOR UPDATE) o saldo de um produto/lote em um endereço. */
export async function lockBalance(
  tx: Queryable,
  companyId: string,
  locationId: string,
  productId: string,
  lotCode: string,
): Promise<BalanceRow | null> {
  const [row] = await tx.query<BalanceRow>(
    `select ${BALANCE_COLS} from wms.stock_balances
     where company_id = $1 and location_id = $2 and product_id = $3 and lot_code = $4 for update`,
    [companyId, locationId, productId, lotCode],
  );
  return row ?? null;
}

export async function lockBalanceById(tx: Queryable, companyId: string, balanceId: string): Promise<BalanceRow> {
  const [row] = await tx.query<BalanceRow>(
    `select ${BALANCE_COLS} from wms.stock_balances where company_id = $1 and id = $2 for update`,
    [companyId, balanceId],
  );
  if (!row) throw new NotFoundError("Saldo");
  return row;
}

export interface AddStockInput {
  warehouseId: string;
  locationId: string;
  productId: string;
  lotCode: string;
  expiryDate: string | null;
  quantity: number;
  /** Quantidade que já entra reservada (ex.: produto separado aguardando expedição). */
  reserved?: number;
}

export async function addStock(tx: Queryable, ctx: Ctx, input: AddStockInput): Promise<BalanceRow> {
  const reserved = input.reserved ?? 0;
  const [row] = await tx.query<BalanceRow>(
    `insert into wms.stock_balances
       (company_id, warehouse_id, location_id, product_id, lot_code, expiry_date, quantity, reserved_qty)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (location_id, product_id, lot_code) do update set
       quantity = wms.stock_balances.quantity + excluded.quantity,
       reserved_qty = wms.stock_balances.reserved_qty + excluded.reserved_qty,
       expiry_date = coalesce(wms.stock_balances.expiry_date, excluded.expiry_date),
       version = wms.stock_balances.version + 1,
       updated_at = now()
     returning ${BALANCE_COLS}`,
    [
      ctx.user.companyId,
      input.warehouseId,
      input.locationId,
      input.productId,
      input.lotCode,
      input.expiryDate,
      input.quantity,
      reserved,
    ],
  );
  return row;
}

export interface RemoveStockInput {
  balanceId: string;
  quantity: number;
  /** Quanto da reserva é consumido junto com a saída física. */
  consumeReserved?: number;
  /** Se verdadeiro, só permite retirar a quantidade disponível (não reservada nem bloqueada). */
  requireAvailable?: boolean;
}

export async function removeStock(tx: Queryable, ctx: Ctx, input: RemoveStockInput): Promise<BalanceRow> {
  const balance = await lockBalanceById(tx, ctx.user.companyId, input.balanceId);
  const consume = input.consumeReserved ?? 0;
  if (input.requireAvailable && input.quantity > availableOf(balance)) {
    throw new DomainError(
      `Saldo disponível insuficiente: disponível ${availableOf(balance)}, solicitado ${input.quantity}.`,
      "INSUFFICIENT_STOCK",
    );
  }
  if (input.quantity > balance.quantity) {
    throw new DomainError(
      `Saldo físico insuficiente: físico ${balance.quantity}, solicitado ${input.quantity}.`,
      "INSUFFICIENT_STOCK",
    );
  }
  if (consume > balance.reserved_qty) {
    throw new DomainError("Reserva inconsistente para a retirada solicitada.", "RESERVATION_MISMATCH");
  }
  const [row] = await tx.query<BalanceRow>(
    `update wms.stock_balances
       set quantity = quantity - $2, reserved_qty = reserved_qty - $3, version = version + 1, updated_at = now()
     where id = $1 returning ${BALANCE_COLS}`,
    [input.balanceId, input.quantity, consume],
  );
  return row;
}

export async function changeReserved(tx: Queryable, balanceId: string, delta: number): Promise<void> {
  await tx.query(
    `update wms.stock_balances set reserved_qty = reserved_qty + $2, version = version + 1, updated_at = now() where id = $1`,
    [balanceId, delta],
  );
}

export type MovementType =
  | "putaway"
  | "transfer"
  | "adjustment_in"
  | "adjustment_out"
  | "pick"
  | "shipment"
  | "block"
  | "unblock";

export interface MovementInput {
  warehouseId: string;
  movementType: MovementType;
  productId: string;
  lotCode: string;
  expiryDate: string | null;
  quantity: number;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  referenceCode?: string | null;
  taskId?: string | null;
}

export async function insertMovement(tx: Queryable, ctx: Ctx, m: MovementInput): Promise<string> {
  const [row] = await tx.query<{ id: string }>(
    `insert into wms.stock_movements
      (company_id, warehouse_id, movement_type, product_id, lot_code, expiry_date, quantity,
       from_location_id, to_location_id, reason, reference_type, reference_id, reference_code, task_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
    [
      ctx.user.companyId,
      m.warehouseId,
      m.movementType,
      m.productId,
      m.lotCode,
      m.expiryDate,
      m.quantity,
      m.fromLocationId ?? null,
      m.toLocationId ?? null,
      m.reason ?? null,
      m.referenceType ?? null,
      m.referenceId ?? null,
      m.referenceCode ?? null,
      m.taskId ?? null,
      ctx.user.id,
    ],
  );
  return row.id;
}

// -----------------------------------------------------------------------------
// Avaliação de endereços (capacidade e compatibilidade)
// -----------------------------------------------------------------------------

export interface LocationInfo {
  id: string;
  code: string;
  warehouse_id: string;
  zone_id: string;
  zone_type: string;
  zone_active: boolean;
  status: string;
  storage_class: string | null;
  capacity_units: number;
  max_weight_kg: number | null;
  occupied: number;
  occupied_weight: number;
  incoming: number;
}

export interface ProductRules {
  id: string;
  sku: string;
  weight_kg: number | null;
  storage_class: string;
  max_units_per_location: number | null;
  preferred_zone_id: string | null;
  lot_controlled: boolean;
  expiry_controlled: boolean;
}

export async function getProductRules(tx: Queryable, companyId: string, productId: string): Promise<ProductRules> {
  const [row] = await tx.query<ProductRules>(
    `select p.id, p.sku, p.weight_kg,
            coalesce(s.storage_class, 'general') as storage_class,
            s.max_units_per_location, s.preferred_zone_id,
            coalesce(s.lot_controlled, false) as lot_controlled,
            coalesce(s.expiry_controlled, false) as expiry_controlled
     from erp.products p left join wms.product_settings s on s.product_id = p.id
     where p.company_id = $1 and p.id = $2`,
    [companyId, productId],
  );
  if (!row) throw new NotFoundError("Produto");
  return row;
}

/**
 * Consulta endereços com ocupação atual e entradas pendentes (tarefas de
 * armazenagem/transferência ainda não concluídas que apontam para o endereço).
 */
async function loadLocations(
  tx: Queryable,
  companyId: string,
  where: string,
  params: unknown[],
  excludeTaskId: string | null,
): Promise<LocationInfo[]> {
  return tx.query<LocationInfo>(
    `select l.id, l.code, l.warehouse_id, l.zone_id, z.zone_type, z.active as zone_active, l.status, l.storage_class,
            l.capacity_units, l.max_weight_kg,
            coalesce((select sum(b.quantity) from wms.stock_balances b where b.location_id = l.id), 0) as occupied,
            coalesce((select sum(b.quantity * coalesce(p.weight_kg, 0)) from wms.stock_balances b
                      join erp.products p on p.id = b.product_id where b.location_id = l.id), 0) as occupied_weight,
            coalesce((select sum(t.quantity) from wms.tasks t
                      where coalesce(t.to_location_id, t.suggested_location_id) = l.id
                        and t.status in ('pending', 'in_progress') and t.task_type in ('putaway', 'transfer')
                        and ($2::uuid is null or t.id <> $2::uuid)), 0) as incoming
     from wms.locations l join wms.zones z on z.id = l.zone_id
     where l.company_id = $1 and ${where}
     order by l.aisle, l.bay, l.level, l.position`,
    [companyId, excludeTaskId, ...params],
  );
}

const STORAGE_ZONES = ["storage", "picking"];

/** Endereço sem classe definida é tratado como "geral"; produtos especiais exigem classe idêntica. */
const locationClass = (loc: Pick<LocationInfo, "storage_class">) => loc.storage_class ?? "general";

export interface Evaluation {
  location: LocationInfo;
  ok: boolean;
  reasons: string[];
  free: number;
  productQty: number;
}

async function productQtyAt(tx: Queryable, locationId: string, productId: string): Promise<number> {
  const [row] = await tx.query<{ q: number }>(
    `select coalesce(sum(quantity), 0) as q from wms.stock_balances where location_id = $1 and product_id = $2`,
    [locationId, productId],
  );
  return row.q;
}

function evaluate(
  loc: LocationInfo,
  product: ProductRules,
  qty: number,
  productQty: number,
  warehouseId: string,
  anyZone = false,
): Evaluation {
  const reasons: string[] = [];
  if (loc.warehouse_id !== warehouseId) reasons.push("endereço pertence a outro depósito");
  if (loc.status !== "active") reasons.push(loc.status === "blocked" ? "endereço bloqueado" : "endereço inativo");
  if (!loc.zone_active) reasons.push("zona inativa");
  if (!anyZone && !STORAGE_ZONES.includes(loc.zone_type)) reasons.push("zona não é de armazenagem/picking");
  const storageZone = STORAGE_ZONES.includes(loc.zone_type);
  if (storageZone && locationClass(loc) !== product.storage_class)
    reasons.push(`classe do endereço (${locationClass(loc)}) incompatível com o produto (${product.storage_class})`);
  const free = round3(loc.capacity_units - loc.occupied - loc.incoming);
  if (qty > free) reasons.push(`capacidade insuficiente (livre ${Math.max(free, 0)} un)`);
  if (product.max_units_per_location && productQty + qty > product.max_units_per_location)
    reasons.push(`excede o máximo de ${product.max_units_per_location} un do produto por endereço`);
  if (loc.max_weight_kg && product.weight_kg && loc.occupied_weight + qty * product.weight_kg > loc.max_weight_kg)
    reasons.push(`excede o peso máximo do endereço (${loc.max_weight_kg} kg)`);
  return { location: loc, ok: reasons.length === 0, reasons, free, productQty };
}

/**
 * Valida se um endereço pode receber `qty` do produto. O endereço é bloqueado
 * (FOR UPDATE) para que armazenagens concorrentes não ultrapassem a capacidade.
 */
export async function validateDestination(
  tx: Queryable,
  ctx: Ctx,
  args: {
    locationId: string;
    warehouseId: string;
    productId: string;
    quantity: number;
    excludeTaskId?: string | null;
    /** Aceita zonas que não são de armazenagem (ex.: ajuste em doca ou quarentena). */
    anyZone?: boolean;
  },
): Promise<LocationInfo> {
  await tx.query(`select id from wms.locations where id = $1 and company_id = $2 for update`, [
    args.locationId,
    ctx.user.companyId,
  ]);
  const [loc] = await loadLocations(tx, ctx.user.companyId, "l.id = $3", [args.locationId], args.excludeTaskId ?? null);
  if (!loc) throw new NotFoundError("Endereço");
  const product = await getProductRules(tx, ctx.user.companyId, args.productId);
  const productQty = await productQtyAt(tx, loc.id, args.productId);
  const result = evaluate(loc, product, args.quantity, productQty, args.warehouseId, args.anyZone);
  if (!result.ok) {
    throw new DomainError(`Endereço ${loc.code} não é elegível: ${result.reasons.join("; ")}.`, "LOCATION_NOT_ELIGIBLE");
  }
  return loc;
}

export interface Suggestion {
  best: LocationInfo | null;
  candidates: Evaluation[];
  /** Motivo legível quando não há posição elegível. */
  reason: string | null;
}

/**
 * Sugere endereços de armazenagem segundo regras simples e explicáveis:
 *  1. somente endereços ativos, em zonas ativas de armazenagem/picking do depósito;
 *  2. classe de armazenagem compatível; capacidade, peso e limite por produto respeitados;
 *  3. prioridade: zona preferencial do produto > endereço que já contém o mesmo
 *     produto/lote (consolidação) > menor espaço livre suficiente (melhor encaixe) > código.
 * Nunca escolhe um endereço incompatível: se nada for elegível, retorna o motivo.
 */
export async function suggestLocations(
  tx: Queryable,
  ctx: Ctx,
  args: { warehouseId: string; productId: string; lotCode: string; quantity: number; excludeTaskId?: string | null },
): Promise<Suggestion> {
  const product = await getProductRules(tx, ctx.user.companyId, args.productId);
  const locations = await loadLocations(tx, ctx.user.companyId, "l.warehouse_id = $3", [args.warehouseId], args.excludeTaskId ?? null);
  const sameProduct = await tx.query<{ location_id: string; q: number; same_lot: boolean }>(
    `select location_id, sum(quantity) as q, bool_or(lot_code = $3) as same_lot from wms.stock_balances
     where company_id = $1 and product_id = $2 and quantity > 0 group by location_id`,
    [ctx.user.companyId, args.productId, args.lotCode],
  );
  const byLoc = new Map(sameProduct.map((r) => [r.location_id, r]));
  const evaluations = locations.map((loc) =>
    evaluate(loc, product, args.quantity, byLoc.get(loc.id)?.q ?? 0, args.warehouseId),
  );
  const eligible = evaluations.filter((e) => e.ok);
  const score = (e: Evaluation) => [
    product.preferred_zone_id && e.location.zone_id === product.preferred_zone_id ? 0 : 1,
    byLoc.get(e.location.id)?.same_lot ? 0 : byLoc.has(e.location.id) ? 1 : 2,
    e.free,
  ];
  eligible.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i];
    return a.location.code.localeCompare(b.location.code);
  });

  if (eligible.length > 0) return { best: eligible[0].location, candidates: eligible, reason: null };

  let reason: string;
  const storage = evaluations.filter(
    (e) => STORAGE_ZONES.includes(e.location.zone_type) && e.location.status === "active" && e.location.zone_active,
  );
  if (locations.length === 0) reason = "O depósito não possui endereços cadastrados.";
  else if (storage.length === 0) reason = "Não há endereços ativos em zonas de armazenagem/picking.";
  else {
    const compatible = storage.filter((e) => locationClass(e.location) === product.storage_class);
    if (compatible.length === 0)
      reason = `Nenhum endereço ativo aceita a classe de armazenagem "${product.storage_class}" do produto.`;
    else {
      const maxFree = Math.max(...compatible.map((e) => e.free), 0);
      reason = `Nenhum endereço compatível com capacidade para ${args.quantity} un (maior espaço livre: ${maxFree} un).`;
    }
  }
  return { best: null, candidates: [], reason };
}
