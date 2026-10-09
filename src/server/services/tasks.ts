import "server-only";
import { z } from "zod";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError, NotFoundError } from "../errors";
import { parse, uuid, optionalText, optionalUuid, qty, nonNegQty, checkbox } from "../validation";
import { audit, nextCode, recordTaskEvent, round3, runOperation, type OpOptions } from "./common";
import {
  addStock,
  availableOf,
  changeReserved,
  insertMovement,
  lockBalance,
  removeStock,
  suggestLocations,
  validateDestination,
} from "./stock-core";
import { refreshReceiptCompletion } from "./receiving";

export const TASK_TYPES = ["putaway", "transfer", "inventory", "picking", "replenishment"] as const;
export const TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskRow {
  id: string;
  code: string;
  task_type: TaskType;
  status: TaskStatus;
  priority: number;
  warehouse_id: string;
  warehouse_code: string;
  product_id: string | null;
  sku: string | null;
  description: string | null;
  uom: string | null;
  lot_code: string;
  expiry_date: string | null;
  quantity: number | null;
  confirmed_qty: number | null;
  from_location_id: string | null;
  from_code: string | null;
  suggested_location_id: string | null;
  suggested_code: string | null;
  to_location_id: string | null;
  to_code: string | null;
  receipt_id: string | null;
  receipt_code: string | null;
  order_id: string | null;
  order_code: string | null;
  inventory_id: string | null;
  inventory_code: string | null;
  reservation_id: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  completed_by_name: string | null;
  notes: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancel_reason: string | null;
}

const TASK_SELECT = `
  select t.id, t.code, t.task_type, t.status, t.priority, t.warehouse_id, w.code as warehouse_code,
         t.product_id, p.sku, p.description, p.uom, t.lot_code, t.expiry_date::text as expiry_date, t.quantity, t.confirmed_qty,
         t.from_location_id, lf.code as from_code, t.suggested_location_id, ls.code as suggested_code,
         t.to_location_id, lt.code as to_code, t.receipt_id, r.code as receipt_code, t.order_id, o.code as order_code,
         t.inventory_id, ic.code as inventory_code, t.reservation_id,
         t.assigned_to, ua.name as assigned_name, uc.name as completed_by_name, t.notes,
         t.created_at::text as created_at, t.started_at::text as started_at, t.completed_at::text as completed_at, t.cancel_reason
  from wms.tasks t
  join wms.warehouses w on w.id = t.warehouse_id
  left join erp.products p on p.id = t.product_id
  left join wms.locations lf on lf.id = t.from_location_id
  left join wms.locations ls on ls.id = t.suggested_location_id
  left join wms.locations lt on lt.id = t.to_location_id
  left join wms.receipts r on r.id = t.receipt_id
  left join wms.outbound_orders o on o.id = t.order_id
  left join wms.inventory_counts ic on ic.id = t.inventory_id
  left join wms.users ua on ua.id = t.assigned_to
  left join wms.users uc on uc.id = t.completed_by`;

export interface TaskFilters {
  type?: string | null;
  status?: string | null;
  priority?: string | null;
  assigned?: "me" | "none" | null;
  q?: string | null;
  sort?: string | null;
  page?: number;
  pageSize?: number;
}

const TASK_SORTS: Record<string, string> = {
  priority: "t.priority asc, t.created_at asc",
  "-created": "t.created_at desc",
  created: "t.created_at asc",
  code: "t.code asc",
};

