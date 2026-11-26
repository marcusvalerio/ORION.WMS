import "server-only";
import { z } from "zod";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { assertWarehouseAccess, hasWarehouseAccess, warehouseScope } from "../access";
import { DomainError, NotFoundError } from "../errors";
import { parse, uuid, optionalText, optionalUuid, nonNegQty } from "../validation";
import { audit, enqueueIntegrationEvent, nextCode, recordTaskEvent, round3, runOperation, type OpOptions } from "./common";
import { addStock, insertMovement, lockBalance, removeStock } from "./stock-core";
import { getSetting } from "./settings";
import { computeAbc } from "./slotting";
import {
  DEFAULT_CYCLE_DAYS,
  DEFAULT_TOLERANCES,
  adjustedExpected,
  decideRounds,
  withinTolerance,
  type AbcClass,
  type Tolerance,
} from "@/lib/inventory-rules";
import { can } from "@/lib/permissions";
import { buildCdMap, type MapItemInput, type MapLocationInput } from "@/lib/cd-map";
import { computeInventoryKpis, type CycleInput, type KpiItemInput } from "@/lib/inventory-kpis";

export const INVENTORY_STATUSES = ["counting", "submitted", "approved", "cancelled"] as const;
export const ITEM_STATUSES = ["pending", "counting", "counted", "recount", "closed"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

interface CountHeader {
  id: string;
  code: string;
  status: (typeof INVENTORY_STATUSES)[number];
  warehouse_id: string;
}

async function lockCount(tx: Queryable, ctx: Ctx, id: string): Promise<CountHeader> {
  const [c] = await tx.query<CountHeader>(
    `select id, code, status, warehouse_id from wms.inventory_counts where id = $1 and company_id = $2 for update`,
    [id, ctx.user.companyId],
  );
  if (!c) throw new NotFoundError("Inventário");
  assertWarehouseAccess(ctx, c.warehouse_id);
  return c;
}

export async function listInventories(ctx: Ctx) {
  const params: unknown[] = [ctx.user.companyId];
  const scope = warehouseScope(ctx, "c.warehouse_id", params);
  return ctx.db.query<{
    id: string;
    code: string;
    count_type: string;
    status: string;
    warehouse_code: string;
    scope: string;
    origin: string;
    items: number;
    counted: number;
    differences: number;
    created_by_name: string;
    created_at: string;
    approved_at: string | null;
  }>(
    `select c.id, c.code, c.count_type, c.status, w.code as warehouse_code,
            coalesce(c.scope_label, nullif(concat_ws(' · ', z.code, l.code, p.sku), ''), 'Depósito inteiro') as scope, c.origin,
            (select count(*) from wms.inventory_count_items i where i.inventory_id = c.id) as items,
            (select count(*) from wms.inventory_count_items i where i.inventory_id = c.id and i.counted_qty is not null) as counted,
            (select count(*) from wms.inventory_count_items i where i.inventory_id = c.id and i.counted_qty is not null
               and i.counted_qty <> i.expected_qty) as differences,
            u.name as created_by_name, c.created_at::text as created_at, c.approved_at::text as approved_at
     from wms.inventory_counts c join wms.warehouses w on w.id = c.warehouse_id join wms.users u on u.id = c.created_by
     left join wms.zones z on z.id = c.zone_id left join wms.locations l on l.id = c.location_id
     left join erp.products p on p.id = c.product_id
     where c.company_id = $1${scope} order by c.created_at desc`,
    params,
  );
}

export async function getInventory(ctx: Ctx, id: string) {
  const [c] = await ctx.db.query<{
    id: string;
    code: string;
    count_type: string;
    status: string;
    warehouse_id: string;
    warehouse_code: string;
    zone_code: string | null;
    location_code: string | null;
    sku: string | null;
    notes: string | null;
    created_by_name: string;
    created_at: string;
    submitted_by_name: string | null;
    submitted_at: string | null;
    approved_by_name: string | null;
    approved_at: string | null;
    approval_notes: string | null;
    lock_mode: "lock" | "reconcile";
    origin: string;
    reference_date: string | null;
    scope_label: string | null;
  }>(
    `select c.id, c.code, c.count_type, c.status, c.warehouse_id, c.lock_mode, c.origin, c.reference_date::text as reference_date,
            c.scope_label, w.code as warehouse_code, z.code as zone_code,
            l.code as location_code, p.sku, c.notes, u.name as created_by_name, c.created_at::text as created_at,
            us.name as submitted_by_name, c.submitted_at::text as submitted_at, ua.name as approved_by_name,
            c.approved_at::text as approved_at, c.approval_notes
     from wms.inventory_counts c join wms.warehouses w on w.id = c.warehouse_id join wms.users u on u.id = c.created_by
     left join wms.zones z on z.id = c.zone_id left join wms.locations l on l.id = c.location_id
     left join erp.products p on p.id = c.product_id left join wms.users us on us.id = c.submitted_by
     left join wms.users ua on ua.id = c.approved_by
     where c.id = $1 and c.company_id = $2`,
    [id, ctx.user.companyId],
  );
  if (!c || !hasWarehouseAccess(ctx, c.warehouse_id)) return null;
  // Contagem cega (A4): durante a contagem o servidor NÃO devolve o esperado nem a diferença.
  const blind = c.status === "counting";
  const rows = await ctx.db.query<{
    id: string;
    location_id: string;
    location_code: string;
    aisle: string | null;
    bay: string | null;
    level: string | null;
    position: string | null;
    product_id: string | null;
    sku: string | null;
    description: string | null;
    uom: string | null;
    lot_controlled: boolean;
    expiry_controlled: boolean;
    lot_code: string;
    expiry_date: string | null;
    expected_qty: number | null;
    counted_qty: number | null;
    notes: string | null;
    adjusted: boolean;
    counted_by_name: string | null;
    status: ItemStatus;
    round: number;
    empty_location: boolean;
    found: boolean;
    stock_origin: "available" | "blocked" | "quarantine";
    blocked_qty: number;
    abc_class: AbcClass | null;
  }>(
    `select i.id, i.location_id, l.code as location_code, l.aisle, l.bay, l.level, l.position, i.product_id, p.sku, p.description, p.uom,
            coalesce(ps.lot_controlled, false) as lot_controlled, coalesce(ps.expiry_controlled, false) as expiry_controlled, i.lot_code,
            i.expiry_date::text as expiry_date, i.expected_qty, i.counted_qty, i.notes, i.adjusted, u.name as counted_by_name,
            i.status, i.round, i.empty_location, i.found, i.stock_origin, i.blocked_qty, i.abc_class
     from wms.inventory_count_items i join wms.locations l on l.id = i.location_id left join erp.products p on p.id = i.product_id
     left join wms.product_settings ps on ps.product_id = i.product_id left join wms.users u on u.id = i.counted_by
     where i.inventory_id = $1 order by l.code, p.sku nulls first, i.lot_code`,
    [id],
  );
  const rounds = await ctx.db.query<{ inventory_item_id: string; round: number; counted_qty: number; counted_by_name: string; counted_at: string; device: string }>(
    `select r.inventory_item_id, r.round, r.counted_qty, u.name as counted_by_name, r.counted_at::text as counted_at, r.device
     from wms.inventory_count_rounds r join wms.inventory_count_items i on i.id = r.inventory_item_id join wms.users u on u.id = r.counted_by
     where i.inventory_id = $1 and r.company_id = $2 order by r.round`,
    [id, ctx.user.companyId],
  );
  const byItem = new Map<string, typeof rounds>();
  for (const r of rounds) byItem.set(r.inventory_item_id, [...(byItem.get(r.inventory_item_id) ?? []), r]);
  const items = rows.map((i) => ({
    ...i,
    sku: i.sku ?? "—",
    description: i.description ?? (i.empty_location ? "Endereço vazio" : ""),
    uom: i.uom ?? "un",
    expected_qty: blind ? null : i.expected_qty,
    // Rodadas: durante a contagem só o supervisor vê as quantidades das rodadas anteriores.
    rounds: (byItem.get(i.id) ?? []).map((r) => ({ ...r, counted_qty: blind && !can(ctx.user.role, "inventory.approve") ? null : r.counted_qty })),
  }));
  const approval = await approvalCheck(ctx.db, ctx, c.id, c.status);
  return { ...c, blind, items, canApprove: approval.canApprove, blockedReason: approval.blockedReason };
}

const createSchema = z
  .object({
    warehouseId: uuid("Depósito"),
    countType: z.enum(["general", "cyclic", "production_line"], { error: "Tipo de inventário inválido." }),
    zoneId: optionalUuid,
    locationId: optionalUuid,
    productId: optionalUuid,
    notes: optionalText,
    referenceDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de referência inválida.")
      .nullish()
      .or(z.literal("").transform(() => null)),
  })
  .refine((d) => d.countType !== "cyclic" || d.zoneId || d.locationId || d.productId, {
    message: "Inventário rotativo exige ao menos um filtro (zona, endereço ou produto).",
  });

/**
 * Abre uma sessão de inventário com o saldo esperado (snapshot) de cada
 * produto/lote/endereço do escopo e gera a tarefa de contagem.
 */
export async function createInventory(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "inventory.create");
  const d = parse(createSchema, input);
  assertWarehouseAccess(ctx, d.warehouseId);
  const abc = await abcByProduct(ctx);
  return runOperation(ctx, "inventory.create", opts, async (tx) => {
    const [wh] = await tx.query(`select id from wms.warehouses where id = $1 and company_id = $2`, [d.warehouseId, ctx.user.companyId]);
    if (!wh) throw new NotFoundError("Depósito");
    // Filtros (zona, endereço, produto) precisam ser da mesma empresa e do depósito do inventário.
    if (d.zoneId) {
      const [z] = await tx.query(`select 1 from wms.zones where id = $1 and company_id = $2 and warehouse_id = $3`, [
        d.zoneId,
        ctx.user.companyId,
        d.warehouseId,
      ]);
      if (!z) throw new NotFoundError("Zona");
    }
    if (d.locationId) {
      const [l] = await tx.query(`select 1 from wms.locations where id = $1 and company_id = $2 and warehouse_id = $3`, [
        d.locationId,
        ctx.user.companyId,
        d.warehouseId,
      ]);
      if (!l) throw new NotFoundError("Endereço");
    }
    if (d.productId) {
      const [p] = await tx.query(`select 1 from erp.products where id = $1 and company_id = $2`, [d.productId, ctx.user.companyId]);
      if (!p) throw new NotFoundError("Produto");
    }
    const created = await openInventory(tx, ctx, {
      warehouseId: d.warehouseId,
      countType: d.countType,
      zoneId: d.zoneId ?? null,
      locationId: d.locationId ?? null,
      productId: d.productId ?? null,
      locationIds: null,
      notes: d.notes,
      origin: "manual",
      planDate: null,
      referenceDate: d.referenceDate ?? null,
      scopeLabel: d.countType === "production_line" ? "Linhas de produção" : null,
      abc,
    });
    const { c, code, inserted } = created;
    await audit(tx, ctx, "inventory.created", "inventory", c.id, code, { ...d, items: inserted });
    return { id: c.id, code };
  });
}


