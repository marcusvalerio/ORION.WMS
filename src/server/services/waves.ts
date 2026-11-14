import "server-only";
import { z } from "zod";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError, NotFoundError } from "../errors";
import { parse, uuid, optionalText, optionalUuid } from "../validation";
import { audit, nextCode, recordTaskEvent, round3, runOperation, type OpOptions } from "./common";
import { addStock, changeReserved, insertMovement, removeStock } from "./stock-core";
import { isSerialControlled, pickSerials } from "./serials";
import { checkReplenishmentTx, emergencyReplenishmentTx } from "./replenishment";

/**
 * Ondas de separação (wave picking).
 *
 * Fluxo: planejada (draft) → liberada (released) → em separação (picking) →
 * separada (picked) → distribuída (completed). Pode ser cancelada antes de
 * qualquer separação. Ao liberar, as reservas de todos os pedidos da onda são
 * consolidadas por endereço/produto/lote em uma tarefa de separação cada, com
 * wms.task_allocations registrando quanto de cada tarefa pertence a cada pedido.
 * As tarefas recebem a sequência do roteiro (rua → módulo em serpentina → nível
 * → posição). Na doca, a distribuição por pedido libera cada pedido para a
 * conferência individual (que continua obrigatória).
 *
 * Integridade: um pedido participa de no máximo uma onda ativa (índice único
 * parcial em wms.wave_orders) e todas as transições ocorrem com lock da onda.
 */

export const WAVE_STATUSES = ["draft", "released", "picking", "picked", "completed", "cancelled"] as const;
export type WaveStatus = (typeof WAVE_STATUSES)[number];
export const WAVE_GROUPINGS = ["dock", "carrier", "date", "manual"] as const;

interface WaveHeader {
  id: string;
  code: string;
  status: WaveStatus;
  warehouse_id: string;
  dock_location_id: string;
}

async function lockWave(tx: Queryable, ctx: Ctx, id: string): Promise<WaveHeader> {
  const [w] = await tx.query<WaveHeader>(
    `select id, code, status, warehouse_id, dock_location_id from wms.waves where id = $1 and company_id = $2 for update`,
    [id, ctx.user.companyId],
  );
  if (!w) throw new NotFoundError("Onda");
  return w;
}

