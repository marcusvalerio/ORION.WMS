import "server-only";
import { z } from "zod";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError, NotFoundError } from "../errors";
import { parse, uuid, optionalText } from "../validation";
import { audit, runOperation, type OpOptions } from "./common";

// -----------------------------------------------------------------------------
// Depósitos
// -----------------------------------------------------------------------------

export interface WarehouseSummary {
  id: string;
  code: string;
  name: string;
  address: string | null;
  active: boolean;
  zone_count: number;
  location_count: number;
  active_locations: number;
  capacity: number;
  occupied: number;
}

export async function listWarehouses(ctx: Ctx): Promise<WarehouseSummary[]> {
  return ctx.db.query<WarehouseSummary>(
    `select w.id, w.code, w.name, w.address, w.active,
            (select count(*) from wms.zones z where z.warehouse_id = w.id) as zone_count,
            (select count(*) from wms.locations l where l.warehouse_id = w.id) as location_count,
            (select count(*) from wms.locations l where l.warehouse_id = w.id and l.status = 'active') as active_locations,
            coalesce((select sum(l.capacity_units) from wms.locations l join wms.zones z on z.id = l.zone_id
                      where l.warehouse_id = w.id and l.status <> 'inactive' and z.zone_type in ('storage', 'picking')), 0) as capacity,
            coalesce((select sum(b.quantity) from wms.stock_balances b join wms.locations l on l.id = b.location_id
                      join wms.zones z on z.id = l.zone_id
                      where b.warehouse_id = w.id and z.zone_type in ('storage', 'picking')), 0) as occupied
     from wms.warehouses w where w.company_id = $1 order by w.code`,
    [ctx.user.companyId],
  );
}

const codeSchema = z
  .string({ error: "Código é obrigatório." })
  .trim()
  .min(2, "Código deve ter ao menos 2 caracteres.")
  .max(20, "Código deve ter no máximo 20 caracteres.")
  .regex(/^[A-Za-z0-9-]+$/, "Use apenas letras, números e hífen no código.")
  .transform((v) => v.toUpperCase());

const warehouseSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(3, "Nome deve ter ao menos 3 caracteres.").max(120),
  address: optionalText,
});

export async function createWarehouse(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "warehouse.manage");
  const data = parse(warehouseSchema, input);
  return runOperation(ctx, "warehouse.create", opts, async (tx) => {
    const [row] = await tx.query<{ id: string }>(
      `insert into wms.warehouses (company_id, code, name, address, created_by) values ($1,$2,$3,$4,$5) returning id`,
      [ctx.user.companyId, data.code, data.name, data.address, ctx.user.id],
    );
    await audit(tx, ctx, "warehouse.created", "warehouse", row.id, data.code, data);
    return { id: row.id };
  });
}

export async function updateWarehouse(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx, "warehouse.manage");
  const data = parse(warehouseSchema.omit({ code: true }), input);
  return runOperation(ctx, "warehouse.update", undefined, async (tx) => {
    const rows = await tx.query<{ code: string }>(
      `update wms.warehouses set name = $3, address = $4, updated_at = now() where id = $1 and company_id = $2 returning code`,
      [id, ctx.user.companyId, data.name, data.address],
    );
    if (!rows[0]) throw new NotFoundError("Depósito");
    await audit(tx, ctx, "warehouse.updated", "warehouse", id, rows[0].code, data);
    return { id };
  });
}

export async function setWarehouseActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "warehouse.manage");
  return runOperation(ctx, "warehouse.status", undefined, async (tx) => {
    if (!active) {
      const [stock] = await tx.query<{ q: number }>(
        `select coalesce(sum(quantity), 0) as q from wms.stock_balances where warehouse_id = $1`,
        [id],
      );
      if (stock.q > 0) throw new DomainError("Não é possível desativar um depósito com estoque.");
    }
    const rows = await tx.query<{ code: string }>(
      `update wms.warehouses set active = $3, updated_at = now() where id = $1 and company_id = $2 returning code`,
      [id, ctx.user.companyId, active],
    );
    if (!rows[0]) throw new NotFoundError("Depósito");
    await audit(tx, ctx, active ? "warehouse.activated" : "warehouse.deactivated", "warehouse", id, rows[0].code);
    return { id };
  });
}