// -----------------------------------------------------------------------------
// Abertura (foto): itens com saldo, endereços vazios (A5) e origem do saldo (A6)
// -----------------------------------------------------------------------------

/** Classe ABC por produto (curva já existente em slotting.ts). Sem histórico = C. */
async function abcByProduct(ctx: Ctx): Promise<Map<string, AbcClass>> {
  const { rows } = await computeAbc(ctx);
  return new Map(rows.map((r) => [r.product_id, r.abc]));
}

interface OpenArgs {
  warehouseId: string;
  countType: "general" | "cyclic" | "production_line";
  zoneId: string | null;
  locationId: string | null;
  productId: string | null;
  /** escopo explícito (calendário/gatilho) */
  locationIds: string[] | null;
  notes: string | null;
  origin: "manual" | "calendar" | "trigger";
  planDate: string | null;
  referenceDate: string | null;
  scopeLabel: string | null;
  abc: Map<string, AbcClass>;
}

async function openInventory(tx: Queryable, ctx: Ctx, a: OpenArgs) {
  const lockMode = await getSetting(tx, ctx.user.companyId, "inventory.lock_mode");
  const code = await nextCode(tx, ctx.user.companyId, "INV");
  const [c] = await tx.query<{ id: string }>(
    `insert into wms.inventory_counts (company_id, warehouse_id, code, count_type, zone_id, location_id, product_id, notes, created_by,
                                       lock_mode, origin, plan_date, reference_date, scope_label)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
    [
      ctx.user.companyId,
      a.warehouseId,
      code,
      a.countType,
      a.zoneId,
      a.locationId,
      a.productId,
      a.notes,
      ctx.user.id,
      lockMode,
      a.origin,
      a.planDate,
      a.referenceDate,
      a.scopeLabel,
    ],
  );
  // escopo de endereços: zona/endereço/lista; linha de produção = zonas 'production'
  const scope = `l.company_id = $2 and l.warehouse_id = $3
      and ($4::uuid is null or l.zone_id = $4::uuid)
      and ($5::uuid is null or l.id = $5::uuid)
      and ($7::uuid[] is null or l.id = any($7::uuid[]))
      and (($8 = 'production_line' and z.zone_type = 'production') or ($8 <> 'production_line'))`;
  const params = [c.id, ctx.user.companyId, a.warehouseId, a.zoneId, a.locationId, a.productId, a.locationIds, a.countType];
  const withStock = await tx.query<{ id: string; product_id: string }>(
    `insert into wms.inventory_count_items (company_id, inventory_id, location_id, product_id, lot_code, expiry_date, expected_qty,
                                            stock_origin, blocked_qty)
     select $2, $1, b.location_id, b.product_id, b.lot_code, b.expiry_date, b.quantity,
            case when z.zone_type = 'quarantine' then 'quarantine' when b.blocked_qty > 0 then 'blocked' else 'available' end,
            b.blocked_qty
     from wms.stock_balances b join wms.locations l on l.id = b.location_id join wms.zones z on z.id = l.zone_id
     where b.company_id = $2 and b.warehouse_id = $3 and b.quantity > 0
       and ($6::uuid is null or b.product_id = $6::uuid) and ${scope}
     returning id, product_id`,
    params,
  );
  for (const r of withStock) {
    const cls = a.abc.get(r.product_id) ?? "C";
    await tx.query(`update wms.inventory_count_items set abc_class = $2 where id = $1`, [r.id, cls]);
  }
  // A5: endereços sem saldo entram como "esperado 0" (só sem filtro de produto e fora da linha)
  let empty = 0;
  if (!a.productId) {
    const rows = await tx.query(
      `insert into wms.inventory_count_items (company_id, inventory_id, location_id, product_id, expected_qty, empty_location)
       select $2, $1, l.id, null, 0, true
       from wms.locations l join wms.zones z on z.id = l.zone_id
       where l.status = 'active' and z.zone_type in ('storage', 'picking', 'quarantine', 'production')
         and not exists (select 1 from wms.stock_balances b where b.location_id = l.id and b.quantity > 0) and ${scope}
         and ($6::uuid is null)
       returning id`,
      params,
    );
    empty = rows.length;
  }
  const inserted = withStock.length + empty;
  const taskCode = await nextCode(tx, ctx.user.companyId, "TAR");
  const [inventoryTask] = await tx.query<{ id: string }>(
    `insert into wms.tasks (company_id, warehouse_id, code, task_type, priority, inventory_id, from_location_id, product_id, notes, created_by)
     values ($1, $2, $3, 'inventory', 2, $4, $5, $6, $7, $8) returning id`,
    [
      ctx.user.companyId,
      a.warehouseId,
      taskCode,
      c.id,
      a.locationId,
      a.productId,
      `Contagem do inventário ${code} (${inserted} itens)`,
      ctx.user.id,
    ],
  );
  await recordTaskEvent(tx, inventoryTask.id, ctx.user.id, "created", null, "pending", { inventory: code });
  return { c, code, inserted, empty };
}

// -----------------------------------------------------------------------------
// Tolerância e alçada (A3)
// -----------------------------------------------------------------------------

export async function getInventoryTolerances(db: Queryable, companyId: string): Promise<Record<AbcClass, Tolerance>> {
  const rows = await db.query<Tolerance>(
    `select abc_class, tolerance_pct, tolerance_units, approval_limit_value, approval_role from wms.inventory_tolerances where company_id = $1`,
    [companyId],
  );
  const out = { ...DEFAULT_TOLERANCES };
  for (const r of rows) {
    out[r.abc_class] = {
      abc_class: r.abc_class,
      tolerance_pct: Number(r.tolerance_pct),
      tolerance_units: Number(r.tolerance_units),
      approval_limit_value: Number(r.approval_limit_value),
      approval_role: r.approval_role,
    };
  }
  return out;
}

export async function getInventoryConfig(ctx: Ctx) {
  const [tolerances, plans, lockMode, costSource] = await Promise.all([
    getInventoryTolerances(ctx.db, ctx.user.companyId),
    getCyclePlans(ctx.db, ctx.user.companyId),
    getSetting(ctx.db, ctx.user.companyId, "inventory.lock_mode"),
    getSetting(ctx.db, ctx.user.companyId, "inventory.cost_source"),
  ]);
  return { tolerances, plans, lockMode, costSource };
}

const abcEnum = z.enum(["A", "B", "C"]);
const configSchema = z.object({
  tolerances: z
    .array(
      z.object({
        abcClass: abcEnum,
        tolerancePct: z.coerce.number().min(0, "Tolerância inválida.").max(100, "Tolerância inválida."),
        toleranceUnits: z.coerce.number().min(0, "Tolerância inválida."),
        approvalLimitValue: z.coerce.number().min(0, "Alçada inválida."),
        approvalRole: z.enum(["supervisor", "admin"]),
      }),
    )
    .default([]),
  plans: z.array(z.object({ abcClass: abcEnum, frequencyDays: z.coerce.number().int().min(1).max(366) })).default([]),
});

/** Configurações › Inventário: tolerância/alçada por classe e frequência do rotativo. */
export async function saveInventoryConfig(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "settings.manage");
  const d = parse(configSchema, input);
  return runOperation(ctx, "inventory.config", opts, async (tx) => {
    for (const t of d.tolerances) {
      await tx.query(
        `insert into wms.inventory_tolerances (company_id, abc_class, tolerance_pct, tolerance_units, approval_limit_value, approval_role, updated_by)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (company_id, abc_class) do update set tolerance_pct = excluded.tolerance_pct, tolerance_units = excluded.tolerance_units,
           approval_limit_value = excluded.approval_limit_value, approval_role = excluded.approval_role, updated_by = excluded.updated_by,
           updated_at = now()`,
        [ctx.user.companyId, t.abcClass, t.tolerancePct, t.toleranceUnits, t.approvalLimitValue, t.approvalRole, ctx.user.id],
      );
    }
    for (const p of d.plans) {
      await tx.query(
        `insert into wms.cycle_count_plans (company_id, abc_class, frequency_days, updated_by) values ($1,$2,$3,$4)
         on conflict (company_id, abc_class) do update set frequency_days = excluded.frequency_days, updated_by = excluded.updated_by, updated_at = now()`,
        [ctx.user.companyId, p.abcClass, p.frequencyDays, ctx.user.id],
      );
    }
    await audit(tx, ctx, "inventory.config_updated", "company_settings", null, null, d);
    return { tolerances: d.tolerances.length, plans: d.plans.length };
  });
}

// -----------------------------------------------------------------------------
// Contagem com rodadas (A1, A2)
// -----------------------------------------------------------------------------

interface ItemRow {
  id: string;
  location_id: string;
  product_id: string | null;
  status: ItemStatus;
  round: number;
  expected_qty: number;
  empty_location: boolean;
  abc_class: AbcClass | null;
  lot_code: string;
  expiry_date: string | null;
}

/** Grava o lock do endereço (modo lock). Recusa se outro inventário já conta o endereço. */
async function lockLocation(tx: Queryable, ctx: Ctx, c: CountHeader & { lock_mode: string }, locationId: string) {
  if (c.lock_mode !== "lock") return;
  await tx.query(
    `insert into wms.inventory_location_locks (location_id, company_id, inventory_id, locked_by) values ($1,$2,$3,$4)
     on conflict (location_id) do nothing`,
    [locationId, ctx.user.companyId, c.id, ctx.user.id],
  );
  const [holder] = await tx.query<{ code: string }>(
    `select c.code from wms.inventory_location_locks k join wms.inventory_counts c on c.id = k.inventory_id
     where k.location_id = $1 and k.inventory_id <> $2`,
    [locationId, c.id],
  );
  if (holder) throw new DomainError(`Endereço em contagem (${holder.code}).`, "LOCATION_LOCKED");
}

/** Libera o lock quando todos os itens do endereço fecharam dentro da tolerância (ou foram aprovados). */
async function maybeReleaseLock(tx: Queryable, ctx: Ctx, inventoryId: string, locationId: string, tolerances: Record<AbcClass, Tolerance>) {
  const items = await tx.query<{ status: ItemStatus; expected_qty: number; counted_qty: number | null; abc_class: AbcClass | null }>(
    `select status, expected_qty, counted_qty, abc_class from wms.inventory_count_items where inventory_id = $1 and location_id = $2`,
    [inventoryId, locationId],
  );
  const done = items.every(
    (i) =>
      i.status === "closed" ||
      (i.status === "counted" && i.counted_qty !== null && withinTolerance(Number(i.expected_qty), Number(i.counted_qty), tolerances[i.abc_class ?? "C"])),
  );
  if (done) {
    await tx.query(`delete from wms.inventory_location_locks where location_id = $1 and inventory_id = $2 and company_id = $3`, [
      locationId,
      inventoryId,
      ctx.user.companyId,
    ]);
  }
}

async function registerCount(
  tx: Queryable,
  ctx: Ctx,
  c: CountHeader & { lock_mode: string },
  item: ItemRow,
  qty: number,
  device: "web" | "collector",
  tolerances: Record<AbcClass, Tolerance>,
  notes: string | null,
) {
  if (item.status === "counted" || item.status === "closed") {
    throw new DomainError("Este item já foi contado. Para contar de novo, o supervisor devolve o item para recontagem.", "ITEM_CLOSED");
  }
  if (item.empty_location && qty > 0) {
    throw new DomainError("Endereço previsto vazio: leia o produto encontrado para incluí-lo como item encontrado.", "EMPTY_LOCATION");
  }
  const previous = await tx.query<{ counted_qty: number; counted_by: string }>(
    `select counted_qty, counted_by from wms.inventory_count_rounds where inventory_item_id = $1 order by round`,
    [item.id],
  );
  const round = previous.length + 1;
  if (round === 2 && previous[0].counted_by === ctx.user.id) {
    throw new DomainError("A 2ª contagem é cega e deve ser feita por outro usuário.", "SAME_COUNTER");
  }
  if (round === 3 && !can(ctx.user.role, "inventory.approve")) {
    throw new DomainError("A 3ª contagem (desempate) é feita por um supervisor.", "SUPERVISOR_REQUIRED");
  }
  if (round > 3) throw new DomainError("O item já teve três contagens.", "ITEM_CLOSED");
  await lockLocation(tx, ctx, c, item.location_id);
  await tx.query(
    `insert into wms.inventory_count_rounds (company_id, inventory_item_id, round, counted_qty, lot_code, expiry_date, counted_by, device)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [ctx.user.companyId, item.id, round, qty, item.lot_code, item.expiry_date, ctx.user.id, device],
  );
  const counts = [...previous.map((p) => Number(p.counted_qty)), qty];
  const decision = decideRounds(Number(item.expected_qty), counts, tolerances[item.abc_class ?? "C"]);
  if (decision.closed) {
    await tx.query(
      `update wms.inventory_count_items set status = 'counted', counted_qty = $2, counted_by = $3, counted_at = now(), round = $4,
              notes = coalesce($5, notes)
       where id = $1`,
      [item.id, decision.value, ctx.user.id, round, notes],
    );
    await maybeReleaseLock(tx, ctx, c.id, item.location_id, tolerances);
  } else {
    await tx.query(
      `update wms.inventory_count_items set status = 'recount', counted_qty = null, counted_by = null, counted_at = null, round = $2,
              notes = coalesce($3, notes)
       where id = $1`,
      [item.id, decision.nextRound, notes],
    );
  }
  return { round, closed: decision.closed, nextRound: decision.closed ? null : decision.nextRound };
}