function requireWaveStatus(w: WaveHeader, allowed: WaveStatus[], action: string) {
  if (!allowed.includes(w.status)) {
    throw new DomainError(`Não é possível ${action}: a onda ${w.code} está com status "${w.status}".`, "INVALID_STATUS");
  }
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export interface WaveListRow {
  id: string;
  code: string;
  status: WaveStatus;
  grouping: string;
  grouping_value: string | null;
  warehouse_code: string;
  dock_code: string;
  orders: number;
  tasks_total: number;
  tasks_done: number;
  created_at: string;
  released_at: string | null;
  is_demo: boolean;
}

export async function listWaves(ctx: Ctx, f: { status?: string | null } = {}) {
  const statuses = f.status ? f.status.split(",") : null;
  return ctx.db.query<WaveListRow>(
    `select wv.id, wv.code, wv.status, wv.grouping, wv.grouping_value, w.code as warehouse_code, d.code as dock_code,
            wv.created_at::text as created_at, wv.released_at::text as released_at, wv.is_demo,
            (select count(*) from wms.wave_orders wo where wo.wave_id = wv.id and (wo.active or wv.status = 'completed')) as orders,
            (select count(*) from wms.tasks t where t.wave_id = wv.id and t.status <> 'cancelled') as tasks_total,
            (select count(*) from wms.tasks t where t.wave_id = wv.id and t.status = 'completed') as tasks_done
     from wms.waves wv join wms.warehouses w on w.id = wv.warehouse_id join wms.locations d on d.id = wv.dock_location_id
     where wv.company_id = $1 and ($2::text[] is null or wv.status = any($2::text[]))
     order by wv.created_at desc`,
    [ctx.user.companyId, statuses],
  );
}

export async function getWave(ctx: Ctx, id: string) {
  const [wave] = await ctx.db.query<{
    id: string;
    code: string;
    status: WaveStatus;
    grouping: string;
    grouping_value: string | null;
    warehouse_id: string;
    warehouse_code: string;
    dock_location_id: string;
    dock_code: string;
    notes: string | null;
    created_by_name: string;
    created_at: string;
    released_at: string | null;
    picked_at: string | null;
    completed_at: string | null;
    cancelled_at: string | null;
    cancel_reason: string | null;
    is_demo: boolean;
  }>(
    `select wv.id, wv.code, wv.status, wv.grouping, wv.grouping_value, wv.warehouse_id, w.code as warehouse_code,
            wv.dock_location_id, d.code as dock_code, wv.notes, u.name as created_by_name, wv.created_at::text as created_at,
            wv.released_at::text as released_at, wv.picked_at::text as picked_at, wv.completed_at::text as completed_at,
            wv.cancelled_at::text as cancelled_at, wv.cancel_reason, wv.is_demo
     from wms.waves wv join wms.warehouses w on w.id = wv.warehouse_id join wms.locations d on d.id = wv.dock_location_id
     join wms.users u on u.id = wv.created_by
     where wv.id = $1 and wv.company_id = $2`,
    [id, ctx.user.companyId],
  );
  if (!wave) return null;
  const orders = await ctx.db.query<{
    order_id: string;
    code: string;
    customer_name: string;
    status: string;
    priority: number;
    carrier: string | null;
    planned_ship_date: string | null;
    active: boolean;
    distributed_at: string | null;
    requested: number;
    reserved: number;
    picked: number;
    open_allocations: number;
  }>(
    `select o.id as order_id, o.code, o.customer_name, o.status, o.priority, o.carrier, o.planned_ship_date::text as planned_ship_date,
            wo.active, wo.distributed_at::text as distributed_at,
            coalesce((select sum(l.requested_qty) from wms.outbound_order_lines l where l.order_id = o.id and l.cancelled_at is null), 0) as requested,
            coalesce((select sum(l.reserved_qty) from wms.outbound_order_lines l where l.order_id = o.id), 0) as reserved,
            coalesce((select sum(l.picked_qty) from wms.outbound_order_lines l where l.order_id = o.id), 0) as picked,
            (select count(*) from wms.task_allocations a where a.order_id = o.id and a.status = 'open'
               and exists (select 1 from wms.tasks t where t.id = a.task_id and t.wave_id = wo.wave_id)) as open_allocations
     from wms.wave_orders wo join wms.outbound_orders o on o.id = wo.order_id
     where wo.wave_id = $1 order by wo.active desc, o.priority, o.created_at`,
    [id],
  );
  const tasks = await ctx.db.query<{
    id: string;
    code: string;
    status: string;
    pick_sequence: number | null;
    sku: string;
    lot_code: string;
    quantity: number;
    confirmed_qty: number | null;
    from_code: string;
    assigned_name: string | null;
    allocations: { order_code: string; quantity: number; picked_qty: number | null; status: string }[];
  }>(
    `select t.id, t.code, t.status, t.pick_sequence, p.sku, t.lot_code, t.quantity, t.confirmed_qty, l.code as from_code,
            u.name as assigned_name,
            coalesce((select json_agg(json_build_object('order_code', o.code, 'quantity', a.quantity, 'picked_qty', a.picked_qty,
                                                        'status', a.status) order by o.priority, o.code)
                      from wms.task_allocations a join wms.outbound_orders o on o.id = a.order_id where a.task_id = t.id), '[]'::json) as allocations
     from wms.tasks t join erp.products p on p.id = t.product_id join wms.locations l on l.id = t.from_location_id
     left join wms.users u on u.id = t.assigned_to
     where t.wave_id = $1 order by t.pick_sequence nulls last, t.code`,
    [id],
  );
  return { ...wave, orders, tasks };
}

/** Pedidos reservados que ainda não estão em uma onda ativa (candidatos). */
export async function listWaveCandidates(ctx: Ctx, warehouseId?: string | null) {
  return ctx.db.query<{
    id: string;
    code: string;
    customer_name: string;
    warehouse_id: string;
    priority: number;
    carrier: string | null;
    planned_ship_date: string | null;
    staging_code: string | null;
    requested: number;
  }>(
    `select o.id, o.code, o.customer_name, o.warehouse_id, o.priority, o.carrier, o.planned_ship_date::text as planned_ship_date,
            sl.code as staging_code,
            coalesce((select sum(l.requested_qty) from wms.outbound_order_lines l where l.order_id = o.id and l.cancelled_at is null), 0) as requested
     from wms.outbound_orders o left join wms.locations sl on sl.id = o.staging_location_id
     where o.company_id = $1 and o.status = 'reserved' and ($2::uuid is null or o.warehouse_id = $2)
       and not exists (select 1 from wms.wave_orders wo where wo.order_id = o.id and wo.active)
     order by o.priority, o.created_at`,
    [ctx.user.companyId, warehouseId ?? null],
  );
}

export async function listDocks(ctx: Ctx) {
  return ctx.db.query<{ id: string; code: string; warehouse_id: string }>(
    `select l.id, l.code, l.warehouse_id from wms.locations l join wms.zones z on z.id = l.zone_id
     where l.company_id = $1 and z.zone_type = 'shipping' and z.active and l.status = 'active' order by l.code`,
    [ctx.user.companyId],
  );
}

// -----------------------------------------------------------------------------
// Criação e montagem
// -----------------------------------------------------------------------------

const createSchema = z.object({
  warehouseId: uuid("Depósito"),
  grouping: z.enum(WAVE_GROUPINGS, { error: "Critério de agrupamento inválido." }),
  dockLocationId: optionalUuid,
  carrier: optionalText,
  plannedDate: optionalText,
  orderIds: z.array(z.string().uuid()).default([]),
  notes: optionalText,
});

async function resolveDock(tx: Queryable, ctx: Ctx, warehouseId: string, dockId: string | null) {
  const [dock] = await tx.query<{ id: string; code: string }>(
    `select l.id, l.code from wms.locations l join wms.zones z on z.id = l.zone_id
     where l.company_id = $1 and l.warehouse_id = $2 and z.zone_type = 'shipping' and z.active and l.status = 'active'
       and ($3::uuid is null or l.id = $3) order by l.code limit 1`,
    [ctx.user.companyId, warehouseId, dockId],
  );
  if (!dock) throw new DomainError("Selecione uma doca ativa (endereço de zona de expedição) do depósito.", "VALIDATION", "dockLocationId");
  return dock;
}

/**
 * Cria uma onda com os pedidos reservados que atendem ao critério:
 *  - doca: pedidos com a doca planejada igual à escolhida;
 *  - transportadora: pedidos com a mesma transportadora;
 *  - data: pedidos com a mesma data prevista de expedição;
 *  - manual: os pedidos selecionados.
 */
export async function createWave(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "wave.manage");
  const raw = (input ?? {}) as Record<string, unknown>;
  const orderIds = Array.isArray(raw.orderIds) ? raw.orderIds : typeof raw.orderIds === "string" ? [raw.orderIds] : [];
  const d = parse(createSchema, { ...raw, orderIds: orderIds.filter(Boolean) });
  return runOperation(ctx, "wave.create", opts, async (tx) => {
    const dock = await resolveDock(tx, ctx, d.warehouseId, d.dockLocationId ?? null);
    let groupingValue: string | null = null;
    let where: string;
    let param: unknown;
    switch (d.grouping) {
      case "dock":
        if (!d.dockLocationId) throw new DomainError("Selecione a doca para agrupar.", "VALIDATION", "dockLocationId");
        where = "o.staging_location_id = $3::uuid";
        param = dock.id;
        groupingValue = dock.code;
        break;
      case "carrier":
        if (!d.carrier) throw new DomainError("Informe a transportadora.", "VALIDATION", "carrier");
        where = "lower(o.carrier) = lower($3::text)";
        param = d.carrier;
        groupingValue = d.carrier;
        break;
      case "date":
        if (!d.plannedDate || !/^\d{4}-\d{2}-\d{2}$/.test(d.plannedDate)) {
          throw new DomainError("Informe a data prevista de expedição (AAAA-MM-DD).", "VALIDATION", "plannedDate");
        }
        where = "o.planned_ship_date = $3::date";
        param = d.plannedDate;
        groupingValue = d.plannedDate;
        break;
      default:
        if (!d.orderIds.length) throw new DomainError("Selecione ao menos um pedido.", "VALIDATION", "orderIds");
        where = "o.id = any($3::uuid[])";
        param = d.orderIds;
    }
    const orders = await tx.query<{ id: string; code: string }>(
      `select o.id, o.code from wms.outbound_orders o
       where o.company_id = $1 and o.warehouse_id = $2 and o.status = 'reserved' and ${where}
         and not exists (select 1 from wms.wave_orders wo where wo.order_id = o.id and wo.active)
       order by o.priority, o.created_at for update`,
      [ctx.user.companyId, d.warehouseId, param],
    );
    if (d.grouping === "manual" && orders.length !== new Set(d.orderIds).size) {
      throw new DomainError("Algum pedido selecionado não está reservado, é de outro depósito ou já está em outra onda ativa.");
    }
    if (!orders.length) throw new DomainError("Nenhum pedido reservado (fora de outra onda ativa) atende ao critério escolhido.");
    const [company] = await tx.query<{ is_demo: boolean }>(`select is_demo from erp.companies where id = $1`, [ctx.user.companyId]);
    const code = await nextCode(tx, ctx.user.companyId, "OND");
    const [wave] = await tx.query<{ id: string }>(
      `insert into wms.waves (company_id, warehouse_id, code, grouping, grouping_value, dock_location_id, notes, is_demo, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [ctx.user.companyId, d.warehouseId, code, d.grouping, groupingValue, dock.id, d.notes, company?.is_demo ?? false, ctx.user.id],
    );
    for (const o of orders) {
      await tx.query(`insert into wms.wave_orders (company_id, wave_id, order_id, added_by) values ($1,$2,$3,$4)`, [
        ctx.user.companyId,
        wave.id,
        o.id,
        ctx.user.id,
      ]);
    }
    await audit(tx, ctx, "wave.created", "wave", wave.id, code, { grouping: d.grouping, value: groupingValue, orders: orders.map((o) => o.code) });
    return { id: wave.id, code, orders: orders.length };
  });
}

export async function addOrderToWave(ctx: Ctx, waveId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "wave.manage");
  const d = parse(z.object({ orderId: uuid("Pedido") }), input);
  return runOperation(ctx, "wave.add_order", opts, async (tx) => {
    const w = await lockWave(tx, ctx, waveId);
    requireWaveStatus(w, ["draft"], "incluir pedidos");
    const [o] = await tx.query<{ id: string; code: string; status: string; warehouse_id: string }>(
      `select id, code, status, warehouse_id from wms.outbound_orders where id = $1 and company_id = $2 for update`,
      [d.orderId, ctx.user.companyId],
    );
    if (!o) throw new NotFoundError("Pedido de saída");
    if (o.status !== "reserved") throw new DomainError(`O pedido ${o.code} precisa estar reservado para entrar em uma onda.`, "INVALID_STATUS");
    if (o.warehouse_id !== w.warehouse_id) throw new DomainError("O pedido é de outro depósito.");
    const [other] = await tx.query<{ code: string }>(
      `select wv.code from wms.wave_orders wo join wms.waves wv on wv.id = wo.wave_id where wo.order_id = $1 and wo.active`,
      [o.id],
    );
    if (other) throw new DomainError(`O pedido ${o.code} já está na onda ativa ${other.code}.`, "DUPLICATE");
    await tx.query(
      `insert into wms.wave_orders (company_id, wave_id, order_id, added_by) values ($1,$2,$3,$4)
       on conflict (wave_id, order_id) do update set active = true, removed_at = null, added_by = excluded.added_by, added_at = now()`,
      [ctx.user.companyId, waveId, o.id, ctx.user.id],
    );
    await audit(tx, ctx, "wave.order_added", "wave", waveId, w.code, { order: o.code });
    return { id: waveId };
  });
}

export async function removeOrderFromWave(ctx: Ctx, waveId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "wave.manage");
  const d = parse(z.object({ orderId: uuid("Pedido") }), input);
  return runOperation(ctx, "wave.remove_order", opts, async (tx) => {
    const w = await lockWave(tx, ctx, waveId);
    requireWaveStatus(w, ["draft"], "retirar pedidos");
    const rows = await tx.query(
      `update wms.wave_orders set active = false, removed_at = now() where wave_id = $1 and order_id = $2 and active returning id`,
      [waveId, d.orderId],
    );
    if (!rows.length) throw new DomainError("O pedido não está nesta onda.");
    const [left] = await tx.query<{ n: number }>(`select count(*) as n from wms.wave_orders where wave_id = $1 and active`, [waveId]);
    if (left.n === 0) throw new DomainError("A onda ficaria vazia. Cancele a onda em vez de retirar o último pedido.");
    await audit(tx, ctx, "wave.order_removed", "wave", waveId, w.code, { orderId: d.orderId });
    return { id: waveId };
  });
}

// -----------------------------------------------------------------------------
// Liberação: consolidação e roteiro
// -----------------------------------------------------------------------------

const naturalCompare = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true });

export interface RouteStop {
  aisle: string;
  bay: string;
  level: string;
  position: string;
}

/**
 * Ordena as paradas do roteiro: rua crescente; dentro da rua, módulos em
 * serpentina (crescente nas ruas ímpares da sequência, decrescente nas pares);
 * depois nível (do mais baixo ao mais alto) e posição.
 */
export function sequenceRoute<T extends RouteStop>(stops: T[]): T[] {
  const aisles = [...new Set(stops.map((s) => s.aisle))].sort(naturalCompare);
  const aisleIndex = new Map(aisles.map((a, i) => [a, i]));
  return [...stops].sort((x, y) => {
    const ax = aisleIndex.get(x.aisle)!;
    const ay = aisleIndex.get(y.aisle)!;
    if (ax !== ay) return ax - ay;
    const bay = naturalCompare(x.bay, y.bay) * (ax % 2 === 0 ? 1 : -1);
    if (bay !== 0) return bay;
    const level = naturalCompare(x.level, y.level);
    if (level !== 0) return level;
    return naturalCompare(x.position, y.position);
  });
}

export async function releaseWave(ctx: Ctx, waveId: string, opts?: OpOptions) {
  assertCan(ctx, "wave.manage");
  return runOperation(ctx, "wave.release", opts, async (tx) => {
    const w = await lockWave(tx, ctx, waveId);
    requireWaveStatus(w, ["draft"], "liberar");
    const orders = await tx.query<{ id: string; code: string; status: string; priority: number }>(
      `select o.id, o.code, o.status, o.priority from wms.wave_orders wo join wms.outbound_orders o on o.id = wo.order_id
       where wo.wave_id = $1 and wo.active order by o.id for update of o`,
      [waveId],
    );
    if (!orders.length) throw new DomainError("A onda não possui pedidos.");
    const notReserved = orders.filter((o) => o.status !== "reserved");
    if (notReserved.length) {
      throw new DomainError(`Todos os pedidos precisam estar reservados: ${notReserved.map((o) => `${o.code} (${o.status})`).join(", ")}.`, "INVALID_STATUS");
    }
    const reservations = await tx.query<{
      id: string;
      order_id: string;
      order_line_id: string;
      location_id: string;
      product_id: string;
      lot_code: string;
      quantity: number;
      expiry_date: string | null;
      aisle: string;
      bay: string;
      level: string;
      position: string;
    }>(
      `select r.id, l.order_id, r.order_line_id, r.location_id, r.product_id, r.lot_code, r.quantity, b.expiry_date::text as expiry_date,
              loc.aisle, loc.bay, loc.level, loc.position
       from wms.stock_reservations r join wms.outbound_order_lines l on l.id = r.order_line_id
       join wms.stock_balances b on b.id = r.balance_id join wms.locations loc on loc.id = r.location_id
       where l.order_id = any($1::uuid[]) and r.status = 'active' order by r.created_at for update of r`,
      [orders.map((o) => o.id)],
    );
    if (!reservations.length) throw new DomainError("Não há reservas ativas para separar nesta onda.");
    const groups = new Map<string, { stop: RouteStop; items: typeof reservations }>();
    for (const r of reservations) {
      const k = `${r.location_id}|${r.product_id}|${r.lot_code}`;
      if (!groups.has(k)) groups.set(k, { stop: r, items: [] });
      groups.get(k)!.items.push(r);
    }
    const route = sequenceRoute([...groups.values()].map((g) => ({ ...g.stop, group: g })));
    const priority = Math.min(...orders.map((o) => o.priority));
    const tasks: string[] = [];
    let seq = 1;
    for (const { group } of route) {
      const first = group.items[0];
      const total = round3(group.items.reduce((a, r) => a + r.quantity, 0));
      const code = await nextCode(tx, ctx.user.companyId, "TAR");
      const [t] = await tx.query<{ id: string }>(
        `insert into wms.tasks (company_id, warehouse_id, code, task_type, priority, product_id, lot_code, expiry_date, quantity,
                                from_location_id, to_location_id, wave_id, pick_sequence, notes, created_by)
         values ($1,$2,$3,'picking',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
        [
          ctx.user.companyId,
          w.warehouse_id,
          code,
          priority,
          first.product_id,
          first.lot_code,
          first.expiry_date,
          total,
          first.location_id,
          w.dock_location_id,
          waveId,
          seq++,
          `Separação consolidada da onda ${w.code} (${group.items.length} reserva(s)).`,
          ctx.user.id,
        ],
      );
      for (const r of group.items) {
        await tx.query(
          `insert into wms.task_allocations (company_id, task_id, reservation_id, order_id, order_line_id, quantity)
           values ($1,$2,$3,$4,$5,$6)`,
          [ctx.user.companyId, t.id, r.id, r.order_id, r.order_line_id, r.quantity],
        );
      }
      await recordTaskEvent(tx, t.id, ctx.user.id, "created", null, "pending", { wave: w.code, sequence: seq - 1 });
      tasks.push(code);
    }
    await tx.query(
      `update wms.outbound_orders set status = 'picking', staging_location_id = $2, updated_at = now(), version = version + 1
       where id = any($1::uuid[])`,
      [orders.map((o) => o.id), w.dock_location_id],
    );
    for (const o of orders) {
      await audit(tx, ctx, "outbound.picking_released", "outbound_order", o.id, o.code, { wave: w.code });
    }
    await tx.query(
      `update wms.waves set status = 'released', released_at = now(), released_by = $2, version = version + 1 where id = $1`,
      [waveId, ctx.user.id],
    );
    await audit(tx, ctx, "wave.released", "wave", waveId, w.code, { tasks, orders: orders.map((o) => o.code) });
    return { id: waveId, tasks };
  });
}

