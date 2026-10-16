import "server-only";
import { z } from "zod";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError, NotFoundError } from "../errors";
import { parse, uuid, optionalText, optionalUuid, nonNegQty } from "../validation";
import { audit, nextCode, recordTaskEvent, round3, runOperation, type OpOptions } from "./common";
import { addStock, insertMovement, lockBalance, removeStock } from "./stock-core";

export const INVENTORY_STATUSES = ["counting", "submitted", "approved", "cancelled"] as const;

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
  return c;
}

export async function listInventories(ctx: Ctx) {
  return ctx.db.query<{
    id: string;
    code: string;
    count_type: string;
    status: string;
    warehouse_code: string;
    scope: string;
    items: number;
    counted: number;
    differences: number;
    created_by_name: string;
    created_at: string;
    approved_at: string | null;
  }>(
    `select c.id, c.code, c.count_type, c.status, w.code as warehouse_code,
            concat_ws(' · ', z.code, l.code, p.sku) as scope,
            (select count(*) from wms.inventory_count_items i where i.inventory_id = c.id) as items,
            (select count(*) from wms.inventory_count_items i where i.inventory_id = c.id and i.counted_qty is not null) as counted,
            (select count(*) from wms.inventory_count_items i where i.inventory_id = c.id and i.counted_qty is not null
               and i.counted_qty <> i.expected_qty) as differences,
            u.name as created_by_name, c.created_at::text as created_at, c.approved_at::text as approved_at
     from wms.inventory_counts c join wms.warehouses w on w.id = c.warehouse_id join wms.users u on u.id = c.created_by
     left join wms.zones z on z.id = c.zone_id left join wms.locations l on l.id = c.location_id
     left join erp.products p on p.id = c.product_id
     where c.company_id = $1 order by c.created_at desc`,
    [ctx.user.companyId],
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
  }>(
    `select c.id, c.code, c.count_type, c.status, c.warehouse_id, w.code as warehouse_code, z.code as zone_code,
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
  if (!c) return null;
  const items = await ctx.db.query<{
    id: string;
    location_id: string;
    location_code: string;
    product_id: string;
    sku: string;
    description: string;
    uom: string;
    lot_code: string;
    expiry_date: string | null;
    expected_qty: number;
    counted_qty: number | null;
    notes: string | null;
    adjusted: boolean;
    counted_by_name: string | null;
  }>(
    `select i.id, i.location_id, l.code as location_code, i.product_id, p.sku, p.description, p.uom, i.lot_code,
            i.expiry_date::text as expiry_date, i.expected_qty, i.counted_qty, i.notes, i.adjusted, u.name as counted_by_name
     from wms.inventory_count_items i join wms.locations l on l.id = i.location_id join erp.products p on p.id = i.product_id
     left join wms.users u on u.id = i.counted_by
     where i.inventory_id = $1 order by l.code, p.sku, i.lot_code`,
    [id],
  );
  return { ...c, items };
}

const createSchema = z
  .object({
    warehouseId: uuid("Depósito"),
    countType: z.enum(["general", "cyclic"], { error: "Tipo de inventário inválido." }),
    zoneId: optionalUuid,
    locationId: optionalUuid,
    productId: optionalUuid,
    notes: optionalText,
  })
  .refine((d) => d.countType === "general" || d.zoneId || d.locationId || d.productId, {
    message: "Inventário rotativo exige ao menos um filtro (zona, endereço ou produto).",
  });

/**
 * Abre uma sessão de inventário com o saldo esperado (snapshot) de cada
 * produto/lote/endereço do escopo e gera a tarefa de contagem.
 */
export async function createInventory(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "inventory.create");
  const d = parse(createSchema, input);
  return runOperation(ctx, "inventory.create", opts, async (tx) => {
    const [wh] = await tx.query(`select id from wms.warehouses where id = $1 and company_id = $2`, [d.warehouseId, ctx.user.companyId]);
    if (!wh) throw new NotFoundError("Depósito");
    const code = await nextCode(tx, ctx.user.companyId, "INV");
    const [c] = await tx.query<{ id: string }>(
      `insert into wms.inventory_counts (company_id, warehouse_id, code, count_type, zone_id, location_id, product_id, notes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [
        ctx.user.companyId,
        d.warehouseId,
        code,
        d.countType,
        d.zoneId ?? null,
        d.locationId ?? null,
        d.productId ?? null,
        d.notes,
        ctx.user.id,
      ],
    );
    const inserted = await tx.query(
      `insert into wms.inventory_count_items (inventory_id, location_id, product_id, lot_code, expiry_date, expected_qty)
       select $1, b.location_id, b.product_id, b.lot_code, b.expiry_date, b.quantity
       from wms.stock_balances b join wms.locations l on l.id = b.location_id
       where b.company_id = $2 and b.warehouse_id = $3 and b.quantity > 0
         and ($4::uuid is null or l.zone_id = $4::uuid)
         and ($5::uuid is null or b.location_id = $5::uuid)
         and ($6::uuid is null or b.product_id = $6::uuid)
       returning id`,
      [c.id, ctx.user.companyId, d.warehouseId, d.zoneId ?? null, d.locationId ?? null, d.productId ?? null],
    );
    const taskCode = await nextCode(tx, ctx.user.companyId, "TAR");
    const [inventoryTask] = await tx.query<{ id: string }>(
      `insert into wms.tasks (company_id, warehouse_id, code, task_type, priority, inventory_id, from_location_id, product_id, notes, created_by)
       values ($1, $2, $3, 'inventory', 2, $4, $5, $6, $7, $8) returning id`,
      [
        ctx.user.companyId,
        d.warehouseId,
        taskCode,
        c.id,
        d.locationId ?? null,
        d.productId ?? null,
        `Contagem do inventário ${code} (${inserted.length} itens)`,
        ctx.user.id,
      ],
    );
    await recordTaskEvent(tx, inventoryTask.id, ctx.user.id, "created", null, "pending", { inventory: code });
    await audit(tx, ctx, "inventory.created", "inventory", c.id, code, { ...d, items: inserted.length });
    return { id: c.id, code };
  });
}

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
});