async function lockCountFull(tx: Queryable, ctx: Ctx, id: string) {
  const c = await lockCount(tx, ctx, id);
  const [extra] = await tx.query<{ lock_mode: string; created_at: string }>(
    `select lock_mode, created_at::text as created_at from wms.inventory_counts where id = $1`,
    [id],
  );
  return { ...c, ...extra };
}

const ITEM_COLS = `id, location_id, product_id, status, round, expected_qty, empty_location, abc_class, lot_code, expiry_date::text as expiry_date`;

const countsSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: uuid("Item"),
        countedQty: z.union([z.literal("").transform(() => null), nonNegQty("Quantidade contada")]).nullish(),
        notes: optionalText,
      }),
    )
    .min(1),
  device: z.enum(["web", "collector"]).default("web"),
});

/**
 * Registra contagens (cada uma vira uma rodada; nenhuma é sobrescrita). NÃO altera
 * saldo: o ajuste só ocorre na aprovação. Linhas sem quantidade são ignoradas.
 */
export async function recordCounts(ctx: Ctx, inventoryId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "inventory.count");
  const d = parse(countsSchema, input);
  return runOperation(ctx, "inventory.count", opts, async (tx) => {
    const c = await lockCountFull(tx, ctx, inventoryId);
    if (c.status !== "counting") throw new DomainError(`O inventário ${c.code} não está em contagem.`, "INVALID_STATUS");
    const tolerances = await getInventoryTolerances(tx, ctx.user.companyId);
    const results: { itemId: string; round: number; closed: boolean; nextRound: number | null }[] = [];
    for (const entry of d.items) {
      const [item] = await tx.query<ItemRow>(
        `select ${ITEM_COLS} from wms.inventory_count_items where id = $1 and inventory_id = $2 and company_id = $3 for update`,
        [entry.itemId, inventoryId, ctx.user.companyId],
      );
      if (!item) throw new NotFoundError("Item do inventário");
      if (entry.countedQty === null || entry.countedQty === undefined) continue;
      results.push({ itemId: item.id, ...(await registerCount(tx, ctx, c, item, entry.countedQty, d.device, tolerances, entry.notes)) });
    }
    await tx.query(
      `update wms.tasks set status = 'in_progress', started_at = coalesce(started_at, now()), assigned_to = coalesce(assigned_to, $2)
       where inventory_id = $1 and status = 'pending'`,
      [inventoryId, ctx.user.id],
    );
    await audit(tx, ctx, "inventory.counted", "inventory", inventoryId, c.code, { items: results.length, device: d.device });
    return { id: inventoryId, results, recount: results.filter((r) => !r.closed).length };
  });
}