export async function cancelWave(ctx: Ctx, waveId: string, input: unknown) {
  assertCan(ctx, "wave.manage");
  const d = parse(z.object({ reason: z.string().trim().min(5, "Informe o motivo do cancelamento.") }), input);
  return runOperation(ctx, "wave.cancel", undefined, async (tx) => {
    const w = await lockWave(tx, ctx, waveId);
    requireWaveStatus(w, ["draft", "released"], "cancelar");
    const tasks = await tx.query<{ id: string; status: string }>(
      `select id, status from wms.tasks where wave_id = $1 and status <> 'cancelled' for update`,
      [waveId],
    );
    if (tasks.some((t) => t.status !== "pending")) {
      throw new DomainError("A separação da onda já começou. Cancele os pedidos individualmente (com devolução ao endereço).", "INVALID_STATUS");
    }
    for (const t of tasks) {
      await tx.query(`update wms.tasks set status = 'cancelled', cancelled_at = now(), cancel_reason = $2, version = version + 1 where id = $1`, [
        t.id,
        `Onda ${w.code} cancelada: ${d.reason}`,
      ]);
      await tx.query(`update wms.task_allocations set status = 'cancelled' where task_id = $1`, [t.id]);
      await recordTaskEvent(tx, t.id, ctx.user.id, "cancelled", t.status, "cancelled", d);
    }
    // Pedidos voltam a "reservado": as reservas continuam ativas.
    await tx.query(
      `update wms.outbound_orders o set status = 'reserved', updated_at = now(), version = version + 1
       from wms.wave_orders wo where wo.order_id = o.id and wo.wave_id = $1 and wo.active and o.status = 'picking'`,
      [waveId],
    );
    await tx.query(`update wms.wave_orders set active = false, removed_at = now() where wave_id = $1 and active`, [waveId]);
    await tx.query(
      `update wms.waves set status = 'cancelled', cancelled_at = now(), cancel_reason = $2, version = version + 1 where id = $1`,
      [waveId, d.reason],
    );
    await audit(tx, ctx, "wave.cancelled", "wave", waveId, w.code, d);
    return { id: waveId };
  });
}