export async function listTasks(ctx: Ctx, f: TaskFilters = {}) {
  const pageSize = f.pageSize ?? 25;
  const page = Math.max(1, f.page ?? 1);
  const statuses = f.status ? f.status.split(",") : null;
  const params = [ctx.user.companyId, f.type || null, statuses, f.priority ? Number(f.priority) : null, f.q || null, ctx.user.id];
  const where = `where t.company_id = $1 and ($2::text is null or t.task_type = $2)
    and ($3::text[] is null or t.status = any($3::text[])) and ($4::int is null or t.priority = $4)
    and ($5::text is null or t.code ilike '%' || $5 || '%' or p.sku ilike '%' || $5 || '%' or p.description ilike '%' || $5 || '%'
         or r.code ilike '%' || $5 || '%' or o.code ilike '%' || $5 || '%')
    ${f.assigned === "me" ? "and t.assigned_to = $6" : f.assigned === "none" ? "and t.assigned_to is null and $6::uuid is not null" : "and $6::uuid is not null"}`;
  const [count] = await ctx.db.query<{ total: number }>(
    `select count(*) as total from (${TASK_SELECT} ${where}) x`,
    params,
  );
  const rows = await ctx.db.query<TaskRow>(
    `${TASK_SELECT} ${where} order by ${TASK_SORTS[f.sort ?? "priority"] ?? TASK_SORTS.priority}
     limit ${pageSize} offset ${(page - 1) * pageSize}`,
    params,
  );
  return { rows, total: count.total, page, pageSize };
}

export async function getTask(ctx: Ctx, id: string) {
  const [task] = await ctx.db.query<TaskRow>(`${TASK_SELECT} where t.id = $1 and t.company_id = $2`, [id, ctx.user.companyId]);
  if (!task) return null;
  const events = await ctx.db.query<{
    id: string;
    event_type: string;
    from_status: string | null;
    to_status: string | null;
    payload: Record<string, unknown>;
    user_name: string;
    created_at: string;
  }>(
    `select e.id, e.event_type, e.from_status, e.to_status, e.payload, u.name as user_name, e.created_at::text as created_at
     from wms.task_events e join wms.users u on u.id = e.user_id where e.task_id = $1 order by e.created_at, e.id`,
    [id],
  );
  return { ...task, events };
}

/** Sugestão atual de endereço para uma tarefa de armazenagem ainda aberta. */
export async function suggestForTask(ctx: Ctx, task: TaskRow) {
  if (!task.product_id || !task.quantity) return null;
  return suggestLocations({ query: ctx.db.query.bind(ctx.db) }, ctx, {
    warehouseId: task.warehouse_id,
    productId: task.product_id,
    lotCode: task.lot_code,
    quantity: task.quantity,
    excludeTaskId: task.id,
  });
}

// -----------------------------------------------------------------------------
// Ciclo de vida
// -----------------------------------------------------------------------------

interface LockedTask {
  id: string;
  code: string;
  task_type: TaskType;
  status: TaskStatus;
  warehouse_id: string;
  product_id: string | null;
  lot_code: string;
  expiry_date: string | null;
  quantity: number | null;
  from_location_id: string | null;
  suggested_location_id: string | null;
  to_location_id: string | null;
  receipt_id: string | null;
  receipt_item_id: string | null;
  order_id: string | null;
  order_line_id: string | null;
  reservation_id: string | null;
  inventory_id: string | null;
  assigned_to: string | null;
}

async function lockTask(tx: Queryable, ctx: Ctx, id: string): Promise<LockedTask> {
  const [t] = await tx.query<LockedTask>(
    `select id, code, task_type, status, warehouse_id, product_id, lot_code, expiry_date::text as expiry_date, quantity,
            from_location_id, suggested_location_id, to_location_id, receipt_id, receipt_item_id, order_id, order_line_id,
            reservation_id, inventory_id, assigned_to
     from wms.tasks where id = $1 and company_id = $2 for update`,
    [id, ctx.user.companyId],
  );
  if (!t) throw new NotFoundError("Tarefa");
  return t;
}

function assertOpen(t: LockedTask) {
  if (t.status === "completed") throw new DomainError(`A tarefa ${t.code} já foi concluída e não pode ser executada novamente.`, "TASK_CLOSED");
  if (t.status === "cancelled") throw new DomainError(`A tarefa ${t.code} está cancelada.`, "TASK_CLOSED");
}

function assertAssignee(ctx: Ctx, t: LockedTask) {
  if (t.assigned_to && t.assigned_to !== ctx.user.id && ctx.user.role === "operator") {
    throw new DomainError("Esta tarefa está atribuída a outro operador.", "TASK_ASSIGNED");
  }
}