/** Abre a linha na web: grava o lock do endereço antes da 1ª leitura (A1). */
export async function startLocationCount(ctx: Ctx, inventoryId: string, locationId: string, opts?: OpOptions) {
  assertCan(ctx, "inventory.count");
  parse(uuid("Endereço"), locationId);
  return runOperation(ctx, "inventory.start_location", opts, async (tx) => {
    const c = await lockCountFull(tx, ctx, inventoryId);
    if (c.status !== "counting") throw new DomainError(`O inventário ${c.code} não está em contagem.`, "INVALID_STATUS");
    const [has] = await tx.query(`select 1 from wms.inventory_count_items where inventory_id = $1 and location_id = $2`, [inventoryId, locationId]);
    if (!has) throw new NotFoundError("Endereço do inventário");
    await lockLocation(tx, ctx, c, locationId);
    await tx.query(
      `update wms.inventory_count_items set status = 'counting' where inventory_id = $1 and location_id = $2 and status = 'pending'`,
      [inventoryId, locationId],
    );
    return { id: inventoryId, locked: c.lock_mode === "lock" };
  });
}

const addItemSchema = z.object({
  locationId: uuid("Endereço"),
  productId: uuid("Produto"),
  lotCode: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ?? "").toUpperCase()),
  countedQty: nonNegQty("Quantidade contada"),
  notes: optionalText,
  device: z.enum(["web", "collector"]).default("web"),
});

/**
 * Inclui item encontrado fisicamente que não constava na foto (A5). A contagem
 * informada vira a 1ª rodada; se o endereço estava previsto vazio, a linha
 * "vazio" fecha.
 */
export async function addInventoryItem(ctx: Ctx, inventoryId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "inventory.count");
  const d = parse(addItemSchema, input);
  const abc = await abcByProduct(ctx);
  return runOperation(ctx, "inventory.add_item", opts, async (tx) => {
    const c = await lockCountFull(tx, ctx, inventoryId);
    if (c.status !== "counting") throw new DomainError(`O inventário ${c.code} não está em contagem.`, "INVALID_STATUS");
    const [loc] = await tx.query<{ warehouse_id: string }>(`select warehouse_id from wms.locations where id = $1 and company_id = $2`, [
      d.locationId,
      ctx.user.companyId,
    ]);
    if (!loc || loc.warehouse_id !== c.warehouse_id) throw new DomainError("Endereço não pertence ao depósito do inventário.");
    const [product] = await tx.query(`select 1 from erp.products where id = $1 and company_id = $2`, [d.productId, ctx.user.companyId]);
    if (!product) throw new NotFoundError("Produto");
    const balance = await lockBalance(tx, ctx.user.companyId, d.locationId, d.productId, d.lotCode);
    const [row] = await tx.query<{ id: string }>(
      `insert into wms.inventory_count_items (company_id, inventory_id, location_id, product_id, lot_code, expiry_date, expected_qty, notes,
                                              found, abc_class, status, blocked_qty)
       values ($1,$2,$3,$4,$5,$6,$7,$8, true, $9, 'counting', $10)
       on conflict (inventory_id, location_id, product_id, lot_code) do nothing returning id`,
      [
        ctx.user.companyId,
        inventoryId,
        d.locationId,
        d.productId,
        d.lotCode,
        balance?.expiry_date ?? null,
        balance?.quantity ?? 0,
        d.notes,
        abc.get(d.productId) ?? "C",
        balance?.blocked_qty ?? 0,
      ],
    );
    if (!row) throw new DomainError("Este produto/lote/endereço já faz parte do inventário.", "DUPLICATE");
    // o endereço previsto vazio deixa de ser vazio
    await tx.query(
      `update wms.inventory_count_items set status = 'closed', counted_qty = 0, counted_by = $3, counted_at = now()
       where inventory_id = $1 and location_id = $2 and empty_location and status <> 'closed'`,
      [inventoryId, d.locationId, ctx.user.id],
    );
    const tolerances = await getInventoryTolerances(tx, ctx.user.companyId);
    const [item] = await tx.query<ItemRow>(`select ${ITEM_COLS} from wms.inventory_count_items where id = $1`, [row.id]);
    const result = await registerCount(tx, ctx, c, item, d.countedQty, d.device, tolerances, null);
    await audit(tx, ctx, "inventory.item_added", "inventory", inventoryId, c.code, { ...d });
    return { id: row.id, ...result };
  });
}

// -----------------------------------------------------------------------------
// Submissão, aprovação e recontagem
// -----------------------------------------------------------------------------

const OPEN_STATUSES: ItemStatus[] = ["pending", "counting", "recount"];

/** Pode submeter: todos os itens fecharam (contados) e há ao menos um. */
export async function canSubmitInventory(db: Queryable, companyId: string, inventoryId: string) {
  const [r] = await db.query<{ total: number; open: number; recount: number }>(
    `select count(*)::int as total, (count(*) filter (where status = any($3::text[])))::int as open,
            (count(*) filter (where status = 'recount'))::int as recount
     from wms.inventory_count_items where inventory_id = $1 and company_id = $2`,
    [inventoryId, companyId, OPEN_STATUSES],
  );
  return { total: r.total, open: r.open, recount: r.recount, ready: r.total > 0 && r.open === 0 };
}

/** Submete as diferenças para aprovação. Exige todos os itens fechados nas rodadas. */
export async function submitInventory(ctx: Ctx, inventoryId: string, opts?: OpOptions) {
  assertCan(ctx, "inventory.count");
  return runOperation(ctx, "inventory.submit", opts, async (tx) => {
    const c = await lockCount(tx, ctx, inventoryId);
    if (c.status !== "counting") throw new DomainError(`O inventário ${c.code} não está em contagem.`, "INVALID_STATUS");
    const state = await canSubmitInventory(tx, ctx.user.companyId, inventoryId);
    if (!state.total) throw new DomainError("Inventário sem itens. Inclua os itens encontrados antes de submeter.");
    if (state.recount) throw new DomainError(`Existem ${state.recount} item(ns) aguardando recontagem.`, "INCOMPLETE_COUNT");
    if (state.open) throw new DomainError(`Existem ${state.open} item(ns) sem contagem.`, "INCOMPLETE_COUNT");
    const items = await tx.query<{
      id: string;
      product_id: string;
      sku: string;
      description: string;
      uom: string;
      location_code: string;
      expected_qty: number;
      counted_qty: number;
    }>(
      `select i.id, i.product_id, p.sku, p.description, p.uom, l.code as location_code, i.expected_qty, i.counted_qty
       from wms.inventory_count_items i join erp.products p on p.id = i.product_id join wms.locations l on l.id = i.location_id
       where i.inventory_id = $1 and i.status = 'counted'`,
      [inventoryId],
    );
    let differences = 0;
    for (const i of items) {
      const diff = round3(i.counted_qty - i.expected_qty);
      if (diff === 0) continue;
      differences++;
      const [div] = await tx.query<{ id: string }>(
        `insert into wms.divergences (company_id, source, divergence_type, product_id, quantity, description, inventory_id, created_by)
         values ($1, 'inventory', 'count_difference', $2, $3, $4, $5, $6) returning id`,
        [
          ctx.user.companyId,
          i.product_id,
          Math.abs(diff),
          `${c.code}: ${i.sku} em ${i.location_code} — esperado ${i.expected_qty}, contado ${i.counted_qty} (${diff > 0 ? "+" : ""}${diff}).`,
          inventoryId,
          ctx.user.id,
        ],
      );
      await enqueueIntegrationEvent(tx, ctx, "divergence.registered", "divergence", div.id, {
        source: "inventory",
        inventory_code: c.code,
        location: i.location_code,
        sku: i.sku,
        product: `${i.sku} · ${i.description}`,
        uom: i.uom,
        expected: i.expected_qty,
        counted: i.counted_qty,
        recount: false,
      });
    }
    await tx.query(`update wms.inventory_counts set status = 'submitted', submitted_by = $2, submitted_at = now() where id = $1`, [
      inventoryId,
      ctx.user.id,
    ]);
    const tasks = await tx.query<{ id: string; status: string }>(
      `update wms.tasks t set status = 'completed', completed_at = now(), completed_by = $2, started_at = coalesce(started_at, now())
       from (select id, status from wms.tasks where inventory_id = $1 and status in ('pending', 'in_progress') for update) old
       where t.id = old.id returning t.id, old.status`,
      [inventoryId, ctx.user.id],
    );
    for (const t of tasks) await recordTaskEvent(tx, t.id, ctx.user.id, "completed", t.status, "completed", { differences });
    await audit(tx, ctx, "inventory.submitted", "inventory", inventoryId, c.code, { differences });
    return { id: inventoryId, differences };
  });
}