// -----------------------------------------------------------------------------
// Execução e progresso
// -----------------------------------------------------------------------------

/** Atualiza o status da onda conforme as tarefas: liberada → em separação → separada. */
export async function refreshWaveStatus(tx: Queryable, ctx: Ctx, waveId: string): Promise<void> {
  const w = await lockWave(tx, ctx, waveId);
  if (!["released", "picking"].includes(w.status)) return;
  const [s] = await tx.query<{ open: number; progressed: number }>(
    `select count(*) filter (where status in ('pending', 'in_progress')) as open,
            count(*) filter (where status in ('in_progress', 'completed')) as progressed
     from wms.tasks where wave_id = $1`,
    [waveId],
  );
  if (s.open === 0) {
    await tx.query(`update wms.waves set status = 'picked', picked_at = now(), version = version + 1 where id = $1`, [waveId]);
    await audit(tx, ctx, "wave.picked", "wave", waveId, w.code);
  } else if (w.status === "released" && s.progressed > 0) {
    await tx.query(`update wms.waves set status = 'picking', version = version + 1 where id = $1`, [waveId]);
  }
}

/**
 * Pedido "em separação" passa a "separado" quando não há tarefa/alocação aberta
 * e, se estiver em uma onda ativa, depois da distribuição na doca.
 */