// -----------------------------------------------------------------------------
// Zonas
// -----------------------------------------------------------------------------

export const ZONE_TYPES = ["receiving", "storage", "picking", "shipping", "quarantine"] as const;

export interface ZoneRow {
  id: string;
  warehouse_id: string;
  warehouse_code: string;
  code: string;
  name: string;
  zone_type: (typeof ZONE_TYPES)[number];
  active: boolean;
  location_count: number;
  capacity: number;
  occupied: number;
}

export async function listZones(ctx: Ctx, warehouseId?: string | null): Promise<ZoneRow[]> {
  return ctx.db.query<ZoneRow>(
    `select z.id, z.warehouse_id, w.code as warehouse_code, z.code, z.name, z.zone_type, z.active,
            (select count(*) from wms.locations l where l.zone_id = z.id) as location_count,
            coalesce((select sum(l.capacity_units) from wms.locations l where l.zone_id = z.id and l.status <> 'inactive'), 0) as capacity,
            coalesce((select sum(b.quantity) from wms.stock_balances b join wms.locations l on l.id = b.location_id
                      where l.zone_id = z.id), 0) as occupied
     from wms.zones z join wms.warehouses w on w.id = z.warehouse_id
     where z.company_id = $1 and ($2::uuid is null or z.warehouse_id = $2::uuid)
     order by w.code, z.code`,
    [ctx.user.companyId, warehouseId ?? null],
  );
}

const zoneSchema = z.object({
  warehouseId: uuid("Depósito"),
  code: codeSchema,
  name: z.string().trim().min(2, "Nome da zona é obrigatório.").max(80),
  zoneType: z.enum(ZONE_TYPES, { error: "Tipo de zona inválido." }),
});

export async function createZone(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "warehouse.manage");
  const data = parse(zoneSchema, input);
  return runOperation(ctx, "zone.create", opts, async (tx) => {
    const [wh] = await tx.query(`select id from wms.warehouses where id = $1 and company_id = $2`, [
      data.warehouseId,
      ctx.user.companyId,
    ]);
    if (!wh) throw new NotFoundError("Depósito");
    const [row] = await tx.query<{ id: string }>(
      `insert into wms.zones (company_id, warehouse_id, code, name, zone_type) values ($1,$2,$3,$4,$5) returning id`,
      [ctx.user.companyId, data.warehouseId, data.code, data.name, data.zoneType],
    );
    await audit(tx, ctx, "zone.created", "zone", row.id, data.code, data);
    return { id: row.id };
  });
}

export async function setZoneActive(ctx: Ctx, id: string, active: boolean) {
  assertCan(ctx, "warehouse.manage");
  return runOperation(ctx, "zone.status", undefined, async (tx) => {
    const rows = await tx.query<{ code: string }>(
      `update wms.zones set active = $3 where id = $1 and company_id = $2 returning code`,
      [id, ctx.user.companyId, active],
    );
    if (!rows[0]) throw new NotFoundError("Zona");
    await audit(tx, ctx, active ? "zone.activated" : "zone.deactivated", "zone", id, rows[0].code);
    return { id };
  });
}

// -----------------------------------------------------------------------------
// Endereços
// -----------------------------------------------------------------------------

export const LOCATION_TYPES = ["rack", "shelf", "floor", "dock", "staging", "quarantine"] as const;
export const STORAGE_CLASSES = ["general", "refrigerated", "hazardous", "bulky"] as const;
export const LOCATION_STATUSES = ["active", "blocked", "inactive"] as const;

const segment = (label: string) =>
  z
    .string({ error: `${label} é obrigatório(a).` })
    .trim()
    .min(1, `${label} é obrigatório(a).`)
    .max(6, `${label} deve ter no máximo 6 caracteres.`)
    .regex(/^[A-Za-z0-9]+$/, `${label}: use apenas letras e números.`)
    .transform((v) => (/^\d$/.test(v) ? `0${v}` : v.toUpperCase()));