/** Custo unitário do ajuste: último preço de compra ou média dos preços de compra (parâmetro). */
async function unitCostOf(tx: Queryable, companyId: string, productId: string, source: string): Promise<number | null> {
  const [r] = await tx.query<{ cost: number | null }>(
    source === "average"
      ? `select avg(poi.unit_price) as cost from erp.purchase_order_items poi join erp.purchase_orders po on po.id = poi.purchase_order_id
         where po.company_id = $1 and poi.product_id = $2 and poi.unit_price is not null`
      : `select poi.unit_price as cost from erp.purchase_order_items poi join erp.purchase_orders po on po.id = poi.purchase_order_id
         where po.company_id = $1 and poi.product_id = $2 and poi.unit_price is not null order by po.created_at desc, poi.line_no limit 1`,
    [companyId, productId],
  );
  return r?.cost === null || r?.cost === undefined ? null : Math.round(Number(r.cost) * 10000) / 10000;
}

/**
 * Segregação (A9) e alçada (A3) calculadas no servidor para o usuário atual: a UI
 * troca o botão pelo motivo antes de o usuário tentar aprovar.
 */
async function approvalCheck(db: Queryable, ctx: Ctx, inventoryId: string, status: string) {
  if (!can(ctx.user.role, "inventory.approve")) return { canApprove: false, blockedReason: "Seu perfil não aprova inventários." };
  if (status !== "submitted") return { canApprove: false, blockedReason: null as string | null };
  if (await getSetting(db, ctx.user.companyId, "inventory.segregation_of_duties")) {
    const [row] = await db.query<{ counted: boolean }>(
      `select exists (select 1 from wms.inventory_count_rounds r join wms.inventory_count_items i on i.id = r.inventory_item_id
                        where i.inventory_id = $1 and r.counted_by = $2)
           or exists (select 1 from wms.inventory_count_items where inventory_id = $1 and counted_by = $2)
           or exists (select 1 from wms.audit_log where company_id = $3 and entity_type = 'inventory' and entity_id = $1
                        and user_id = $2 and action in ('inventory.counted', 'inventory.item_added')) as counted`,
      [inventoryId, ctx.user.id, ctx.user.companyId],
    );
    if (row.counted) return { canApprove: false, blockedReason: "Você contou neste inventário. Outro supervisor precisa aprovar." };
  }
  if (ctx.user.role !== "admin") {
    const over = await itemsOverLimit(db, ctx.user.companyId, inventoryId);
    if (over.length) {
      return {
        canApprove: false,
        blockedReason: `Diferença acima da alçada (${over[0].sku}: R$ ${over[0].value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). Aprovação de Administrador.`,
      };
    }
  }
  return { canApprove: true, blockedReason: null };
}

/** Itens fora da tolerância cuja diferença valorizada passa da alçada da classe. */
async function itemsOverLimit(db: Queryable, companyId: string, inventoryId: string) {
  const [tolerances, source] = await Promise.all([getInventoryTolerances(db, companyId), getSetting(db, companyId, "inventory.cost_source")]);
  const items = await db.query<{ product_id: string; sku: string; expected_qty: number; counted_qty: number; abc_class: AbcClass | null }>(
    `select i.product_id, p.sku, i.expected_qty, i.counted_qty, i.abc_class from wms.inventory_count_items i join erp.products p on p.id = i.product_id
     where i.inventory_id = $1 and i.company_id = $2 and i.counted_qty is not null and i.counted_qty <> i.expected_qty and not i.adjusted`,
    [inventoryId, companyId],
  );
  const out: { sku: string; value: number; role: string }[] = [];
  for (const i of items) {
    const tol = tolerances[i.abc_class ?? "C"];
    if (withinTolerance(Number(i.expected_qty), Number(i.counted_qty), tol)) continue;
    const cost = (await unitCostOf(db, companyId, i.product_id, source)) ?? 0;
    const value = Math.abs(Number(i.counted_qty) - Number(i.expected_qty)) * cost;
    if (value > tol.approval_limit_value && tol.approval_role === "admin") out.push({ sku: i.sku, value, role: tol.approval_role });
  }
  return out;
}

/**
 * Aprova e aplica os ajustes (valorizados, com evento por linha ao ERP).
 *  - Modo lock: item cujo saldo mudou desde a foto volta para recontagem (STALE por item)
 *    e o inventário volta para contagem, sem aplicar nada.
 *  - Modo reconcile: esperado ajustado = foto + entradas − saídas desde a foto.
 * Ajustes nunca reduzem abaixo do reservado/bloqueado.
 */
export async function approveInventory(ctx: Ctx, inventoryId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "inventory.approve");
  const d = parse(z.object({ notes: optionalText, reasonCode: optionalText, costCenter: optionalText }), input ?? {});
  return runOperation(ctx, "inventory.approve", opts, async (tx) => {
    const c = await lockCountFull(tx, ctx, inventoryId);
    if (c.status !== "submitted") throw new DomainError(`O inventário ${c.code} não está aguardando aprovação.`, "INVALID_STATUS");
    const check = await approvalCheck(tx, ctx, inventoryId, c.status);
    if (!check.canApprove) {
      const segregation = check.blockedReason?.startsWith("Você contou");
      throw new DomainError(
        segregation
          ? `Segregação de funções: você registrou contagem no inventário ${c.code} e não pode aprová-lo. A aprovação deve ser feita por outro supervisor ou administrador.`
          : (check.blockedReason ?? "Aprovação não permitida."),
        segregation ? "SEGREGATION_OF_DUTIES" : "APPROVAL_LIMIT",
      );
    }
    const costSource = await getSetting(tx, ctx.user.companyId, "inventory.cost_source");
    const items = await tx.query<{
      id: string;
      location_id: string;
      location_code: string;
      product_id: string;
      sku: string;
      lot_code: string;
      expiry_date: string | null;
      expected_qty: number;
      counted_qty: number;
      round: number;
      snapshot_at: string;
    }>(
      `select i.id, i.location_id, l.code as location_code, i.product_id, p.sku, i.lot_code, i.expiry_date::text as expiry_date,
              i.expected_qty, i.counted_qty, i.round, i.snapshot_at::text as snapshot_at
       from wms.inventory_count_items i join erp.products p on p.id = i.product_id join wms.locations l on l.id = i.location_id
       where i.inventory_id = $1 and not i.adjusted and i.status = 'counted' for update of i`,
      [inventoryId],
    );
    // 1) base atual de cada item: lock = foto; reconcile = foto + entradas − saídas desde a foto
    const plan: { item: (typeof items)[number]; expected: number; balance: Awaited<ReturnType<typeof lockBalance>> }[] = [];
    const stale: string[] = [];
    for (const i of items) {
      const balance = await lockBalance(tx, ctx.user.companyId, i.location_id, i.product_id, i.lot_code);
      const current = balance?.quantity ?? 0;
      let expected = Number(i.expected_qty);
      if (c.lock_mode === "reconcile") {
        const [m] = await tx.query<{ inbound: number; outbound: number }>(
          `select coalesce(sum(quantity) filter (where to_location_id = $2), 0) as inbound,
                  coalesce(sum(quantity) filter (where from_location_id = $2), 0) as outbound
           from wms.stock_movements where company_id = $1 and product_id = $3 and lot_code = $4 and created_at > $5::timestamptz
             and (from_location_id = $2 or to_location_id = $2) and not (reference_type = 'inventory' and reference_id = $6)`,
          [ctx.user.companyId, i.location_id, i.product_id, i.lot_code, i.snapshot_at, inventoryId],
        );
        expected = adjustedExpected(expected, Number(m.inbound), Number(m.outbound));
      }
      if (current !== expected) {
        stale.push(i.id);
        continue;
      }
      plan.push({ item: i, expected, balance });
    }
    if (stale.length) {
      // STALE_SNAPSHOT por item: volta para recontagem com nova foto, sem derrubar o inventário
      await tx.query(
        `update wms.inventory_count_items i set status = 'recount', counted_qty = null, counted_by = null, counted_at = null,
                expected_qty = coalesce((select b.quantity from wms.stock_balances b where b.location_id = i.location_id
                                           and b.product_id = i.product_id and b.lot_code = i.lot_code), 0),
                snapshot_at = now(), round = least(i.round + 1, 3)
         where i.id = any($1::uuid[])`,
        [stale],
      );
      await tx.query(`update wms.inventory_counts set status = 'counting', submitted_at = null, submitted_by = null where id = $1`, [inventoryId]);
      await tx.query(
        `update wms.divergences set status = 'resolved', resolution = $3, resolved_by = $2, resolved_at = now()
         where inventory_id = $1 and status = 'open'`,
        [inventoryId, ctx.user.id, `Saldo alterado durante a contagem: itens devolvidos para recontagem.`],
      );
      await createRecountTask(tx, ctx, c, `Recontagem do inventário ${c.code}: saldo alterado durante a contagem (${stale.length} itens).`);
      await audit(tx, ctx, "inventory.stale_items", "inventory", inventoryId, c.code, { items: stale.length });
      return { id: inventoryId, adjustments: 0, stale: stale.length };
    }
    // 2) aplica os ajustes valorizados
    let adjustments = 0;
    for (const { item: i, expected, balance } of plan) {
      const diff = round3(i.counted_qty - expected);
      if (diff !== 0) {
        if (diff < 0) {
          const committed = (balance?.reserved_qty ?? 0) + (balance?.blocked_qty ?? 0);
          if (i.counted_qty < committed) {
            throw new DomainError(
              `${i.sku} em ${i.location_code}: contagem (${i.counted_qty}) abaixo do reservado/bloqueado (${committed}). Trate as reservas antes.`,
            );
          }
          await removeStock(tx, ctx, { balanceId: balance!.id, quantity: -diff });
        } else {
          await addStock(tx, ctx, {
            warehouseId: c.warehouse_id,
            locationId: i.location_id,
            productId: i.product_id,
            lotCode: i.lot_code,
            expiryDate: i.expiry_date,
            quantity: diff,
          });
        }
        const unitCost = await unitCostOf(tx, ctx.user.companyId, i.product_id, costSource);
        const reasonCode = d.reasonCode ?? (diff > 0 ? "INV_SOBRA" : "INV_FALTA");
        await insertMovement(tx, ctx, {
          warehouseId: c.warehouse_id,
          movementType: diff > 0 ? "adjustment_in" : "adjustment_out",
          productId: i.product_id,
          lotCode: i.lot_code,
          expiryDate: i.expiry_date,
          quantity: Math.abs(diff),
          fromLocationId: diff < 0 ? i.location_id : null,
          toLocationId: diff > 0 ? i.location_id : null,
          reason: `Ajuste de inventário ${c.code}${d.notes ? ` — ${d.notes}` : ""}`,
          referenceType: "inventory",
          referenceId: inventoryId,
          referenceCode: c.code,
          unitCost,
          reasonCode,
          costCenter: d.costCenter,
        });
        await postAdjustmentEvent(tx, ctx, {
          inventoryId,
          code: c.code,
          itemId: i.id,
          round: i.round,
          sku: i.sku,
          lot: i.lot_code,
          location: i.location_code,
          quantity: diff,
          unitCost,
          reasonCode,
        });
        adjustments++;
      }
      await tx.query(`update wms.inventory_count_items set adjusted = (counted_qty <> $2), status = 'closed' where id = $1`, [i.id, expected]);
    }
    await tx.query(`update wms.inventory_count_items set status = 'closed' where inventory_id = $1 and status <> 'closed'`, [inventoryId]);
    await tx.query(`delete from wms.inventory_location_locks where inventory_id = $1 and company_id = $2`, [inventoryId, ctx.user.companyId]);
    await tx.query(
      `update wms.divergences set status = 'resolved', resolution = $3, resolved_by = $2, resolved_at = now()
       where inventory_id = $1 and status = 'open'`,
      [inventoryId, ctx.user.id, `Ajuste aprovado no inventário ${c.code}.`],
    );
    await tx.query(
      `update wms.inventory_counts set status = 'approved', approved_by = $2, approved_at = now(), approval_notes = $3 where id = $1`,
      [inventoryId, ctx.user.id, d.notes],
    );
    await audit(tx, ctx, "inventory.approved", "inventory", inventoryId, c.code, { adjustments, notes: d.notes });
    const [stats] = await tx.query<{ items: number; accurate: number; locations: number; warehouse: string; approved_at: string }>(
      `select count(i.id)::int as items, (count(i.id) filter (where i.counted_qty = i.expected_qty))::int as accurate,
              count(distinct i.location_id)::int as locations, w.name as warehouse, now()::text as approved_at
       from wms.inventory_counts c join wms.warehouses w on w.id = c.warehouse_id
       left join wms.inventory_count_items i on i.inventory_id = c.id and i.product_id is not null
       where c.id = $1 group by w.name`,
      [inventoryId],
    );
    await enqueueIntegrationEvent(tx, ctx, "inventory.approved", "inventory", inventoryId, {
      code: c.code,
      warehouse: stats.warehouse,
      approved_at: new Date(stats.approved_at).toISOString(),
      accuracy: stats.items ? Math.round((stats.accurate / stats.items) * 1000) / 10 : 0,
      locations: stats.locations,
      items: stats.items,
      adjustments,
    });
    return { id: inventoryId, adjustments, stale: 0 };
  });
}