export async function refreshOrderPickStatus(tx: Queryable, ctx: Ctx, orderId: string): Promise<void> {
  const [o] = await tx.query<{ code: string; status: string }>(`select code, status from wms.outbound_orders where id = $1 for update`, [orderId]);
  if (!o || o.status !== "picking") return;
  const [open] = await tx.query<{ n: number }>(
    `select (select count(*) from wms.tasks where order_id = $1 and task_type = 'picking' and status in ('pending', 'in_progress'))
          + (select count(*) from wms.task_allocations where order_id = $1 and status = 'open') as n`,
    [orderId],
  );
  if (open.n > 0) return;
  const [inWave] = await tx.query<{ distributed_at: string | null }>(
    `select distributed_at::text as distributed_at from wms.wave_orders where order_id = $1 and active`,
    [orderId],
  );
  if (inWave && !inWave.distributed_at) return;
  await tx.query(
    `update wms.outbound_orders set status = 'picked', picked_at = now(), updated_at = now(), version = version + 1 where id = $1`,
    [orderId],
  );
  await audit(tx, ctx, "outbound.picked", "outbound_order", orderId, o.code);
}

interface WaveTask {
  id: string;
  code: string;
  warehouse_id: string;
  wave_id: string | null;
  product_id: string | null;
  lot_code: string;
  quantity: number | null;
  from_location_id: string | null;
  to_location_id: string | null;
}