/** Registra contagens. NÃO altera saldo: o ajuste só ocorre após aprovação. */
export async function recordCounts(ctx: Ctx, inventoryId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "inventory.count");
  const d = parse(countsSchema, input);
  return runOperation(ctx, "inventory.count", opts, async (tx) => {
    const c = await lockCount(tx, ctx, inventoryId);
    if (c.status !== "counting") throw new DomainError(`O inventário ${c.code} não está em contagem.`, "INVALID_STATUS");
    for (const item of d.items) {
      const rows = await tx.query(
        `update wms.inventory_count_items set counted_qty = $3, notes = $4,
                counted_by = case when $3::numeric is null then null else $5::uuid end,
                counted_at = case when $3::numeric is null then null else now() end
         where id = $1 and inventory_id = $2 and not adjusted returning id`,
        [item.itemId, inventoryId, item.countedQty ?? null, item.notes, ctx.user.id],
      );
      if (!rows.length) throw new NotFoundError("Item do inventário");
    }
    await tx.query(
      `update wms.tasks set status = 'in_progress', started_at = coalesce(started_at, now()), assigned_to = coalesce(assigned_to, $2)
       where inventory_id = $1 and status = 'pending'`,
      [inventoryId, ctx.user.id],
    );
    await audit(tx, ctx, "inventory.counted", "inventory", inventoryId, c.code, { items: d.items.length });
    return { id: inventoryId };
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
});

