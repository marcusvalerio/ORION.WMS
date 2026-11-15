import "server-only";
import { z } from "zod";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError, NotFoundError } from "../errors";
import { parse, uuid, qty, nonNegQty, checkbox } from "../validation";
import { audit, nextCode, recordTaskEvent, round3, runOperation, type OpOptions } from "./common";
import { addStock, availableOf, insertMovement, lockBalance, removeStock, validateDestination } from "./stock-core";

/**
 * Reposição de picking. Cada endereço de zona de picking pode ter um produto com
 * mínimo/máximo. Quando o saldo disponível do produto no endereço cai abaixo do
 * mínimo, uma tarefa de reposição (task_type 'replenishment') é gerada a partir
 * da armazenagem (pulmão), em ordem FEFO, para completar até o máximo. Nunca há
 * duas tarefas abertas para o mesmo endereço (índice único parcial no banco).
 */

export interface ReplenishmentSettingRow {
  id: string;
  warehouse_id: string;
  warehouse_code: string;
  location_id: string;
  location_code: string;
  product_id: string;
  sku: string;
  description: string;
  min_qty: number;
  max_qty: number;
  active: boolean;
  current_qty: number;
  available_qty: number;
  open_task_id: string | null;
  open_task_code: string | null;
  open_task_qty: number | null;
  open_task_emergency: boolean | null;
}

export async function listReplenishmentSettings(ctx: Ctx) {
  return ctx.db.query<ReplenishmentSettingRow>(
    `select s.id, s.warehouse_id, w.code as warehouse_code, s.location_id, l.code as location_code, s.product_id, p.sku, p.description,
            s.min_qty, s.max_qty, s.active,
            coalesce((select sum(b.quantity) from wms.stock_balances b where b.location_id = s.location_id and b.product_id = s.product_id), 0) as current_qty,
            coalesce((select sum(b.quantity - b.reserved_qty - b.blocked_qty) from wms.stock_balances b
                      where b.location_id = s.location_id and b.product_id = s.product_id), 0) as available_qty,
            t.id as open_task_id, t.code as open_task_code, t.quantity as open_task_qty, t.emergency as open_task_emergency
     from wms.replenishment_settings s
     join wms.warehouses w on w.id = s.warehouse_id join wms.locations l on l.id = s.location_id join erp.products p on p.id = s.product_id
     left join wms.tasks t on t.to_location_id = s.location_id and t.task_type = 'replenishment' and t.status in ('pending', 'in_progress')
     where s.company_id = $1
     order by s.active desc, l.code`,
    [ctx.user.companyId],
  );
}

/** Endereços ativos de zonas de picking (para o cadastro de mín./máx.). */
export async function listPickingLocations(ctx: Ctx) {
  return ctx.db.query<{ id: string; code: string; warehouse_id: string; capacity_units: number }>(
    `select l.id, l.code, l.warehouse_id, l.capacity_units from wms.locations l join wms.zones z on z.id = l.zone_id
     where l.company_id = $1 and z.zone_type = 'picking' and l.status = 'active' and z.active order by l.code`,
    [ctx.user.companyId],
  );
}

const settingSchema = z.object({
  locationId: uuid("Endereço de picking"),
  productId: uuid("Produto"),
  minQty: nonNegQty("Mínimo"),
  maxQty: qty("Máximo"),
  active: checkbox.optional(),
});