/**
 * Conclui uma tarefa consolidada de onda: retira do endereço o total separado e
 * distribui entre os pedidos por prioridade (alta primeiro, depois o mais
 * antigo). Cada pedido recebe uma movimentação de separação própria para a doca,
 * já reservada a ele; o que faltar vira divergência por pedido e a reserva
 * correspondente é liberada.
 */
export async function completeWavePickTx(
  tx: Queryable,
  ctx: Ctx,
  t: WaveTask,
  a: { picked: number | null; confirmLocationId: string | null; notes: string | null; serials: string[] },
) {
  if (a.confirmLocationId && a.confirmLocationId !== t.from_location_id) {
    throw new DomainError("O endereço confirmado não corresponde ao endereço de origem da separação.", "LOCATION_MISMATCH");
  }
  const allocations = await tx.query<{
    id: string;
    reservation_id: string;
    order_id: string;
    order_code: string;
    order_line_id: string;
    quantity: number;
    balance_id: string;
    res_quantity: number;
    res_status: string;
  }>(
    `select a.id, a.reservation_id, a.order_id, o.code as order_code, a.order_line_id, a.quantity, r.balance_id,
            r.quantity as res_quantity, r.status as res_status
     from wms.task_allocations a join wms.outbound_orders o on o.id = a.order_id join wms.stock_reservations r on r.id = a.reservation_id
     where a.task_id = $1 and a.status = 'open' order by o.priority, o.created_at, o.code for update of a, r`,
    [t.id],
  );
  if (!allocations.length) throw new DomainError("A tarefa não possui pedidos a atender (todos cancelados).", "RESERVATION_MISMATCH");
  const planned = round3(allocations.reduce((s, x) => s + x.quantity, 0));
  const picked = a.picked ?? planned;
  if (picked > planned) throw new DomainError(`Quantidade separada (${picked}) maior que a planejada (${planned}).`, "OVER_PICK");
  const [sku] = await tx.query<{ sku: string }>(`select sku from erp.products where id = $1`, [t.product_id]);
  const serialControlled = await isSerialControlled(tx, t.product_id!);
  if (serialControlled && a.serials.length !== picked) {
    throw new DomainError(`Informe ${picked} número(s) de série para ${sku.sku} (informados: ${a.serials.length}).`, "SERIAL_COUNT", "serials");
  }
  let remaining = picked;
  let serialCursor = 0;
  let totalShort = 0;
  for (const al of allocations) {
    if (al.res_status !== "active") throw new DomainError("Reserva da separação não está ativa.", "RESERVATION_MISMATCH");
    const take = round3(Math.min(al.quantity, remaining));
    const shortfall = round3(al.quantity - take);
    remaining = round3(remaining - take);
    const origin = await removeStock(tx, ctx, { balanceId: al.balance_id, quantity: take, consumeReserved: take });
    if (shortfall > 0) await changeReserved(tx, al.balance_id, -shortfall);
    if (take > 0) {
      await addStock(tx, ctx, {
        warehouseId: t.warehouse_id,
        locationId: t.to_location_id!,
        productId: t.product_id!,
        lotCode: t.lot_code,
        expiryDate: origin.expiry_date,
        quantity: take,
        reserved: take,
      });
      const movementId = await insertMovement(tx, ctx, {
        warehouseId: t.warehouse_id,
        movementType: "pick",
        productId: t.product_id!,
        lotCode: t.lot_code,
        expiryDate: origin.expiry_date,
        quantity: take,
        fromLocationId: t.from_location_id,
        toLocationId: t.to_location_id,
        reason: "Separação em onda",
        referenceType: "outbound_order",
        referenceId: al.order_id,
        referenceCode: al.order_code,
        taskId: t.id,
      });
      if (serialControlled) {
        await pickSerials(tx, ctx, {
          productId: t.product_id!,
          sku: sku.sku,
          serials: a.serials.slice(serialCursor, serialCursor + take),
          quantity: take,
          fromLocationId: t.from_location_id!,
          dockLocationId: t.to_location_id!,
          orderId: al.order_id,
          orderLineId: al.order_line_id,
          movementId,
        });
        serialCursor += take;
      }
    }
    await tx.query(`update wms.stock_reservations set status = 'picked', picked_qty = $2, closed_at = now() where id = $1`, [
      al.reservation_id,
      take,
    ]);
    await tx.query(`update wms.task_allocations set status = 'picked', picked_qty = $2 where id = $1`, [al.id, take]);
    await tx.query(`update wms.outbound_order_lines set picked_qty = picked_qty + $2, reserved_qty = reserved_qty - $3 where id = $1`, [
      al.order_line_id,
      take,
      shortfall,
    ]);
    if (shortfall > 0) {
      totalShort = round3(totalShort + shortfall);
      await tx.query(
        `insert into wms.divergences (company_id, source, divergence_type, product_id, quantity, description, order_id,
                                      order_line_id, task_id, created_by)
         values ($1, 'picking', 'short_pick', $2, $3, $4, $5, $6, $7, $8)`,
        [
          ctx.user.companyId,
          t.product_id,
          shortfall,
          `Separação a menor na tarefa ${t.code} (onda): pedido ${al.order_code} recebeu ${take} de ${al.quantity}.${a.notes ? ` Obs.: ${a.notes}` : ""}`,
          al.order_id,
          al.order_line_id,
          t.id,
          ctx.user.id,
        ],
      );
    }
  }
  if (totalShort > 0) await emergencyReplenishmentTx(tx, ctx, t.from_location_id!, t.product_id!);
  return { confirmed: picked, destination: t.to_location_id!, orders: [...new Set(allocations.map((x) => x.order_id))] };
}