/** Inclui item encontrado fisicamente que não constava no sistema (saldo esperado 0). */
export async function addInventoryItem(ctx: Ctx, inventoryId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "inventory.count");
  const d = parse(addItemSchema, input);
  return runOperation(ctx, "inventory.add_item", opts, async (tx) => {
    const c = await lockCount(tx, ctx, inventoryId);
    if (c.status !== "counting") throw new DomainError(`O inventário ${c.code} não está em contagem.`, "INVALID_STATUS");
    const [loc] = await tx.query<{ warehouse_id: string }>(`select warehouse_id from wms.locations where id = $1 and company_id = $2`, [
      d.locationId,
      ctx.user.companyId,
    ]);
    if (!loc || loc.warehouse_id !== c.warehouse_id) throw new DomainError("Endereço não pertence ao depósito do inventário.");
    const balance = await lockBalance(tx, ctx.user.companyId, d.locationId, d.productId, d.lotCode);
    const [row] = await tx.query<{ id: string }>(
      `insert into wms.inventory_count_items (inventory_id, location_id, product_id, lot_code, expiry_date, expected_qty, counted_qty,
                                              counted_by, counted_at, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8, now(), $9)
       on conflict (inventory_id, location_id, product_id, lot_code) do nothing returning id`,
      [
        inventoryId,
        d.locationId,
        d.productId,
        d.lotCode,
        balance?.expiry_date ?? null,
        balance?.quantity ?? 0,
        d.countedQty,
        ctx.user.id,
        d.notes,
      ],
    );
    if (!row) throw new DomainError("Este produto/lote/endereço já faz parte do inventário.", "DUPLICATE");
    await audit(tx, ctx, "inventory.item_added", "inventory", inventoryId, c.code, d);
    return { id: row.id };
  });
}

/** Submete as diferenças para aprovação. Exige todos os itens contados. */
export async function submitInventory(ctx: Ctx, inventoryId: string, opts?: OpOptions) {
  assertCan(ctx, "inventory.count");
  return runOperation(ctx, "inventory.submit", opts, async (tx) => {
    const c = await lockCount(tx, ctx, inventoryId);
    if (c.status !== "counting") throw new DomainError(`O inventário ${c.code} não está em contagem.`, "INVALID_STATUS");
    const items = await tx.query<{ id: string; product_id: string; sku: string; location_code: string; expected_qty: number; counted_qty: number | null }>(
      `select i.id, i.product_id, p.sku, l.code as location_code, i.expected_qty, i.counted_qty
       from wms.inventory_count_items i join erp.products p on p.id = i.product_id join wms.locations l on l.id = i.location_id
       where i.inventory_id = $1`,
      [inventoryId],
    );
    if (!items.length) throw new DomainError("Inventário sem itens. Inclua os itens encontrados antes de submeter.");
    const missing = items.filter((i) => i.counted_qty === null);
    if (missing.length) throw new DomainError(`Existem ${missing.length} item(ns) sem contagem.`, "INCOMPLETE_COUNT");
    let differences = 0;
    for (const i of items) {
      const diff = round3(i.counted_qty! - i.expected_qty);
      if (diff === 0) continue;
      differences++;
      await tx.query(
        `insert into wms.divergences (company_id, source, divergence_type, product_id, quantity, description, inventory_id, created_by)
         values ($1, 'inventory', 'count_difference', $2, $3, $4, $5, $6)`,
        [
          ctx.user.companyId,
          i.product_id,
          Math.abs(diff),
          `${c.code}: ${i.sku} em ${i.location_code} — esperado ${i.expected_qty}, contado ${i.counted_qty} (${diff > 0 ? "+" : ""}${diff}).`,
          inventoryId,
          ctx.user.id,
        ],
      );
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

/**
 * Aprova e aplica os ajustes. Se o saldo de algum item mudou desde a abertura
 * (movimentação durante a contagem), a aprovação é recusada para evitar ajuste
 * sobre base desatualizada. Ajustes nunca reduzem abaixo do reservado/bloqueado.
 */
export async function approveInventory(ctx: Ctx, inventoryId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "inventory.approve");
  const d = parse(z.object({ notes: optionalText }), input ?? {});
  return runOperation(ctx, "inventory.approve", opts, async (tx) => {
    const c = await lockCount(tx, ctx, inventoryId);
    if (c.status !== "submitted") throw new DomainError(`O inventário ${c.code} não está aguardando aprovação.`, "INVALID_STATUS");
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
    }>(
      `select i.id, i.location_id, l.code as location_code, i.product_id, p.sku, i.lot_code, i.expiry_date::text as expiry_date,
              i.expected_qty, i.counted_qty
       from wms.inventory_count_items i join erp.products p on p.id = i.product_id join wms.locations l on l.id = i.location_id
       where i.inventory_id = $1 and i.counted_qty <> i.expected_qty and not i.adjusted for update of i`,
      [inventoryId],
    );
    let adjustments = 0;
    for (const i of items) {
      const balance = await lockBalance(tx, ctx.user.companyId, i.location_id, i.product_id, i.lot_code);
      const current = balance?.quantity ?? 0;
      if (current !== i.expected_qty) {
        throw new DomainError(
          `O saldo de ${i.sku} em ${i.location_code} mudou durante a contagem (esperado ${i.expected_qty}, atual ${current}). Cancele e abra uma nova contagem.`,
          "STALE_SNAPSHOT",
        );
      }
      const diff = round3(i.counted_qty - i.expected_qty);
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
      });
      await tx.query(`update wms.inventory_count_items set adjusted = true where id = $1`, [i.id]);
      adjustments++;
    }
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
    return { id: inventoryId, adjustments };
  });
}