export async function startTask(ctx: Ctx, taskId: string, opts?: OpOptions) {
  assertCan(ctx, "task.execute");
  return runOperation(ctx, "task.start", opts, async (tx) => {
    const t = await lockTask(tx, ctx, taskId);
    assertOpen(t);
    assertAssignee(ctx, t);
    if (t.status === "in_progress") throw new DomainError(`A tarefa ${t.code} já está em execução.`, "INVALID_STATUS");
    await tx.query(
      `update wms.tasks set status = 'in_progress', started_at = now(), assigned_to = coalesce(assigned_to, $2),
              version = version + 1 where id = $1`,
      [taskId, ctx.user.id],
    );
    await recordTaskEvent(tx, taskId, ctx.user.id, "started", t.status, "in_progress");
    return { id: taskId };
  });
}

const assignSchema = z.object({ userId: optionalUuid, priority: z.coerce.number().int().min(1).max(3) });

export async function updateTaskAssignment(ctx: Ctx, taskId: string, input: unknown) {
  assertCan(ctx, "task.manage");
  const d = parse(assignSchema, input);
  return runOperation(ctx, "task.assign", undefined, async (tx) => {
    const t = await lockTask(tx, ctx, taskId);
    assertOpen(t);
    if (d.userId) {
      const [u] = await tx.query(`select 1 from wms.users where id = $1 and company_id = $2 and active and role <> 'auditor'`, [
        d.userId,
        ctx.user.companyId,
      ]);
      if (!u) throw new DomainError("Responsável inválido.");
    }
    await tx.query(`update wms.tasks set assigned_to = $2, priority = $3, version = version + 1 where id = $1`, [
      taskId,
      d.userId ?? null,
      d.priority,
    ]);
    await recordTaskEvent(tx, taskId, ctx.user.id, "assigned", t.status, t.status, d);
    return { id: taskId };
  });
}

export async function cancelTask(ctx: Ctx, taskId: string, input: unknown) {
  assertCan(ctx, "task.manage");
  const d = parse(z.object({ reason: z.string().trim().min(5, "Informe o motivo do cancelamento.") }), input);
  return runOperation(ctx, "task.cancel", undefined, async (tx) => {
    const t = await lockTask(tx, ctx, taskId);
    assertOpen(t);
    if (t.task_type === "putaway" || t.task_type === "picking") {
      throw new DomainError(
        "Tarefas de armazenagem e separação não podem ser canceladas isoladamente: o volume ficaria sem destino. Conclua-a ou trate pelo documento de origem.",
      );
    }
    if (t.task_type === "inventory") throw new DomainError("Cancele a sessão de inventário correspondente.");
    await tx.query(`update wms.tasks set status = 'cancelled', cancelled_at = now(), cancel_reason = $2, version = version + 1 where id = $1`, [
      taskId,
      d.reason,
    ]);
    await recordTaskEvent(tx, taskId, ctx.user.id, "cancelled", t.status, "cancelled", d);
    return { id: taskId };
  });
}

const completeSchema = z.object({
  locationId: optionalUuid,
  quantity: z.union([z.literal("").transform(() => null), nonNegQty()]).nullish(),
  notes: optionalText,
});

/**
 * Conclui uma tarefa executando a operação física correspondente em uma única
 * transação. Uma tarefa concluída nunca é reexecutada (status verificado sob lock).
 */
export async function completeTask(ctx: Ctx, taskId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "task.execute");
  const d = parse(completeSchema, input ?? {});
  return runOperation(ctx, "task.complete", opts, async (tx) => {
    const t = await lockTask(tx, ctx, taskId);
    assertOpen(t);
    assertAssignee(ctx, t);
    let confirmed: number;
    let destination: string | null = null;
    switch (t.task_type) {
      case "putaway":
        ({ confirmed, destination } = await completePutaway(tx, ctx, t, d.locationId ?? null));
        break;
      case "transfer":
        ({ confirmed, destination } = await completeTransfer(tx, ctx, t, d.locationId ?? null));
        break;
      case "picking":
        ({ confirmed, destination } = await completePicking(tx, ctx, t, d.quantity ?? null, d.locationId ?? null, d.notes ?? null));
        break;
      case "inventory":
        throw new DomainError("Tarefas de inventário são concluídas ao submeter a contagem na tela de inventário.");
      default:
        throw new DomainError("Tipo de tarefa ainda não executável nesta versão.");
    }
    await tx.query(
      `update wms.tasks set status = 'completed', completed_at = now(), completed_by = $2, confirmed_qty = $3,
              to_location_id = coalesce($4, to_location_id), started_at = coalesce(started_at, now()),
              assigned_to = coalesce(assigned_to, $2), notes = coalesce($5, notes), version = version + 1
       where id = $1 and status in ('pending', 'in_progress')`,
      [taskId, ctx.user.id, confirmed, destination, d.notes ?? null],
    );
    await recordTaskEvent(tx, taskId, ctx.user.id, "completed", t.status, "completed", {
      quantity: confirmed,
      location: destination,
    });
    return { id: taskId, confirmed };
  });
}