export async function saveReplenishmentSetting(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "replenishment.manage");
  const raw = (input ?? {}) as Record<string, unknown>;
  const d = parse(settingSchema, { ...raw, active: raw.active === undefined ? true : raw.active });
  if (d.maxQty <= d.minQty) throw new DomainError("O máximo deve ser maior que o mínimo.", "VALIDATION", "maxQty");
  return runOperation(ctx, "replenishment.setting", opts, async (tx) => {
    const [loc] = await tx.query<{ id: string; code: string; warehouse_id: string; zone_type: string; capacity_units: number }>(
      `select l.id, l.code, l.warehouse_id, z.zone_type, l.capacity_units from wms.locations l join wms.zones z on z.id = l.zone_id
       where l.id = $1 and l.company_id = $2 for update of l`,
      [d.locationId, ctx.user.companyId],
    );
    if (!loc) throw new NotFoundError("Endereço");
    if (loc.zone_type !== "picking") throw new DomainError(`O endereço ${loc.code} não pertence a uma zona de picking.`, "VALIDATION");
    if (d.maxQty > loc.capacity_units) {
      throw new DomainError(`O máximo (${d.maxQty}) excede a capacidade do endereço (${loc.capacity_units} un).`, "VALIDATION", "maxQty");
    }
    const [p] = await tx.query(`select 1 from erp.products where id = $1 and company_id = $2`, [d.productId, ctx.user.companyId]);
    if (!p) throw new NotFoundError("Produto");
    if (d.active) {
      const [other] = await tx.query<{ sku: string }>(
        `select p.sku from wms.replenishment_settings s join erp.products p on p.id = s.product_id
         where s.location_id = $1 and s.active and s.product_id <> $2`,
        [d.locationId, d.productId],
      );
      if (other) throw new DomainError(`O endereço ${loc.code} já abastece o produto ${other.sku}. Desative a configuração anterior.`);
    }
    const [row] = await tx.query<{ id: string }>(
      `insert into wms.replenishment_settings (company_id, warehouse_id, location_id, product_id, min_qty, max_qty, active, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (location_id, product_id) do update set min_qty = excluded.min_qty, max_qty = excluded.max_qty,
         active = excluded.active, updated_by = excluded.updated_by, updated_at = now()
       returning id`,
      [ctx.user.companyId, loc.warehouse_id, d.locationId, d.productId, d.minQty, d.maxQty, d.active, ctx.user.id],
    );
    await audit(tx, ctx, "replenishment.setting_saved", "replenishment_setting", row.id, loc.code, d);
    return { id: row.id };
  });
}

interface SettingForCheck {
  id: string;
  warehouse_id: string;
  location_id: string;
  location_code: string;
  product_id: string;
  min_qty: number;
  max_qty: number;
}

/**
 * Verifica as configurações ativas (opcionalmente filtradas por produto) e gera
 * as tarefas de reposição necessárias. Deve ser chamada dentro de uma transação.
 */
export async function checkReplenishmentTx(
  tx: Queryable,
  ctx: Ctx,
  f: { warehouseId?: string | null; productIds?: string[] | null } = {},
): Promise<string[]> {
  const settings = await tx.query<SettingForCheck>(
    `select s.id, s.warehouse_id, s.location_id, l.code as location_code, s.product_id, s.min_qty, s.max_qty
     from wms.replenishment_settings s join wms.locations l on l.id = s.location_id join wms.zones z on z.id = l.zone_id
     where s.company_id = $1 and s.active and l.status = 'active' and z.active
       and ($2::uuid is null or s.warehouse_id = $2) and ($3::uuid[] is null or s.product_id = any($3::uuid[]))
     order by l.code`,
    [ctx.user.companyId, f.warehouseId ?? null, f.productIds && f.productIds.length ? f.productIds : null],
  );
  const created: string[] = [];
  for (const s of settings) {
    const code = await replenishLocation(tx, ctx, s, false);
    if (code) created.push(code);
  }
  return created;
}

/**
 * Gera (ou, na emergência, prioriza) a reposição de um endereço. Retorna o código
 * da tarefa criada, ou null se não for necessária/possível.
 */