const locationSchema = z.object({
  zoneId: uuid("Zona"),
  aisle: segment("Rua"),
  bay: segment("Módulo"),
  level: segment("Nível"),
  position: segment("Posição"),
  locationType: z.enum(LOCATION_TYPES, { error: "Tipo de localização inválido." }),
  storageClass: z
    .enum(STORAGE_CLASSES)
    .nullish()
    .or(z.literal("").transform(() => null)),
  capacityUnits: z.coerce.number({ error: "Capacidade inválida." }).positive("Capacidade deve ser maior que zero."),
  maxWeightKg: z
    .union([z.literal("").transform(() => null), z.coerce.number().positive("Peso máximo deve ser maior que zero.")])
    .nullish(),
  notes: optionalText,
});

export function formatLocationCode(warehouseCode: string, s: { aisle: string; bay: string; level: string; position: string }) {
  return `${warehouseCode}/RUA-${s.aisle}/MOD-${s.bay}/NIV-${s.level}/POS-${s.position}`;
}

export async function createLocation(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "warehouse.manage");
  const data = parse(locationSchema, input);
  return runOperation(ctx, "location.create", opts, async (tx) => {
    const [zone] = await tx.query<{ warehouse_id: string; warehouse_code: string }>(
      `select z.warehouse_id, w.code as warehouse_code from wms.zones z join wms.warehouses w on w.id = z.warehouse_id
       where z.id = $1 and z.company_id = $2`,
      [data.zoneId, ctx.user.companyId],
    );
    if (!zone) throw new NotFoundError("Zona");
    const code = formatLocationCode(zone.warehouse_code, data);
    const [dup] = await tx.query(`select 1 from wms.locations where warehouse_id = $1 and code = $2`, [zone.warehouse_id, code]);
    if (dup) throw new DomainError(`Já existe o endereço ${code}.`, "DUPLICATE");
    const [row] = await tx.query<{ id: string }>(
      `insert into wms.locations (company_id, warehouse_id, zone_id, aisle, bay, level, position, code, location_type,
                                  storage_class, capacity_units, max_weight_kg, notes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
      [
        ctx.user.companyId,
        zone.warehouse_id,
        data.zoneId,
        data.aisle,
        data.bay,
        data.level,
        data.position,
        code,
        data.locationType,
        data.storageClass ?? null,
        data.capacityUnits,
        data.maxWeightKg ?? null,
        data.notes,
        ctx.user.id,
      ],
    );
    await audit(tx, ctx, "location.created", "location", row.id, code, data);
    return { id: row.id, code };
  });
}

const bulkSchema = z
  .object({
    zoneId: uuid("Zona"),
    aisle: segment("Rua"),
    bayFrom: z.coerce.number().int().min(0).max(99),
    bayTo: z.coerce.number().int().min(0).max(99),
    levelFrom: z.coerce.number().int().min(0).max(20),
    levelTo: z.coerce.number().int().min(0).max(20),
    positions: z.coerce.number().int().min(1, "Informe ao menos 1 posição por nível.").max(10),
    locationType: z.enum(LOCATION_TYPES),
    storageClass: z
      .enum(STORAGE_CLASSES)
      .nullish()
      .or(z.literal("").transform(() => null)),
    capacityUnits: z.coerce.number().positive("Capacidade deve ser maior que zero."),
  })
  .refine((d) => d.bayTo >= d.bayFrom && d.levelTo >= d.levelFrom, "Intervalos inválidos (final menor que inicial).")
  .refine(
    (d) => (d.bayTo - d.bayFrom + 1) * (d.levelTo - d.levelFrom + 1) * d.positions <= 500,
    "Limite de 500 endereços por geração.",
  );

/** Gera endereços em lote para uma rua (módulos × níveis × posições), ignorando os já existentes. */
export async function generateLocations(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "warehouse.manage");
  const d = parse(bulkSchema, input);
  return runOperation(ctx, "location.generate", opts, async (tx) => {
    const [zone] = await tx.query<{ warehouse_id: string; warehouse_code: string }>(
      `select z.warehouse_id, w.code as warehouse_code from wms.zones z join wms.warehouses w on w.id = z.warehouse_id
       where z.id = $1 and z.company_id = $2`,
      [d.zoneId, ctx.user.companyId],
    );
    if (!zone) throw new NotFoundError("Zona");
    const pad = (n: number) => String(n).padStart(2, "0");
    let created = 0;
    let skipped = 0;
    for (let bay = d.bayFrom; bay <= d.bayTo; bay++) {
      for (let level = d.levelFrom; level <= d.levelTo; level++) {
        for (let pos = 0; pos < d.positions; pos++) {
          const seg = { aisle: d.aisle, bay: pad(bay), level: pad(level), position: pad(pos) };
          const code = formatLocationCode(zone.warehouse_code, seg);
          const rows = await tx.query(
            `insert into wms.locations (company_id, warehouse_id, zone_id, aisle, bay, level, position, code,
                                        location_type, storage_class, capacity_units, created_by)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             on conflict do nothing returning id`,
            [
              ctx.user.companyId,
              zone.warehouse_id,
              d.zoneId,
              seg.aisle,
              seg.bay,
              seg.level,
              seg.position,
              code,
              d.locationType,
              d.storageClass ?? null,
              d.capacityUnits,
              ctx.user.id,
            ],
          );
          if (rows.length) created++;
          else skipped++;
        }
      }
    }
    await audit(tx, ctx, "location.generated", "zone", d.zoneId, null, { ...d, created, skipped });
    return { created, skipped };
  });
}

const locationUpdateSchema = z.object({
  locationType: z.enum(LOCATION_TYPES),
  storageClass: z
    .enum(STORAGE_CLASSES)
    .nullish()
    .or(z.literal("").transform(() => null)),
  capacityUnits: z.coerce.number({ error: "Capacidade inválida." }).positive("Capacidade deve ser maior que zero."),
  maxWeightKg: z
    .union([z.literal("").transform(() => null), z.coerce.number().positive("Peso máximo deve ser maior que zero.")])
    .nullish(),
  notes: optionalText,
});

export async function updateLocation(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx, "warehouse.manage");
  const data = parse(locationUpdateSchema, input);
  return runOperation(ctx, "location.update", undefined, async (tx) => {
    const [loc] = await tx.query<{ code: string; occupied: number }>(
      `select l.code, coalesce((select sum(quantity) from wms.stock_balances b where b.location_id = l.id), 0) as occupied
       from wms.locations l where l.id = $1 and l.company_id = $2 for update`,
      [id, ctx.user.companyId],
    );
    if (!loc) throw new NotFoundError("Endereço");
    if (data.capacityUnits < loc.occupied) {
      throw new DomainError(`Capacidade não pode ser menor que a ocupação atual (${loc.occupied} un).`);
    }
    const incompatible = await tx.query<{ sku: string }>(
      `select p.sku from wms.stock_balances b join erp.products p on p.id = b.product_id
       left join wms.product_settings s on s.product_id = p.id
       join wms.locations l on l.id = b.location_id join wms.zones z on z.id = l.zone_id
       where b.location_id = $1 and b.quantity > 0 and z.zone_type in ('storage', 'picking')
         and coalesce(s.storage_class, 'general') <> coalesce($2, 'general')`,
      [id, data.storageClass ?? null],
    );
    if (incompatible.length) {
      throw new DomainError(`Classe incompatível com produtos armazenados: ${incompatible.map((r) => r.sku).join(", ")}.`);
    }
    await tx.query(
      `update wms.locations set location_type = $2, storage_class = $3, capacity_units = $4, max_weight_kg = $5,
              notes = $6, updated_at = now() where id = $1`,
      [id, data.locationType, data.storageClass ?? null, data.capacityUnits, data.maxWeightKg ?? null, data.notes],
    );
    await audit(tx, ctx, "location.updated", "location", id, loc.code, data);
    return { id };
  });
}

const statusSchema = z.object({
  status: z.enum(LOCATION_STATUSES, { error: "Status inválido." }),
  reason: z.string().trim().min(3, "Informe o motivo da alteração de status.").max(500),
});

export async function setLocationStatus(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx, "warehouse.manage");
  const data = parse(statusSchema, input);
  return runOperation(ctx, "location.status", undefined, async (tx) => {
    const [loc] = await tx.query<{ code: string; status: string; occupied: number; pending: number }>(
      `select l.code, l.status,
              coalesce((select sum(quantity) from wms.stock_balances b where b.location_id = l.id), 0) as occupied,
              (select count(*) from wms.tasks t where t.status in ('pending', 'in_progress')
                 and (t.from_location_id = l.id or coalesce(t.to_location_id, t.suggested_location_id) = l.id)) as pending
       from wms.locations l where l.id = $1 and l.company_id = $2 for update`,
      [id, ctx.user.companyId],
    );
    if (!loc) throw new NotFoundError("Endereço");
    if (data.status === "inactive" && loc.occupied > 0) {
      throw new DomainError("Não é possível inativar um endereço com estoque. Transfira o saldo antes.");
    }
    if (data.status === "inactive" && loc.pending > 0) {
      throw new DomainError("Não é possível inativar um endereço com tarefas pendentes.");
    }
    await tx.query(`update wms.locations set status = $2, updated_at = now() where id = $1`, [id, data.status]);
    await audit(tx, ctx, "location.status_changed", "location", id, loc.code, {
      from: loc.status,
      to: data.status,
      reason: data.reason,
    });
    return { id };
  });
}

/** Exclusão física só é permitida para endereços sem estoque, movimentações ou tarefas. */
export async function deleteLocation(ctx: Ctx, id: string) {
  assertCan(ctx, "warehouse.manage");
  return runOperation(ctx, "location.delete", undefined, async (tx) => {
    const [loc] = await tx.query<{ code: string; used: boolean }>(
      `select l.code,
              exists(select 1 from wms.stock_balances b where b.location_id = l.id)
              or exists(select 1 from wms.stock_movements m where m.from_location_id = l.id or m.to_location_id = l.id)
              or exists(select 1 from wms.tasks t where t.from_location_id = l.id or t.to_location_id = l.id or t.suggested_location_id = l.id)
              or exists(select 1 from wms.inventory_count_items i where i.location_id = l.id)
              or exists(select 1 from wms.outbound_orders o where o.staging_location_id = l.id) as used
       from wms.locations l where l.id = $1 and l.company_id = $2 for update`,
      [id, ctx.user.companyId],
    );
    if (!loc) throw new NotFoundError("Endereço");
    if (loc.used) {
      throw new DomainError("Endereço possui histórico (estoque, movimentações ou tarefas) e não pode ser excluído. Inative-o.");
    }
    await tx.query(`delete from wms.locations where id = $1`, [id]);
    await audit(tx, ctx, "location.deleted", "location", id, loc.code);
    return { id };
  });
}

export interface LocationRow {
  id: string;
  code: string;
  warehouse_id: string;
  warehouse_code: string;
  zone_id: string;
  zone_code: string;
  zone_name: string;
  zone_type: string;
  aisle: string;
  bay: string;
  level: string;
  position: string;
  location_type: string;
  storage_class: string | null;
  capacity_units: number;
  max_weight_kg: number | null;
  status: string;
  notes: string | null;
  occupied: number;
  reserved: number;
  blocked: number;
  sku_count: number;
}

export interface LocationFilters {
  warehouseId?: string | null;
  zoneId?: string | null;
  status?: string | null;
  type?: string | null;
  occupancy?: "empty" | "occupied" | "full" | null;
  q?: string | null;
  sort?: string | null;
  page?: number;
  pageSize?: number;
}

const LOCATION_SORTS: Record<string, string> = {
  code: "l.code asc",
  "-code": "l.code desc",
  occupancy: "(occupied / l.capacity_units) asc, l.code",
  "-occupancy": "(occupied / l.capacity_units) desc, l.code",
  zone: "z.code, l.code",
};

export async function listLocations(ctx: Ctx, f: LocationFilters = {}) {
  const pageSize = f.pageSize ?? 25;
  const page = Math.max(1, f.page ?? 1);
  const sort = LOCATION_SORTS[f.sort ?? "code"] ?? LOCATION_SORTS.code;
  const params: unknown[] = [ctx.user.companyId];
  const where: string[] = ["l.company_id = $1"];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.warehouseId) add("l.warehouse_id = ?::uuid", f.warehouseId);
  if (f.zoneId) add("l.zone_id = ?::uuid", f.zoneId);
  if (f.status) add("l.status = ?", f.status);
  if (f.type) add("l.location_type = ?", f.type);
  if (f.q) add("(l.code ilike ? )", `%${f.q}%`);
  const base = `
    from wms.locations l
    join wms.zones z on z.id = l.zone_id
    join wms.warehouses w on w.id = l.warehouse_id
    left join lateral (
      select coalesce(sum(b.quantity), 0) as occupied, coalesce(sum(b.reserved_qty), 0) as reserved,
             coalesce(sum(b.blocked_qty), 0) as blocked, count(*) filter (where b.quantity > 0) as sku_count
      from wms.stock_balances b where b.location_id = l.id
    ) s on true
    where ${where.join(" and ")}
    ${f.occupancy === "empty" ? "and s.occupied = 0" : ""}
    ${f.occupancy === "occupied" ? "and s.occupied > 0" : ""}
    ${f.occupancy === "full" ? "and s.occupied >= l.capacity_units" : ""}`;
  const [count] = await ctx.db.query<{ total: number }>(`select count(*) as total ${base}`, params);
  const rows = await ctx.db.query<LocationRow>(
    `select l.id, l.code, l.warehouse_id, w.code as warehouse_code, l.zone_id, z.code as zone_code, z.name as zone_name,
            z.zone_type, l.aisle, l.bay, l.level, l.position, l.location_type, l.storage_class, l.capacity_units,
            l.max_weight_kg, l.status, l.notes, s.occupied, s.reserved, s.blocked, s.sku_count
     ${base} order by ${sort} limit ${pageSize} offset ${(page - 1) * pageSize}`,
    params,
  );
  return { rows, total: count.total, page, pageSize };
}

export async function getLocation(ctx: Ctx, id: string) {
  const [loc] = await ctx.db.query<LocationRow>(
    `select l.id, l.code, l.warehouse_id, w.code as warehouse_code, l.zone_id, z.code as zone_code, z.name as zone_name,
            z.zone_type, l.aisle, l.bay, l.level, l.position, l.location_type, l.storage_class, l.capacity_units,
            l.max_weight_kg, l.status, l.notes,
            coalesce((select sum(quantity) from wms.stock_balances b where b.location_id = l.id), 0) as occupied,
            coalesce((select sum(reserved_qty) from wms.stock_balances b where b.location_id = l.id), 0) as reserved,
            coalesce((select sum(blocked_qty) from wms.stock_balances b where b.location_id = l.id), 0) as blocked,
            (select count(*) from wms.stock_balances b where b.location_id = l.id and b.quantity > 0) as sku_count
     from wms.locations l join wms.zones z on z.id = l.zone_id join wms.warehouses w on w.id = l.warehouse_id
     where l.id = $1 and l.company_id = $2`,
    [id, ctx.user.companyId],
  );
  return loc ?? null;
}

/** Visão hierárquica: depósito → zona → rua, com ocupação agregada. */
export async function getStructureTree(ctx: Ctx, warehouseId: string) {
  return ctx.db.query<{
    zone_id: string;
    zone_code: string;
    zone_name: string;
    zone_type: string;
    zone_active: boolean;
    aisle: string;
    locations: number;
    active: number;
    blocked: number;
    inactive: number;
    capacity: number;
    occupied: number;
  }>(
    `select z.id as zone_id, z.code as zone_code, z.name as zone_name, z.zone_type, z.active as zone_active, l.aisle,
            count(*) as locations,
            count(*) filter (where l.status = 'active') as active,
            count(*) filter (where l.status = 'blocked') as blocked,
            count(*) filter (where l.status = 'inactive') as inactive,
            sum(l.capacity_units) as capacity,
            coalesce(sum((select sum(b.quantity) from wms.stock_balances b where b.location_id = l.id)), 0) as occupied
     from wms.zones z join wms.locations l on l.zone_id = z.id
     where z.warehouse_id = $1 and z.company_id = $2
     group by z.id, z.code, z.name, z.zone_type, z.active, l.aisle
     order by z.code, l.aisle`,
    [warehouseId, ctx.user.companyId],
  );
}