/**
 * Evento `inventory.adjustment_posted` (A8): um por linha ajustada, idempotente pela
 * chave inventory_id+item_id+round (não duplica se a aprovação for reprocessada).
 */
async function postAdjustmentEvent(
  tx: Queryable,
  ctx: Ctx,
  e: { inventoryId: string; code: string; itemId: string; round: number; sku: string; lot: string; location: string; quantity: number; unitCost: number | null; reasonCode: string },
) {
  const key = `${e.inventoryId}+${e.itemId}+${e.round}`;
  const [exists] = await tx.query(
    `select 1 from wms.integration_events where company_id = $1 and event_type = 'inventory.adjustment_posted' and payload->>'idempotency_key' = $2`,
    [ctx.user.companyId, key],
  );
  if (exists) return;
  await enqueueIntegrationEvent(tx, ctx, "inventory.adjustment_posted", "inventory", e.inventoryId, {
    idempotency_key: key,
    inventory_code: e.code,
    sku: e.sku,
    lot: e.lot,
    location: e.location,
    quantity: e.quantity,
    unit_cost: e.unitCost,
    value: e.unitCost === null ? null : Math.round(e.quantity * e.unitCost * 100) / 100,
    reason_code: e.reasonCode,
  });
}

async function createRecountTask(tx: Queryable, ctx: Ctx, c: CountHeader, notes: string) {
  const code = await nextCode(tx, ctx.user.companyId, "TAR");
  const [t] = await tx.query<{ id: string }>(
    `insert into wms.tasks (company_id, warehouse_id, code, task_type, priority, inventory_id, notes, created_by)
     values ($1,$2,$3,'inventory',1,$4,$5,$6) returning id`,
    [ctx.user.companyId, c.warehouse_id, code, c.id, notes, ctx.user.id],
  );
  await recordTaskEvent(tx, t.id, ctx.user.id, "created", null, "pending", { recount: true });
}

const recountSchema = z.object({
  itemIds: z.array(uuid("Item")).min(1, "Escolha ao menos um item para recontar."),
  notes: z.string().trim().min(5, "Informe o motivo da recontagem (mínimo de 5 caracteres)."),
});

/**
 * "Devolver itens para recontagem" (substitui a devolução do inventário inteiro): só os
 * itens escolhidos voltam para contagem, com tarefa própria. O inventário volta a "em contagem".
 */
export async function returnItemsForRecount(ctx: Ctx, inventoryId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "inventory.approve");
  const d = parse(recountSchema, input);
  return runOperation(ctx, "inventory.recount", opts, async (tx) => {
    const c = await lockCount(tx, ctx, inventoryId);
    if (!["submitted", "counting"].includes(c.status)) throw new DomainError(`O inventário ${c.code} já foi encerrado.`, "INVALID_STATUS");
    const rows = await tx.query<{ id: string }>(
      `update wms.inventory_count_items set status = 'recount', counted_qty = null, counted_by = null, counted_at = null,
              round = least(round + 1, 3)
       where inventory_id = $1 and company_id = $2 and id = any($3::uuid[]) and status in ('counted', 'counting') and not adjusted
       returning id`,
      [inventoryId, ctx.user.companyId, d.itemIds],
    );
    if (rows.length !== d.itemIds.length) throw new DomainError("Algum item escolhido não pode voltar para recontagem.", "INVALID_ITEM");
    await tx.query(
      `update wms.divergences set status = 'resolved', resolution = $3, resolved_by = $2, resolved_at = now()
       where inventory_id = $1 and status = 'open'`,
      [inventoryId, ctx.user.id, `Itens devolvidos para recontagem: ${d.notes}`],
    );
    await tx.query(`update wms.inventory_counts set status = 'counting', submitted_at = null, submitted_by = null where id = $1`, [inventoryId]);
    await createRecountTask(tx, ctx, c, `Recontagem do inventário ${c.code} (${rows.length} itens): ${d.notes}`);
    await audit(tx, ctx, "inventory.rejected", "inventory", inventoryId, c.code, { ...d, items: rows.length });
    return { id: inventoryId, items: rows.length };
  });
}

/** Compatibilidade: devolve para recontagem todos os itens com diferença. */
export async function rejectInventory(ctx: Ctx, inventoryId: string, input: unknown) {
  assertCan(ctx, "inventory.approve");
  const d = parse(z.object({ notes: z.string().trim().min(5, "Informe o motivo da recontagem.") }), input);
  const [c] = await ctx.db.query<{ status: string }>(`select status from wms.inventory_counts where id = $1 and company_id = $2`, [
    inventoryId,
    ctx.user.companyId,
  ]);
  if (!c) throw new NotFoundError("Inventário");
  if (c.status !== "submitted") {
    const [h] = await ctx.db.query<{ code: string }>(`select code from wms.inventory_counts where id = $1`, [inventoryId]);
    throw new DomainError(`O inventário ${h.code} não está aguardando aprovação.`, "INVALID_STATUS");
  }
  const items = await ctx.db.query<{ id: string }>(
    `select id from wms.inventory_count_items where inventory_id = $1 and company_id = $2 and status = 'counted'
       and counted_qty <> expected_qty and not adjusted`,
    [inventoryId, ctx.user.companyId],
  );
  const all = items.length
    ? items
    : await ctx.db.query<{ id: string }>(`select id from wms.inventory_count_items where inventory_id = $1 and status = 'counted' and not adjusted`, [
        inventoryId,
      ]);
  return returnItemsForRecount(ctx, inventoryId, { itemIds: all.map((i) => i.id), notes: d.notes });
}