async function completePutaway(tx: Queryable, ctx: Ctx, t: LockedTask, locationId: string | null) {
  const target = locationId ?? t.to_location_id ?? t.suggested_location_id;
  if (!target) throw new DomainError("Informe o endereço de destino: não há sugestão elegível para esta tarefa.", "VALIDATION", "locationId");
  const qtyToStore = t.quantity!;
  const loc = await validateDestination(tx, ctx, {
    locationId: target,
    warehouseId: t.warehouse_id,
    productId: t.product_id!,
    quantity: qtyToStore,
    excludeTaskId: t.id,
  });
  await addStock(tx, ctx, {
    warehouseId: t.warehouse_id,
    locationId: target,
    productId: t.product_id!,
    lotCode: t.lot_code,
    expiryDate: t.expiry_date,
    quantity: qtyToStore,
  });
  const [receipt] = await tx.query<{ code: string }>(`select code from wms.receipts where id = $1`, [t.receipt_id]);
  await insertMovement(tx, ctx, {
    warehouseId: t.warehouse_id,
    movementType: "putaway",
    productId: t.product_id!,
    lotCode: t.lot_code,
    expiryDate: t.expiry_date,
    quantity: qtyToStore,
    toLocationId: target,
    reason: "Armazenagem de recebimento",
    referenceType: "receipt",
    referenceId: t.receipt_id,
    referenceCode: receipt?.code ?? null,
    taskId: t.id,
  });
  if (t.receipt_item_id) {
    await tx.query(`update wms.receipt_items set putaway_qty = putaway_qty + $2 where id = $1`, [t.receipt_item_id, qtyToStore]);
  }
  if (t.receipt_id) await refreshReceiptCompletion(tx, ctx, t.receipt_id);
  return { confirmed: qtyToStore, destination: loc.id };
}

async function completeTransfer(tx: Queryable, ctx: Ctx, t: LockedTask, locationId: string | null) {
  const target = locationId ?? t.to_location_id;
  if (!target) throw new DomainError("Informe o endereço de destino.", "VALIDATION", "locationId");
  if (target === t.from_location_id) throw new DomainError("Origem e destino não podem ser o mesmo endereço.");
  const q = t.quantity!;
  const origin = await lockBalance(tx, ctx.user.companyId, t.from_location_id!, t.product_id!, t.lot_code);
  if (!origin || availableOf(origin) < q) {
    throw new DomainError(
      `Saldo disponível insuficiente na origem: disponível ${origin ? availableOf(origin) : 0}, solicitado ${q}.`,
      "INSUFFICIENT_STOCK",
    );
  }
  await validateDestination(tx, ctx, {
    locationId: target,
    warehouseId: t.warehouse_id,
    productId: t.product_id!,
    quantity: q,
    excludeTaskId: t.id,
  });
  await removeStock(tx, ctx, { balanceId: origin.id, quantity: q, requireAvailable: true });
  await addStock(tx, ctx, {
    warehouseId: t.warehouse_id,
    locationId: target,
    productId: t.product_id!,
    lotCode: t.lot_code,
    expiryDate: origin.expiry_date,
    quantity: q,
  });
  await insertMovement(tx, ctx, {
    warehouseId: t.warehouse_id,
    movementType: "transfer",
    productId: t.product_id!,
    lotCode: t.lot_code,
    expiryDate: origin.expiry_date,
    quantity: q,
    fromLocationId: t.from_location_id,
    toLocationId: target,
    reason: "Transferência interna",
    referenceType: "task",
    referenceId: t.id,
    referenceCode: t.code,
    taskId: t.id,
  });
  return { confirmed: q, destination: target };
}