/** Pós-separação comum (onda ou pedido): progresso da onda, status dos pedidos e reposição. */
export async function afterPickTx(tx: Queryable, ctx: Ctx, a: { waveId: string | null; orderIds: string[]; warehouseId: string; productId: string }) {
  if (a.waveId) await refreshWaveStatus(tx, ctx, a.waveId);
  for (const id of a.orderIds) await refreshOrderPickStatus(tx, ctx, id);
  await checkReplenishmentTx(tx, ctx, { warehouseId: a.warehouseId, productIds: [a.productId] });
}

// -----------------------------------------------------------------------------
// Distribuição na doca
// -----------------------------------------------------------------------------

/**
 * Confirma a distribuição de um pedido na doca (volumes separados em onda
 * segregados por pedido). O pedido passa a "Separado" e segue para a conferência
 * individual. Quando todos os pedidos ativos foram distribuídos, a onda é concluída.
 */
export async function distributeWaveOrder(ctx: Ctx, waveId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "outbound.check");
  const d = parse(z.object({ orderId: uuid("Pedido") }), input);
  return runOperation(ctx, "wave.distribute", opts, async (tx) => {
    const w = await lockWave(tx, ctx, waveId);
    requireWaveStatus(w, ["picked"], "distribuir na doca (a separação da onda precisa estar concluída)");
    const [wo] = await tx.query<{ id: string; distributed_at: string | null; code: string }>(
      `select wo.id, wo.distributed_at::text as distributed_at, o.code from wms.wave_orders wo join wms.outbound_orders o on o.id = wo.order_id
       where wo.wave_id = $1 and wo.order_id = $2 and wo.active for update of wo`,
      [waveId, d.orderId],
    );
    if (!wo) throw new DomainError("O pedido não está ativo nesta onda.");
    if (wo.distributed_at) throw new DomainError(`O pedido ${wo.code} já foi distribuído.`, "INVALID_STATUS");
    await tx.query(`update wms.wave_orders set distributed_at = now(), distributed_by = $2 where id = $1`, [wo.id, ctx.user.id]);
    await refreshOrderPickStatus(tx, ctx, d.orderId);
    await audit(tx, ctx, "wave.order_distributed", "wave", waveId, w.code, { order: wo.code });
    await completeWaveIfDone(tx, ctx, waveId);
    return { id: waveId, order: wo.code };
  });
}