async function replenishLocation(tx: Queryable, ctx: Ctx, s: SettingForCheck, emergency: boolean): Promise<string | null> {
  // Lock do endereço de picking: serializa verificações concorrentes do mesmo endereço.
  await tx.query(`select id from wms.locations where id = $1 for update`, [s.location_id]);
  const [open] = await tx.query<{ id: string; code: string; status: string; emergency: boolean; priority: number }>(
    `select id, code, status, emergency, priority from wms.tasks
     where to_location_id = $1 and task_type = 'replenishment' and status in ('pending', 'in_progress') for update`,
    [s.location_id],
  );
  if (open) {
    if (emergency && !open.emergency) {
      await tx.query(`update wms.tasks set emergency = true, priority = 1, version = version + 1 where id = $1`, [open.id]);
      await recordTaskEvent(tx, open.id, ctx.user.id, "escalated", open.status, open.status, { emergency: true });
    }
    return null;
  }
  const [level] = await tx.query<{ available: number; occupied: number; capacity: number }>(
    `select coalesce((select sum(b.quantity - b.reserved_qty - b.blocked_qty) from wms.stock_balances b
                      where b.location_id = l.id and b.product_id = $2), 0) as available,
            coalesce((select sum(b.quantity) from wms.stock_balances b where b.location_id = l.id), 0) as occupied,
            l.capacity_units as capacity
     from wms.locations l where l.id = $1`,
    [s.location_id, s.product_id],
  );
  if (!emergency && level.available >= s.min_qty) return null;
  const need = round3(Math.min(s.max_qty - level.available, level.capacity - level.occupied));
  if (need <= 0) return null;
  // Origem: pulmão (zona de armazenagem), FEFO, não vencido, com saldo disponível.
  const [source] = await tx.query<{ id: string; location_id: string; lot_code: string; expiry_date: string | null; available: number }>(
    `select b.id, b.location_id, b.lot_code, b.expiry_date::text as expiry_date, b.quantity - b.reserved_qty - b.blocked_qty as available
     from wms.stock_balances b join wms.locations l on l.id = b.location_id join wms.zones z on z.id = l.zone_id
     where b.company_id = $1 and b.warehouse_id = $2 and b.product_id = $3 and z.zone_type = 'storage' and z.active
       and l.status = 'active' and (b.expiry_date is null or b.expiry_date >= current_date)
       and b.quantity - b.reserved_qty - b.blocked_qty > 0
     order by b.expiry_date asc nulls last, b.quantity asc, l.code limit 1`,
    [ctx.user.companyId, s.warehouse_id, s.product_id],
  );
  if (!source) return null;
  const quantity = round3(Math.min(need, source.available));
  const code = await nextCode(tx, ctx.user.companyId, "TAR");
  const [t] = await tx.query<{ id: string }>(
    `insert into wms.tasks (company_id, warehouse_id, code, task_type, priority, product_id, lot_code, expiry_date, quantity,
                            from_location_id, to_location_id, emergency, notes, created_by)
     values ($1,$2,$3,'replenishment',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [
      ctx.user.companyId,
      s.warehouse_id,
      code,
      emergency ? 1 : 2,
      s.product_id,
      source.lot_code,
      source.expiry_date,
      quantity,
      source.location_id,
      s.location_id,
      emergency,
      emergency
        ? `Reposição de emergência: falta encontrada na separação em ${s.location_code}.`
        : `Reposição automática: disponível ${level.available} abaixo do mínimo ${s.min_qty} (máximo ${s.max_qty}).`,
      ctx.user.id,
    ],
  );
  await recordTaskEvent(tx, t.id, ctx.user.id, "created", null, "pending", { emergency, quantity });
  await audit(tx, ctx, emergency ? "replenishment.emergency" : "replenishment.created", "task", t.id, code, {
    location: s.location_code,
    quantity,
  });
  return code;
}

/**
 * Reposição de emergência: a separação encontrou falta em um endereço de picking.
 * Se houver configuração para o endereço/produto e saldo no pulmão, gera (ou
 * escalona para alta prioridade) a tarefa de reposição, independentemente do mínimo.
 */
export async function emergencyReplenishmentTx(tx: Queryable, ctx: Ctx, locationId: string, productId: string): Promise<string | null> {
  const [s] = await tx.query<SettingForCheck>(
    `select s.id, s.warehouse_id, s.location_id, l.code as location_code, s.product_id, s.min_qty, s.max_qty
     from wms.replenishment_settings s join wms.locations l on l.id = s.location_id join wms.zones z on z.id = l.zone_id
     where s.company_id = $1 and s.location_id = $2 and s.product_id = $3 and s.active and z.zone_type = 'picking'`,
    [ctx.user.companyId, locationId, productId],
  );
  if (!s) return null;
  return replenishLocation(tx, ctx, s, true);
}

/** Botão "Verificar reposição". */
export async function runReplenishmentCheck(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "replenishment.manage");
  const d = parse(z.object({ warehouseId: z.string().uuid().nullish().or(z.literal("").transform(() => null)) }), input ?? {});
  return runOperation(ctx, "replenishment.check", opts, async (tx) => {
    if (d.warehouseId) {
      const [wh] = await tx.query(`select 1 from wms.warehouses where id = $1 and company_id = $2`, [d.warehouseId, ctx.user.companyId]);
      if (!wh) throw new NotFoundError("Depósito");
    }
    const tasks = await checkReplenishmentTx(tx, ctx, { warehouseId: d.warehouseId ?? null });
    await audit(tx, ctx, "replenishment.checked", "replenishment_setting", null, null, { tasks });
    return { tasks };
  });
}

interface ReplenishmentTask {
  id: string;
  code: string;
  warehouse_id: string;
  product_id: string | null;
  lot_code: string;
  quantity: number | null;
  from_location_id: string | null;
  to_location_id: string | null;
}

/**
 * Executa a reposição: retira do pulmão (somente saldo disponível) e entra no
 * endereço de picking. Permite confirmar quantidade menor (saldo consumido por
 * outra operação entre a geração e a execução); maior que a tarefa, não.
 */
export async function completeReplenishmentTx(tx: Queryable, ctx: Ctx, t: ReplenishmentTask, confirmedInput: number | null) {
  const planned = t.quantity!;
  const q = confirmedInput ?? planned;
  if (q <= 0) throw new DomainError("Informe a quantidade reposta.", "VALIDATION", "quantity");
  if (q > planned) throw new DomainError(`Quantidade reposta (${q}) maior que a planejada (${planned}).`, "OVER_PICK");
  const origin = await lockBalance(tx, ctx.user.companyId, t.from_location_id!, t.product_id!, t.lot_code);
  if (!origin || availableOf(origin) < q) {
    throw new DomainError(
      `Saldo disponível insuficiente no pulmão: disponível ${origin ? availableOf(origin) : 0}, solicitado ${q}.`,
      "INSUFFICIENT_STOCK",
    );
  }
  await validateDestination(tx, ctx, {
    locationId: t.to_location_id!,
    warehouseId: t.warehouse_id,
    productId: t.product_id!,
    quantity: q,
    excludeTaskId: t.id,
  });
  await removeStock(tx, ctx, { balanceId: origin.id, quantity: q, requireAvailable: true });
  await addStock(tx, ctx, {
    warehouseId: t.warehouse_id,
    locationId: t.to_location_id!,
    productId: t.product_id!,
    lotCode: t.lot_code,
    expiryDate: origin.expiry_date,
    quantity: q,
  });
  const movementId = await insertMovement(tx, ctx, {
    warehouseId: t.warehouse_id,
    movementType: "replenishment",
    productId: t.product_id!,
    lotCode: t.lot_code,
    expiryDate: origin.expiry_date,
    quantity: q,
    fromLocationId: t.from_location_id,
    toLocationId: t.to_location_id,
    reason: "Reposição de picking",
    referenceType: "task",
    referenceId: t.id,
    referenceCode: t.code,
    taskId: t.id,
  });
  // Séries conhecidas acompanham o saldo movido (mesmo produto/endereço de origem).
  await tx.query(
    `with moved as (
       update wms.serial_numbers set location_id = $3, updated_at = now()
       where id in (select id from wms.serial_numbers where product_id = $1 and location_id = $2 and status = 'in_stock'
                    order by serial limit $4)
       returning id)
     insert into wms.movement_serials (movement_id, serial_id) select $5, id from moved`,
    [t.product_id, t.from_location_id, t.to_location_id, Math.floor(q), movementId],
  );
  return { confirmed: q, destination: t.to_location_id! };
}