async function completePicking(
  tx: Queryable,
  ctx: Ctx,
  t: LockedTask,
  pickedInput: number | null,
  confirmLocationId: string | null,
  notes: string | null,
) {
  if (confirmLocationId && confirmLocationId !== t.from_location_id) {
    throw new DomainError("O endereço confirmado não corresponde ao endereço de origem da separação.", "LOCATION_MISMATCH");
  }
  const [res] = await tx.query<{ id: string; balance_id: string; quantity: number; status: string; order_line_id: string }>(
    `select id, balance_id, quantity, status, order_line_id from wms.stock_reservations where id = $1 for update`,
    [t.reservation_id],
  );
  if (!res || res.status !== "active") throw new DomainError("Reserva da separação não está ativa.", "RESERVATION_MISMATCH");
  const picked = pickedInput ?? res.quantity;
  if (picked > res.quantity) {
    throw new DomainError(`Quantidade separada (${picked}) maior que a reservada (${res.quantity}).`, "OVER_PICK");
  }
  const [order] = await tx.query<{ id: string; code: string; staging_location_id: string }>(
    `select id, code, staging_location_id from wms.outbound_orders where id = $1 for update`,
    [t.order_id],
  );
  const shortfall = round3(res.quantity - picked);
  // Origem: retira o físico separado e libera toda a reserva desta tarefa.
  const origin = await removeStock(tx, ctx, { balanceId: res.balance_id, quantity: picked, consumeReserved: picked });
  if (shortfall > 0) await changeReserved(tx, res.balance_id, -shortfall);
  if (picked > 0) {
    // Doca de expedição: entra já reservado para o pedido (não disponível a terceiros).
    await addStock(tx, ctx, {
      warehouseId: t.warehouse_id,
      locationId: order.staging_location_id,
      productId: t.product_id!,
      lotCode: t.lot_code,
      expiryDate: origin.expiry_date,
      quantity: picked,
      reserved: picked,
    });
    await insertMovement(tx, ctx, {
      warehouseId: t.warehouse_id,
      movementType: "pick",
      productId: t.product_id!,
      lotCode: t.lot_code,
      expiryDate: origin.expiry_date,
      quantity: picked,
      fromLocationId: t.from_location_id,
      toLocationId: order.staging_location_id,
      reason: "Separação de pedido",
      referenceType: "outbound_order",
      referenceId: order.id,
      referenceCode: order.code,
      taskId: t.id,
    });
  }
  await tx.query(
    `update wms.stock_reservations set status = 'picked', picked_qty = $2, closed_at = now() where id = $1`,
    [res.id, picked],
  );
  await tx.query(
    `update wms.outbound_order_lines set picked_qty = picked_qty + $2, reserved_qty = reserved_qty - $3 where id = $1`,
    [res.order_line_id, picked, shortfall],
  );
  if (shortfall > 0) {
    await tx.query(
      `insert into wms.divergences (company_id, source, divergence_type, product_id, quantity, description, order_id,
                                    order_line_id, task_id, created_by)
       values ($1, 'picking', 'short_pick', $2, $3, $4, $5, $6, $7, $8)`,
      [
        ctx.user.companyId,
        t.product_id,
        shortfall,
        `Separação a menor na tarefa ${t.code}: reservado ${res.quantity}, separado ${picked}.${notes ? ` Obs.: ${notes}` : ""}`,
        order.id,
        res.order_line_id,
        t.id,
        ctx.user.id,
      ],
    );
  }
  const [pending] = await tx.query<{ n: number }>(
    `select count(*) as n from wms.tasks where order_id = $1 and task_type = 'picking' and status in ('pending', 'in_progress') and id <> $2`,
    [order.id, t.id],
  );
  if (pending.n === 0) {
    await tx.query(
      `update wms.outbound_orders set status = 'picked', picked_at = now(), updated_at = now(), version = version + 1
       where id = $1 and status = 'picking'`,
      [order.id],
    );
    await audit(tx, ctx, "outbound.picked", "outbound_order", order.id, order.code);
  }
  return { confirmed: picked, destination: order.staging_location_id };
}