/** Devolve o inventário para recontagem (gera nova tarefa de contagem). */
export async function rejectInventory(ctx: Ctx, inventoryId: string, input: unknown) {
  assertCan(ctx, "inventory.approve");
  const d = parse(z.object({ notes: z.string().trim().min(5, "Informe o motivo da recontagem.") }), input);
  return runOperation(ctx, "inventory.reject", undefined, async (tx) => {
    const c = await lockCount(tx, ctx, inventoryId);
    if (c.status !== "submitted") throw new DomainError(`O inventário ${c.code} não está aguardando aprovação.`, "INVALID_STATUS");
    await tx.query(
      `update wms.divergences set status = 'resolved', resolution = $3, resolved_by = $2, resolved_at = now()
       where inventory_id = $1 and status = 'open'`,
      [inventoryId, ctx.user.id, `Contagem devolvida para recontagem: ${d.notes}`],
    );
    await tx.query(`update wms.inventory_counts set status = 'counting', submitted_at = null, submitted_by = null where id = $1`, [inventoryId]);
    const code = await nextCode(tx, ctx.user.companyId, "TAR");
    const [t] = await tx.query<{ id: string }>(
      `insert into wms.tasks (company_id, warehouse_id, code, task_type, priority, inventory_id, notes, created_by)
       values ($1,$2,$3,'inventory',1,$4,$5,$6) returning id`,
      [ctx.user.companyId, c.warehouse_id, code, inventoryId, `Recontagem do inventário ${c.code}: ${d.notes}`, ctx.user.id],
    );
    await recordTaskEvent(tx, t.id, ctx.user.id, "created", null, "pending", { recount: true });
    await audit(tx, ctx, "inventory.rejected", "inventory", inventoryId, c.code, d);
    return { id: inventoryId };
  });
}

export async function cancelInventory(ctx: Ctx, inventoryId: string, input: unknown) {
  assertCan(ctx, "inventory.create");
  const d = parse(z.object({ reason: z.string().trim().min(5, "Informe o motivo do cancelamento.") }), input);
  return runOperation(ctx, "inventory.cancel", undefined, async (tx) => {
    const c = await lockCount(tx, ctx, inventoryId);
    if (!["counting", "submitted"].includes(c.status)) throw new DomainError("Inventário já encerrado.", "INVALID_STATUS");
    await tx.query(`update wms.inventory_counts set status = 'cancelled' where id = $1`, [inventoryId]);
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