/** Conclui (ou cancela, se ficou sem pedidos) a onda quando não há mais o que distribuir. */
export async function completeWaveIfDone(tx: Queryable, ctx: Ctx, waveId: string): Promise<void> {
  const w = await lockWave(tx, ctx, waveId);
  const [s] = await tx.query<{ active: number; pending: number; distributed: number }>(
    `select count(*) filter (where active) as active, count(*) filter (where active and distributed_at is null) as pending,
            count(*) filter (where distributed_at is not null) as distributed
     from wms.wave_orders where wave_id = $1`,
    [waveId],
  );
  if (["completed", "cancelled"].includes(w.status)) return;
  if (s.active === 0 && s.distributed === 0) {
    await tx.query(`update wms.tasks set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Onda sem pedidos ativos' where wave_id = $1 and status in ('pending', 'in_progress')`, [waveId]);
    await tx.query(
      `update wms.waves set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Todos os pedidos da onda foram cancelados', version = version + 1 where id = $1`,
      [waveId],
    );
    await audit(tx, ctx, "wave.cancelled", "wave", waveId, w.code, { reason: "Todos os pedidos cancelados" });
    return;
  }
  if (w.status === "picked" && s.pending === 0) {
    await tx.query(`update wms.wave_orders set active = false where wave_id = $1 and active`, [waveId]);
    await tx.query(`update wms.waves set status = 'completed', completed_at = now(), version = version + 1 where id = $1`, [waveId]);
    await audit(tx, ctx, "wave.completed", "wave", waveId, w.code);
  }
}

/**
 * Remove um pedido (cancelado) da onda: as alocações abertas saem das tarefas
 * consolidadas (que têm a quantidade reduzida ou são canceladas). Retorna as
 * reservas desalocadas para o chamador liberar.
 */
export async function detachOrderFromWaveTx(tx: Queryable, ctx: Ctx, orderId: string, lineId: string | null): Promise<void> {
  const allocations = await tx.query<{ id: string; task_id: string; quantity: number; task_status: string; task_quantity: number; wave_id: string }>(
    `select a.id, a.task_id, a.quantity, t.status as task_status, t.quantity as task_quantity, t.wave_id
     from wms.task_allocations a join wms.tasks t on t.id = a.task_id
     where a.order_id = $1 and ($2::uuid is null or a.order_line_id = $2) and a.status = 'open' for update of a, t`,
    [orderId, lineId],
  );
  const waves = new Set<string>();
  for (const a of allocations) {
    waves.add(a.wave_id);
    await tx.query(`update wms.task_allocations set status = 'cancelled' where id = $1`, [a.id]);
    const left = round3(a.task_quantity - a.quantity);
    if (left > 0) {
      await tx.query(`update wms.tasks set quantity = $2, version = version + 1 where id = $1`, [a.task_id, left]);
      await recordTaskEvent(tx, a.task_id, ctx.user.id, "reduced", a.task_status, a.task_status, { removed: a.quantity, quantity: left });
    } else {
      await tx.query(
        `update wms.tasks set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Pedidos da tarefa cancelados', version = version + 1 where id = $1`,
        [a.task_id],
      );
      await recordTaskEvent(tx, a.task_id, ctx.user.id, "cancelled", a.task_status, "cancelled", { reason: "Pedido cancelado" });
    }
  }
  if (!lineId) {
    const rows = await tx.query<{ wave_id: string }>(
      `update wms.wave_orders set active = false, removed_at = now() where order_id = $1 and active returning wave_id`,
      [orderId],
    );
    rows.forEach((r) => waves.add(r.wave_id));
  }
  for (const w of waves) {
    await refreshWaveStatus(tx, ctx, w);
    await completeWaveIfDone(tx, ctx, w);
  }
}