// -----------------------------------------------------------------------------
// Transferência (criação)
// -----------------------------------------------------------------------------

const transferSchema = z.object({
  fromLocationId: uuid("Endereço de origem"),
  productId: uuid("Produto"),
  lotCode: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ?? "").toUpperCase()),
  quantity: qty(),
  toLocationId: optionalUuid,
  priority: z.coerce.number().int().min(1).max(3).default(2),
  executeNow: checkbox,
});

/**
 * Cria uma tarefa de transferência validando saldo disponível na origem e o
 * destino. Com "executar agora", a tarefa é criada e concluída na mesma transação.
 */
export async function createTransfer(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "stock.transfer");
  const d = parse(transferSchema, input);
  return runOperation(ctx, "task.create_transfer", opts, async (tx) => {
    const origin = await lockBalance(tx, ctx.user.companyId, d.fromLocationId, d.productId, d.lotCode);
    if (!origin) throw new DomainError("Não há saldo deste produto/lote no endereço de origem.", "INSUFFICIENT_STOCK");
    if (availableOf(origin) < d.quantity) {
      throw new DomainError(`Saldo disponível insuficiente: disponível ${availableOf(origin)}, solicitado ${d.quantity}.`, "INSUFFICIENT_STOCK");
    }
    let toLocationId = d.toLocationId ?? null;
    if (!toLocationId) {
      const s = await suggestLocations(tx, ctx, {
        warehouseId: origin.warehouse_id,
        productId: d.productId,
        lotCode: d.lotCode,
        quantity: d.quantity,
      });
      const best = s.candidates.find((c) => c.location.id !== d.fromLocationId);
      if (!best) throw new DomainError(`Sem destino elegível: ${s.reason ?? "apenas a própria origem é elegível."}`);
      toLocationId = best.location.id;
    }
    if (toLocationId === d.fromLocationId) throw new DomainError("Origem e destino não podem ser o mesmo endereço.");
    await validateDestination(tx, ctx, {
      locationId: toLocationId,
      warehouseId: origin.warehouse_id,
      productId: d.productId,
      quantity: d.quantity,
    });
    const code = await nextCode(tx, ctx.user.companyId, "TAR");
    const [task] = await tx.query<{ id: string }>(
      `insert into wms.tasks (company_id, warehouse_id, code, task_type, priority, product_id, lot_code, expiry_date, quantity,
                              from_location_id, to_location_id, created_by)
       values ($1,$2,$3,'transfer',$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [
        ctx.user.companyId,
        origin.warehouse_id,
        code,
        d.priority,
        d.productId,
        d.lotCode,
        origin.expiry_date,
        d.quantity,
        d.fromLocationId,
        toLocationId,
        ctx.user.id,
      ],
    );
    await recordTaskEvent(tx, task.id, ctx.user.id, "created", null, "pending", { quantity: d.quantity });
    await audit(tx, ctx, "transfer.created", "task", task.id, code, d);
    if (d.executeNow) {
      const locked = await lockTask(tx, ctx, task.id);
      const { confirmed, destination } = await completeTransfer(tx, ctx, locked, toLocationId);
      await tx.query(
        `update wms.tasks set status = 'completed', started_at = now(), completed_at = now(), completed_by = $2,
                assigned_to = $2, confirmed_qty = $3, to_location_id = $4 where id = $1`,
        [task.id, ctx.user.id, confirmed, destination],
      );
      await recordTaskEvent(tx, task.id, ctx.user.id, "completed", "pending", "completed", { quantity: confirmed });
    }
    return { id: task.id, code };
  });
}

/** Lista operadores elegíveis para atribuição. */
export async function listAssignableUsers(ctx: Ctx) {
  return ctx.db.query<{ id: string; name: string; role: string }>(
    `select id, name, role from wms.users where company_id = $1 and active and role <> 'auditor' order by name`,
    [ctx.user.companyId],
  );
}