export async function cancelInventory(ctx: Ctx, inventoryId: string, input: unknown) {
  assertCan(ctx, "inventory.create");
  const d = parse(z.object({ reason: z.string().trim().min(5, "Informe o motivo do cancelamento.") }), input);
  return runOperation(ctx, "inventory.cancel", undefined, async (tx) => {
    const c = await lockCount(tx, ctx, inventoryId);
    if (!["counting", "submitted"].includes(c.status)) throw new DomainError("Inventário já encerrado.", "INVALID_STATUS");
    await tx.query(`update wms.inventory_counts set status = 'cancelled' where id = $1`, [inventoryId]);
    await tx.query(`delete from wms.inventory_location_locks where inventory_id = $1 and company_id = $2`, [inventoryId, ctx.user.companyId]);
    await tx.query(
      `update wms.divergences set status = 'resolved', resolution = $3, resolved_by = $2, resolved_at = now()
       where inventory_id = $1 and status = 'open'`,
      [inventoryId, ctx.user.id, `Inventário cancelado: ${d.reason}`],
    );
    const tasks = await tx.query<{ id: string; status: string }>(
      `update wms.tasks t set status = 'cancelled', cancelled_at = now(), cancel_reason = $2
       from (select id, status from wms.tasks where inventory_id = $1 and status in ('pending', 'in_progress') for update) old
       where t.id = old.id returning t.id, old.status`,
      [inventoryId, d.reason],
    );
    for (const t of tasks) await recordTaskEvent(tx, t.id, ctx.user.id, "cancelled", t.status, "cancelled", d);
    await audit(tx, ctx, "inventory.cancelled", "inventory", inventoryId, c.code, d);
    return { id: inventoryId };
  });
}

/**
 * Mapa e KPIs: enquanto o inventário está em contagem, quem não pode aprovar (operador)
 * não vê o saldo esperado nem a diferença. A folha de contagem (getInventory) é cega
 * para todos durante a contagem (A4).
 */
export function isBlindCount(ctx: Ctx, status: string) {
  return status === "counting" && !can(ctx.user.role, "inventory.approve");
}

/**
 * Dados do mapa do CD para a tela de contagem: todos os endereços não inativos do depósito
 * do inventário com a situação de contagem de cada um (ver `buildCdMap` para a geometria).
 */
export async function getInventoryMap(ctx: Ctx, inventoryId: string) {
  const [c] = await ctx.db.query<{ id: string; status: string; warehouse_id: string; rejected_at: number | null }>(
    `select c.id, c.status, c.warehouse_id,
            (select extract(epoch from max(a.created_at)) * 1000 from wms.audit_log a where a.entity_type = 'inventory' and a.entity_id = c.id
              and a.action = 'inventory.rejected') as rejected_at
     from wms.inventory_counts c where c.id = $1 and c.company_id = $2`,
    [inventoryId, ctx.user.companyId],
  );
  if (!c || !hasWarehouseAccess(ctx, c.warehouse_id)) return null;
  const [locations, items] = await Promise.all([
    ctx.db.query<MapLocationInput>(
      `select l.id, l.code, l.zone_id, z.code as zone_code, z.name as zone_name, z.zone_type, l.aisle, l.bay, l.level, l.position,
              l.location_type, l.status, l.capacity_units, l.max_weight_kg,
              (select coalesce(sum(b.quantity), 0) from wms.stock_balances b where b.location_id = l.id) as on_hand_units,
              (select coalesce(sum(b.quantity * coalesce(p.weight_kg, 0)), 0) from wms.stock_balances b join erp.products p on p.id = b.product_id
                where b.location_id = l.id) as on_hand_kg,
              (select extract(epoch from max(i.counted_at)) * 1000 from wms.inventory_count_items i join wms.inventory_counts ic on ic.id = i.inventory_id
                where i.location_id = l.id and ic.status <> 'cancelled' and ic.id <> $3) as last_counted_at
       from wms.locations l join wms.zones z on z.id = l.zone_id
       where l.company_id = $1 and l.warehouse_id = $2 and (l.status <> 'inactive'
         or exists (select 1 from wms.inventory_count_items i where i.inventory_id = $3 and i.location_id = l.id))
       order by z.code, l.code`,
      [ctx.user.companyId, c.warehouse_id, inventoryId],
    ),
    ctx.db.query<MapItemInput>(
      `select i.id, i.location_id, coalesce(p.sku, '—') as sku, p.barcode, coalesce(p.description, 'Endereço vazio') as description,
              coalesce(p.uom, 'un') as uom, i.lot_code, i.expiry_date::text as expiry_date, i.expected_qty,
              i.counted_qty, u.name as counted_by_name, extract(epoch from i.counted_at) * 1000 as counted_at, i.notes, i.adjusted,
              i.status, i.round, i.empty_location, i.stock_origin,
              (select uk.name from wms.inventory_location_locks k join wms.users uk on uk.id = k.locked_by
                where k.location_id = i.location_id and k.inventory_id = i.inventory_id) as locked_by_name,
              (select extract(epoch from k.locked_at) * 1000 from wms.inventory_location_locks k
                where k.location_id = i.location_id and k.inventory_id = i.inventory_id) as locked_at
       from wms.inventory_count_items i left join erp.products p on p.id = i.product_id left join wms.users u on u.id = i.counted_by
       where i.inventory_id = $1 and i.company_id = $2 order by p.sku nulls first, i.lot_code`,
      [inventoryId, ctx.user.companyId],
    ),
  ]);
  return buildCdMap({ locations, items, blind: isBlindCount(ctx, c.status), rejectedAt: c.status === "counting" ? c.rejected_at : null });
}

/**
 * KPIs de acuracidade do inventário (ver `computeInventoryKpis`): itens do inventário com o
 * último preço de compra do produto e os inventários aprovados do mesmo depósito (ciclos).
 */
export async function getInventoryKpis(ctx: Ctx, inventoryId: string) {
  const [c] = await ctx.db.query<{ id: string; status: string; warehouse_id: string }>(
    `select id, status, warehouse_id from wms.inventory_counts where id = $1 and company_id = $2`,
    [inventoryId, ctx.user.companyId],
  );
  if (!c || !hasWarehouseAccess(ctx, c.warehouse_id)) return null;
  const [items, history, target] = await Promise.all([
    ctx.db.query<KpiItemInput>(
      `select i.location_id, z.code as zone_code, z.name as zone_name, i.expected_qty, i.counted_qty,
              extract(epoch from i.counted_at) * 1000 as counted_at,
              (select poi.unit_price from erp.purchase_order_items poi join erp.purchase_orders po on po.id = poi.purchase_order_id
                where poi.product_id = i.product_id and poi.unit_price is not null order by po.created_at desc, poi.line_no limit 1) as unit_price
       from wms.inventory_count_items i join wms.locations l on l.id = i.location_id join wms.zones z on z.id = l.zone_id
       where i.inventory_id = $1`,
      [inventoryId],
    ),
    ctx.db.query<CycleInput>(
      `select c.id, c.code, extract(epoch from c.approved_at) * 1000 as closed_at, count(i.id) as items,
              count(i.id) filter (where i.counted_qty = i.expected_qty) as accurate,
              count(i.id) filter (where i.counted_qty <> i.expected_qty) as divergences
       from wms.inventory_counts c join wms.inventory_count_items i on i.inventory_id = c.id
       where c.company_id = $1 and c.warehouse_id = $2 and c.status = 'approved'
       group by c.id order by c.approved_at desc limit 12`,
      [ctx.user.companyId, c.warehouse_id],
    ),
    getSetting(ctx.db, ctx.user.companyId, "inventory.accuracy_target"),
  ]);
  return computeInventoryKpis({ status: c.status, blind: isBlindCount(ctx, c.status), items, history, currentId: c.id, target });
}

// -----------------------------------------------------------------------------
// Rotativo automático por ABC (A7)
// -----------------------------------------------------------------------------

export async function getCyclePlans(db: Queryable, companyId: string): Promise<Record<AbcClass, number>> {
  const rows = await db.query<{ abc_class: AbcClass; frequency_days: number }>(
    `select abc_class, frequency_days from wms.cycle_count_plans where company_id = $1`,
    [companyId],
  );
  const out = { ...DEFAULT_CYCLE_DAYS };
  for (const r of rows) out[r.abc_class] = Number(r.frequency_days);
  return out;
}

interface DueLocation {
  location_id: string;
  code: string;
  abc: AbcClass;
  last_counted: string | null;
  due: string;
}

const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Calendário: cada endereço com saldo tem a classe do seu produto mais giratório
 * (A > B > C); a próxima contagem é a última contagem aprovada + frequência da classe
 * (nunca contado = hoje). Devolve os próximos `days` dias.
 */
async function dueLocations(ctx: Ctx, warehouseId: string): Promise<DueLocation[]> {
  const [abc, plans] = await Promise.all([abcByProduct(ctx), getCyclePlans(ctx.db, ctx.user.companyId)]);
  const rows = await ctx.db.query<{ location_id: string; code: string; product_ids: string[]; last_counted: string | null }>(
    `select l.id as location_id, l.code, array_agg(distinct b.product_id) as product_ids,
            (select max(i.counted_at)::text from wms.inventory_count_items i join wms.inventory_counts c on c.id = i.inventory_id
              where i.location_id = l.id and c.status = 'approved') as last_counted
     from wms.locations l join wms.stock_balances b on b.location_id = l.id and b.quantity > 0
     where l.company_id = $1 and l.warehouse_id = $2 and l.status = 'active'
     group by l.id, l.code order by l.code`,
    [ctx.user.companyId, warehouseId],
  );
  const rank = { A: 0, B: 1, C: 2 } as const;
  const today = Date.parse(`${isoDay(Date.now())}T00:00:00Z`);
  return rows.map((r) => {
    const cls = r.product_ids.map((p) => abc.get(p) ?? "C").sort((a, b) => rank[a] - rank[b])[0] ?? "C";
    const last = r.last_counted ? Date.parse(r.last_counted) : null;
    const due = last === null ? today : Math.max(today, Date.parse(`${isoDay(last)}T00:00:00Z`) + plans[cls] * DAY);
    return { location_id: r.location_id, code: r.code, abc: cls, last_counted: r.last_counted, due: isoDay(due) };
  });
}

async function assertOwnWarehouse(db: Queryable, ctx: Ctx, warehouseId: string) {
  assertWarehouseAccess(ctx, warehouseId);
  const [wh] = await db.query(`select 1 from wms.warehouses where id = $1 and company_id = $2`, [warehouseId, ctx.user.companyId]);
  if (!wh) throw new NotFoundError("Depósito");
}

/** Inventário › Calendário: endereços previstos por dia nos próximos 30 dias. */
export async function getCycleCalendar(ctx: Ctx, warehouseId: string, days = 30) {
  assertCan(ctx, "inventory.create");
  parse(uuid("Depósito"), warehouseId);
  await assertOwnWarehouse(ctx.db, ctx, warehouseId);
  const due = await dueLocations(ctx, warehouseId);
  const today = Date.parse(`${isoDay(Date.now())}T00:00:00Z`);
  const calendar = Array.from({ length: days }, (_, k) => {
    const date = isoDay(today + k * DAY);
    const list = due.filter((d) => d.due === date);
    return { date, total: list.length, byClass: { A: list.filter((d) => d.abc === "A").length, B: list.filter((d) => d.abc === "B").length, C: list.filter((d) => d.abc === "C").length } };
  });
  const [generated] = await ctx.db.query<{ id: string; code: string }>(
    `select id, code from wms.inventory_counts where company_id = $1 and warehouse_id = $2 and origin = 'calendar'
       and plan_date = current_date and status <> 'cancelled'`,
    [ctx.user.companyId, warehouseId],
  );
  return { calendar, plans: await getCyclePlans(ctx.db, ctx.user.companyId), todayInventory: generated ?? null };
}

/**
 * "Gerar contagens de hoje": um inventário rotativo (origem calendário) com os endereços
 * vencidos. Idempotente por dia e depósito: chamar de novo devolve o mesmo inventário.
 */
export async function generateCycleCounts(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "inventory.create");
  const d = parse(z.object({ warehouseId: uuid("Depósito") }), input);
  await assertOwnWarehouse(ctx.db, ctx, d.warehouseId);
  const due = await dueLocations(ctx, d.warehouseId);
  const today = isoDay(Date.now());
  const ids = due.filter((x) => x.due <= today).map((x) => x.location_id);
  const abc = await abcByProduct(ctx);
  return runOperation(ctx, "inventory.cycle_generate", opts, async (tx) => {
    const [existing] = await tx.query<{ id: string; code: string }>(
      `select id, code from wms.inventory_counts where company_id = $1 and warehouse_id = $2 and origin = 'calendar'
         and plan_date = $3::date and status <> 'cancelled'`,
      [ctx.user.companyId, d.warehouseId, today],
    );
    if (existing) return { id: existing.id, code: existing.code, locations: 0, created: false };
    if (!ids.length) return { id: null, code: null, locations: 0, created: false };
    const { c, code, inserted } = await openInventory(tx, ctx, {
      warehouseId: d.warehouseId,
      countType: "cyclic",
      zoneId: null,
      locationId: null,
      productId: null,
      locationIds: ids,
      notes: "Gerado pelo calendário do rotativo (curva ABC).",
      origin: "calendar",
      planDate: today,
      referenceDate: null,
      scopeLabel: `Calendário ${today.split("-").reverse().join("/")} (${ids.length} end.)`,
      abc,
    });
    await audit(tx, ctx, "inventory.created", "inventory", c.id, code, { origin: "calendar", locations: ids.length, items: inserted });
    return { id: c.id, code, locations: ids.length, created: true };
  });
}

/**
 * Gatilhos do rotativo (A7): endereço zerado na separação, falta no picking ou
 * divergência no recebimento abrem uma contagem rotativa do endereço — se ainda não
 * houver uma aberta para ele. Roda dentro da transação do fluxo de origem.
 */
export async function triggerLocationCount(
  tx: Queryable,
  ctx: Ctx,
  args: { warehouseId: string; locationId: string; reason: "zeroed" | "pick_shortage" | "receiving_divergence" },
) {
  const [open] = await tx.query(
    `select 1 from wms.inventory_count_items i join wms.inventory_counts c on c.id = i.inventory_id
     where c.company_id = $1 and i.location_id = $2 and c.status in ('counting', 'submitted') limit 1`,
    [ctx.user.companyId, args.locationId],
  );
  if (open) return null;
  const label = { zeroed: "endereço zerado na separação", pick_shortage: "falta na separação", receiving_divergence: "divergência no recebimento" }[
    args.reason
  ];
  const [loc] = await tx.query<{ code: string }>(`select code from wms.locations where id = $1 and company_id = $2`, [args.locationId, ctx.user.companyId]);
  if (!loc) return null;
  const { c, code } = await openInventory(tx, ctx, {
    warehouseId: args.warehouseId,
    countType: "cyclic",
    zoneId: null,
    locationId: args.locationId,
    productId: null,
    locationIds: null,
    notes: `Contagem automática: ${label}.`,
    origin: "trigger",
    planDate: null,
    referenceDate: null,
    scopeLabel: `${loc.code} · ${label}`,
    abc: new Map(),
  });
  await audit(tx, ctx, "inventory.created", "inventory", c.id, code, { origin: "trigger", reason: args.reason, location: loc.code });
  return { id: c.id, code };
}

// -----------------------------------------------------------------------------
// Fechamento de período (A12): registro de inventário por data de referência (Bloco H)
// -----------------------------------------------------------------------------

export async function inventoryRegister(ctx: Ctx, referenceDate: string) {
  assertCan(ctx, "inventory.approve");
  const date = parse(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data de referência inválida."), referenceDate);
  const source = await getSetting(ctx.db, ctx.user.companyId, "inventory.cost_source");
  const rows = await ctx.db.query<{ product_id: string; sku: string; description: string; uom: string; quantity: number }>(
    `select p.id as product_id, p.sku, p.description, p.uom, sum(i.counted_qty) as quantity
     from wms.inventory_count_items i join wms.inventory_counts c on c.id = i.inventory_id join erp.products p on p.id = i.product_id
     where c.company_id = $1 and c.status = 'approved' and c.reference_date = $2::date
     group by p.id, p.sku, p.description, p.uom order by p.sku`,
    [ctx.user.companyId, date],
  );
  const lines = [];
  for (const r of rows) {
    const unit = (await unitCostOf(ctx.db, ctx.user.companyId, r.product_id, source)) ?? 0;
    lines.push({ sku: r.sku, description: r.description, uom: r.uom, quantity: Number(r.quantity), unitCost: unit, value: Math.round(Number(r.quantity) * unit * 100) / 100 });
  }
  return { referenceDate: date, lines, total: Math.round(lines.reduce((s, l) => s + l.value, 0) * 100) / 100 };
}

/** CSV no layout do registro H010 (código, unidade, quantidade, valor unitário, valor do item, indicador de propriedade). */
export function inventoryRegisterCsv(reg: Awaited<ReturnType<typeof inventoryRegister>>): string {
  const n = (v: number, d: number) => v.toFixed(d).replace(".", ",");
  const head = "REG;COD_ITEM;DESCRICAO;UNID;QTD;VL_UNIT;VL_ITEM;IND_PROP;DT_INV";
  const dt = reg.referenceDate.split("-").reverse().join("");
  const body = reg.lines.map((l) =>
    ["H010", l.sku, `"${l.description.replace(/"/g, '""')}"`, l.uom, n(l.quantity, 3), n(l.unitCost, 6), n(l.value, 2), "0", dt].join(";"),
  );
  return [head, ...body, `H005;;;;;;${n(reg.total, 2)};;${dt}`].join("\n") + "\n";
}
