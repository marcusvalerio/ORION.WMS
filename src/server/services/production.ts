import "server-only";
import { z } from "zod";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { assertWarehouseAccess, hasWarehouseAccess, warehouseScope } from "../access";
import { DomainError, NotFoundError } from "../errors";
import { parse, uuid, optionalText, optionalDate, checkbox, qty } from "../validation";
import * as erp from "../integrations/erp/gateway";
import { audit, enqueueIntegrationEvent, nextCode, recordTaskEvent, round3, runOperation, type OpOptions } from "./common";
import {
  addStock,
  availableOf,
  changeReserved,
  getProductRules,
  insertMovement,
  lockBalance,
  removeStock,
  suggestLocations,
  validateDestination,
  type BalanceRow,
} from "./stock-core";

/**
 * Abastecimento de produção (requisição de materiais do MRP do ERP).
 *
 * Fluxo: ordem de produção do ERP → requisição no WMS → reserva FEFO dos
 * componentes → tarefas de separação até o endereço da linha (zona "production")
 * → entrega à linha com confirmação (baixa do estoque do WMS) → devolução de
 * sobras ao estoque → recebimento do produto acabado (lote da ordem) com
 * armazenagem normal → encerramento.
 */

export const REQUISITION_STATUSES = ["open", "reserved", "picking", "delivered", "completed", "cancelled"] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

interface RequisitionHeader {
  id: string;
  code: string;
  status: RequisitionStatus;
  warehouse_id: string;
  production_order_id: string;
  line_location_id: string;
  all_or_nothing: boolean;
  output_product_id: string;
  planned_output_qty: number;
  output_lot_code: string;
  output_qty: number;
}

async function lockRequisition(tx: Queryable, ctx: Ctx, id: string): Promise<RequisitionHeader> {
  const [r] = await tx.query<RequisitionHeader>(
    `select id, code, status, warehouse_id, production_order_id, line_location_id, all_or_nothing, output_product_id,
            planned_output_qty, output_lot_code, output_qty
     from wms.production_requisitions where id = $1 and company_id = $2 for update`,
    [id, ctx.user.companyId],
  );
  if (!r) throw new NotFoundError("Requisição de produção");
  assertWarehouseAccess(ctx, r.warehouse_id);
  return r;
}

function requireStatus(r: RequisitionHeader, allowed: RequisitionStatus[], action: string) {
  if (!allowed.includes(r.status)) {
    throw new DomainError(`Não é possível ${action}: a requisição ${r.code} está com status "${r.status}".`, "INVALID_STATUS");
  }
}

async function productionOrderNumber(q: Queryable, id: string): Promise<string> {
  const [o] = await q.query<{ number: string }>(`select number from erp.production_orders where id = $1`, [id]);
  return o?.number ?? "";
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export interface RequisitionListRow {
  id: string;
  code: string;
  status: RequisitionStatus;
  order_number: string;
  sku: string;
  description: string;
  planned_output_qty: number;
  output_qty: number;
  output_lot_code: string;
  warehouse_code: string;
  line_code: string;
  lines: number;
  required: number;
  reserved: number;
  picked: number;
  delivered: number;
  returned: number;
  created_at: string;
}

export async function listRequisitions(ctx: Ctx, f: { status?: string | null } = {}) {
  const params: unknown[] = [ctx.user.companyId];
  let where = "r.company_id = $1";
  if (f.status && (REQUISITION_STATUSES as readonly string[]).includes(f.status)) {
    params.push(f.status);
    where += ` and r.status = $${params.length}`;
  }
  where += warehouseScope(ctx, "r.warehouse_id", params);
  return ctx.db.query<RequisitionListRow>(
    `select r.id, r.code, r.status, o.number as order_number, p.sku, p.description, r.planned_output_qty, r.output_qty,
            r.output_lot_code, w.code as warehouse_code, l.code as line_code,
            (select count(*) from wms.production_requisition_lines x where x.requisition_id = r.id) as lines,
            coalesce((select sum(required_qty) from wms.production_requisition_lines x where x.requisition_id = r.id), 0) as required,
            coalesce((select sum(reserved_qty) from wms.production_requisition_lines x where x.requisition_id = r.id), 0) as reserved,
            coalesce((select sum(picked_qty) from wms.production_requisition_lines x where x.requisition_id = r.id), 0) as picked,
            coalesce((select sum(delivered_qty) from wms.production_requisition_lines x where x.requisition_id = r.id), 0) as delivered,
            coalesce((select sum(returned_qty) from wms.production_requisition_lines x where x.requisition_id = r.id), 0) as returned,
            r.created_at::text as created_at
     from wms.production_requisitions r
     join erp.production_orders o on o.id = r.production_order_id
     join erp.products p on p.id = r.output_product_id
     join wms.warehouses w on w.id = r.warehouse_id
     join wms.locations l on l.id = r.line_location_id
     where ${where}
     order by r.created_at desc`,
    params,
  );
}

export async function listErpProductionOrders(ctx: Ctx) {
  return erp.listProductionOrders(ctx.db, ctx.user.companyId);
}

/** Endereços ativos em zonas de produção (linhas), para abastecimento. */
export async function listProductionLines(ctx: Ctx) {
  const params: unknown[] = [ctx.user.companyId];
  const scope = warehouseScope(ctx, "l.warehouse_id", params);
  return ctx.db.query<{ id: string; code: string; warehouse_id: string; warehouse_code: string; zone_name: string }>(
    `select l.id, l.code, l.warehouse_id, w.code as warehouse_code, z.name as zone_name
     from wms.locations l join wms.zones z on z.id = l.zone_id join wms.warehouses w on w.id = l.warehouse_id
     where l.company_id = $1 and z.zone_type = 'production' and z.active and l.status = 'active'${scope}
     order by l.code`,
    params,
  );
}

export interface RequisitionLineRow {
  id: string;
  line_no: number;
  product_id: string;
  sku: string;
  description: string;
  uom: string;
  required_qty: number;
  reserved_qty: number;
  picked_qty: number;
  delivered_qty: number;
  returned_qty: number;
}

export interface ProductionReservationRow {
  id: string;
  line_id: string;
  sku: string;
  location_id: string;
  location_code: string;
  lot_code: string;
  expiry_date: string | null;
  quantity: number;
  picked_qty: number;
  status: string;
  origin_country: string | null;
}

export async function getRequisition(ctx: Ctx, id: string) {
  const [header] = await ctx.db.query<
    RequisitionHeader & {
      order_number: string;
      order_status: string;
      due_date: string | null;
      sku: string;
      description: string;
      uom: string;
      warehouse_code: string;
      line_code: string;
      notes: string | null;
      created_at: string;
      created_by_name: string;
      delivered_at: string | null;
      completed_at: string | null;
      cancel_reason: string | null;
    }
  >(
    `select r.id, r.code, r.status, r.warehouse_id, r.production_order_id, r.line_location_id, r.all_or_nothing, r.output_product_id,
            r.planned_output_qty, r.output_lot_code, r.output_qty, o.number as order_number, o.status as order_status,
            o.due_date::text as due_date, p.sku, p.description, p.uom, w.code as warehouse_code, l.code as line_code, r.notes,
            r.created_at::text as created_at, u.name as created_by_name, r.delivered_at::text as delivered_at,
            r.completed_at::text as completed_at, r.cancel_reason
     from wms.production_requisitions r
     join erp.production_orders o on o.id = r.production_order_id
     join erp.products p on p.id = r.output_product_id
     join wms.warehouses w on w.id = r.warehouse_id
     join wms.locations l on l.id = r.line_location_id
     join wms.users u on u.id = r.created_by
     where r.id = $1 and r.company_id = $2`,
    [id, ctx.user.companyId],
  );
  if (!header || !hasWarehouseAccess(ctx, header.warehouse_id)) return null;
  const lines = await ctx.db.query<RequisitionLineRow>(
    `select x.id, x.line_no, x.product_id, p.sku, p.description, p.uom, x.required_qty, x.reserved_qty, x.picked_qty,
            x.delivered_qty, x.returned_qty
     from wms.production_requisition_lines x join erp.products p on p.id = x.product_id
     where x.requisition_id = $1 order by x.line_no`,
    [id],
  );
  const reservations = await ctx.db.query<ProductionReservationRow>(
    `select v.id, v.line_id, p.sku, v.location_id, l.code as location_code, v.lot_code, v.expiry_date::text as expiry_date,
            v.quantity, v.picked_qty, v.status, lo.origin_country
     from wms.production_reservations v
     join wms.production_requisition_lines x on x.id = v.line_id
     join erp.products p on p.id = v.product_id
     join wms.locations l on l.id = v.location_id
     left join wms.lot_origins lo on lo.company_id = v.company_id and lo.product_id = v.product_id and lo.lot_code = v.lot_code
     where x.requisition_id = $1 order by x.line_no, v.expiry_date nulls last, l.code`,
    [id],
  );
  const tasks = await ctx.db.query<{
    id: string;
    code: string;
    task_type: string;
    status: string;
    sku: string;
    lot_code: string;
    quantity: number;
    confirmed_qty: number | null;
    from_code: string | null;
    to_code: string | null;
    suggested_code: string | null;
    completed_at: string | null;
  }>(
    `select t.id, t.code, t.task_type, t.status, p.sku, t.lot_code, t.quantity, t.confirmed_qty, lf.code as from_code,
            lt.code as to_code, ls.code as suggested_code, t.completed_at::text as completed_at
     from wms.tasks t join erp.products p on p.id = t.product_id
     left join wms.locations lf on lf.id = t.from_location_id
     left join wms.locations lt on lt.id = t.to_location_id
     left join wms.locations ls on ls.id = t.suggested_location_id
     where t.production_requisition_id = $1 order by t.created_at, t.code`,
    [id],
  );
  const deliveries = await ctx.db.query<{
    id: string;
    code: string;
    received_by: string;
    notes: string | null;
    delivered_by_name: string;
    created_at: string;
    items: { sku: string; lot_code: string; quantity: number }[];
  }>(
    `select d.id, d.code, d.received_by, d.notes, u.name as delivered_by_name, d.created_at::text as created_at,
            coalesce((select json_agg(json_build_object('sku', p.sku, 'lot_code', i.lot_code, 'quantity', i.quantity) order by p.sku)
                      from wms.production_delivery_items i join wms.production_requisition_lines x on x.id = i.line_id
                      join erp.products p on p.id = x.product_id where i.delivery_id = d.id), '[]'::json) as items
     from wms.production_deliveries d join wms.users u on u.id = d.delivered_by
     where d.requisition_id = $1 order by d.created_at`,
    [id],
  );
  const returns = await ctx.db.query<{ id: string; sku: string; lot_code: string; quantity: number; to_code: string; created_at: string; user_name: string }>(
    `select m.id, p.sku, m.lot_code, m.quantity, l.code as to_code, m.created_at::text as created_at, u.name as user_name
     from wms.stock_movements m join erp.products p on p.id = m.product_id join wms.locations l on l.id = m.to_location_id
     join wms.users u on u.id = m.created_by
     where m.company_id = $2 and m.reference_type = 'production_requisition' and m.reference_id = $1 and m.movement_type = 'production_return'
     order by m.created_at`,
    [id, ctx.user.companyId],
  );
  return { header, lines, reservations, tasks, deliveries, returns };
}

// -----------------------------------------------------------------------------
// Criação da requisição a partir da ordem de produção do ERP
// -----------------------------------------------------------------------------

const createSchema = z.object({
  productionOrderId: uuid("Ordem de produção"),
  lineLocationId: uuid("Linha de produção"),
  allOrNothing: checkbox,
  notes: optionalText,
});

export async function createRequisition(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "production.manage");
  const d = parse(createSchema, input);
  return runOperation(ctx, "production.create", opts, async (tx) => {
    const [locked] = await tx.query(`select id from erp.production_orders where id = $1 and company_id = $2 for update`, [
      d.productionOrderId,
      ctx.user.companyId,
    ]);
    if (!locked) throw new NotFoundError("Ordem de produção");
    const po = await erp.getProductionOrder(tx, ctx.user.companyId, d.productionOrderId);
    if (!po) throw new NotFoundError("Ordem de produção");
    if (po.status === "cancelled" || po.status === "completed") {
      throw new DomainError(`A ordem de produção ${po.number} está ${po.status === "cancelled" ? "cancelada" : "encerrada"}.`);
    }
    if (po.requisition_id) throw new DomainError(`A ordem ${po.number} já possui a requisição ${po.requisition_code}.`, "DUPLICATE");
    if (po.components.length === 0) throw new DomainError(`A ordem ${po.number} não possui lista de componentes.`, "VALIDATION");
    const [line] = await tx.query<{ warehouse_id: string; zone_type: string; status: string; zone_active: boolean; code: string }>(
      `select l.warehouse_id, z.zone_type, l.status, z.active as zone_active, l.code
       from wms.locations l join wms.zones z on z.id = l.zone_id where l.id = $1 and l.company_id = $2`,
      [d.lineLocationId, ctx.user.companyId],
    );
    if (!line) throw new NotFoundError("Endereço da linha");
    if (line.zone_type !== "production") throw new DomainError(`O endereço ${line.code} não pertence a uma zona de produção.`, "VALIDATION");
    if (line.status !== "active" || !line.zone_active) throw new DomainError(`O endereço ${line.code} não está ativo.`, "VALIDATION");
    assertWarehouseAccess(ctx, line.warehouse_id);
    const code = await nextCode(tx, ctx.user.companyId, "REQ");
    const lot = (po.output_lot_code ?? `OP-${po.number}`).toUpperCase();
    const [company] = await tx.query<{ is_demo: boolean }>(`select is_demo from erp.companies where id = $1`, [ctx.user.companyId]);
    const [r] = await tx.query<{ id: string }>(
      `insert into wms.production_requisitions (company_id, warehouse_id, code, production_order_id, line_location_id, all_or_nothing,
                                                output_product_id, planned_output_qty, output_lot_code, notes, is_demo, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [ctx.user.companyId, line.warehouse_id, code, po.id, d.lineLocationId, d.allOrNothing, po.product_id, po.quantity, lot, d.notes,
        company?.is_demo ?? false, ctx.user.id],
    );
    for (const c of po.components) {
      await tx.query(
        `insert into wms.production_requisition_lines (requisition_id, line_no, component_id, product_id, required_qty)
         values ($1,$2,$3,$4,$5)`,
        [r.id, c.line_no, c.id, c.product_id, c.quantity],
      );
    }
    await audit(tx, ctx, "production.requisition_created", "production_requisition", r.id, code, {
      productionOrder: po.number,
      allOrNothing: d.allOrNothing,
      components: po.components.length,
    });
    return { id: r.id, code };
  });
}

// -----------------------------------------------------------------------------
// Reserva FEFO dos componentes
// -----------------------------------------------------------------------------

/**
 * Reserva os componentes pendentes (requerido − reservado − separado). Regras:
 *  - somente saldo disponível em endereços ativos de zonas de armazenagem/picking,
 *    não vencido, do depósito da requisição, em ordem FEFO;
 *  - tudo ou nada (configurável na requisição): se algum componente não puder ser
 *    atendido por completo, nada é reservado; sem a opção, reserva o possível e
 *    a reserva pode ser repetida quando houver saldo.
 * A reserva nunca ultrapassa o disponível (lock dos saldos + CHECK do banco).
 */
export async function reserveRequisition(ctx: Ctx, id: string, opts?: OpOptions) {
  assertCan(ctx, "production.manage");
  return runOperation(ctx, "production.reserve", opts, async (tx) => {
    const r = await lockRequisition(tx, ctx, id);
    requireStatus(r, ["open", "reserved", "picking", "delivered"], "reservar");
    const lines = await tx.query<{ id: string; product_id: string; sku: string; required_qty: number; reserved_qty: number; picked_qty: number }>(
      `select x.id, x.product_id, p.sku, x.required_qty, x.reserved_qty, x.picked_qty
       from wms.production_requisition_lines x join erp.products p on p.id = x.product_id
       where x.requisition_id = $1 order by x.line_no for update of x`,
      [id],
    );
    const shortages: string[] = [];
    let reservations = 0;
    for (const line of lines) {
      const need = round3(line.required_qty - line.reserved_qty - line.picked_qty);
      if (need <= 0) continue;
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
        [ctx.user.companyId, r.warehouse_id, line.product_id],
      );
      let remaining = need;
      let taken = 0;
      for (const b of balances) {
        if (remaining <= 0) break;
        const take = round3(Math.min(availableOf(b), remaining));
        if (take <= 0) continue;
        await changeReserved(tx, b.id, take);
        await tx.query(
          `insert into wms.production_reservations (company_id, line_id, balance_id, location_id, product_id, lot_code, expiry_date,
                                                    quantity, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [ctx.user.companyId, line.id, b.id, b.location_id, line.product_id, b.lot_code, b.expiry_date, take, ctx.user.id],
        );
        reservations++;
        taken = round3(taken + take);
        remaining = round3(remaining - take);
      }
      if (taken > 0) await tx.query(`update wms.production_requisition_lines set reserved_qty = reserved_qty + $2 where id = $1`, [line.id, taken]);
      if (remaining > 0) shortages.push(`${line.sku}: faltam ${remaining} de ${need}`);
    }
    if (shortages.length && r.all_or_nothing) {
      // A transação inteira é desfeita: nenhuma reserva parcial permanece.
      throw new DomainError(
        `Estoque disponível insuficiente para reservar a requisição ${r.code} (tudo ou nada) — ${shortages.join("; ")}.`,
        "INSUFFICIENT_STOCK",
      );
    }
    if (reservations === 0 && shortages.length) {
      throw new DomainError(`Nenhum saldo disponível para os componentes pendentes — ${shortages.join("; ")}.`, "INSUFFICIENT_STOCK");
    }
    if (reservations === 0) throw new DomainError("Todos os componentes já estão reservados.", "VALIDATION");
    await tx.query(
      `update wms.production_requisitions set status = case when status = 'open' then 'reserved' else status end, reserved_at = coalesce(reserved_at, now()), updated_at = now(),
              version = version + 1 where id = $1`,
      [id],
    );
    await erp.setProductionOrderStatus(tx, r.production_order_id, "in_progress");
    await audit(tx, ctx, "production.reserved", "production_requisition", id, r.code, { reservations, shortages });
    return { id, reservations, shortages };
  });
}

// -----------------------------------------------------------------------------
// Separação para a linha
// -----------------------------------------------------------------------------

/** Gera uma tarefa de separação (origem → endereço da linha) por reserva ativa. */
export async function releaseRequisition(ctx: Ctx, id: string, opts?: OpOptions) {
  assertCan(ctx, "production.manage");
  return runOperation(ctx, "production.release", opts, async (tx) => {
    const r = await lockRequisition(tx, ctx, id);
    requireStatus(r, ["reserved", "picking", "delivered"], "liberar a separação");
    const reservations = await tx.query<{ id: string; product_id: string; lot_code: string; expiry_date: string | null; location_id: string; quantity: number }>(
      `select v.id, v.product_id, v.lot_code, v.expiry_date::text as expiry_date, v.location_id, v.quantity
       from wms.production_reservations v join wms.production_requisition_lines x on x.id = v.line_id
       where x.requisition_id = $1 and v.status = 'active'
         and not exists (select 1 from wms.tasks t where t.production_reservation_id = v.id and t.status <> 'cancelled')
       order by x.line_no for update of v`,
      [id],
    );
    if (reservations.length === 0) throw new DomainError("Não há reservas sem tarefa de separação.", "VALIDATION");
    const tasks: string[] = [];
    for (const v of reservations) {
      const code = await nextCode(tx, ctx.user.companyId, "TAR");
      const [t] = await tx.query<{ id: string }>(
        `insert into wms.tasks (company_id, warehouse_id, code, task_type, priority, product_id, lot_code, expiry_date, quantity,
                                from_location_id, to_location_id, production_requisition_id, production_reservation_id, created_by)
         values ($1,$2,$3,'production_pick',2,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [ctx.user.companyId, r.warehouse_id, code, v.product_id, v.lot_code, v.expiry_date, v.quantity, v.location_id, r.line_location_id,
          id, v.id, ctx.user.id],
      );
      await recordTaskEvent(tx, t.id, ctx.user.id, "created", null, "pending", { requisition: r.code });
      tasks.push(code);
    }
    await tx.query(`update wms.production_requisitions set status = 'picking', updated_at = now(), version = version + 1 where id = $1`, [id]);
    await audit(tx, ctx, "production.released", "production_requisition", id, r.code, { tasks });
    return { id, tasks };
  });
}

interface PickTask {
  id: string;
  code: string;
  warehouse_id: string;
  product_id: string | null;
  lot_code: string;
  from_location_id: string | null;
  to_location_id: string | null;
  production_requisition_id?: string | null;
  production_reservation_id?: string | null;
}

/**
 * Conclusão da tarefa de separação para produção (chamada por tasks.completeTask):
 * retira o separado da origem consumindo a reserva e o coloca no endereço da
 * linha, ainda reservado à requisição até a entrega ser confirmada. Separação a
 * menor devolve a diferença à disponibilidade e reduz a reserva da linha.
 */
export async function completeProductionPickTx(tx: Queryable, ctx: Ctx, t: PickTask, pickedInput: number | null, confirmLocationId: string | null) {
  if (confirmLocationId && confirmLocationId !== t.from_location_id) {
    throw new DomainError("O endereço confirmado não corresponde ao endereço de origem da separação.", "LOCATION_MISMATCH");
  }
  const [res] = await tx.query<{ id: string; balance_id: string; quantity: number; status: string; line_id: string }>(
    `select id, balance_id, quantity, status, line_id from wms.production_reservations where id = $1 for update`,
    [t.production_reservation_id],
  );
  if (!res || res.status !== "active") throw new DomainError("Reserva da separação não está ativa.", "RESERVATION_MISMATCH");
  const picked = pickedInput ?? res.quantity;
  if (picked > res.quantity) throw new DomainError(`Quantidade separada (${picked}) maior que a reservada (${res.quantity}).`, "OVER_PICK");
  const r = await lockRequisition(tx, ctx, t.production_requisition_id!);
  const shortfall = round3(res.quantity - picked);
  const origin = await removeStock(tx, ctx, { balanceId: res.balance_id, quantity: picked, consumeReserved: picked });
  if (shortfall > 0) await changeReserved(tx, res.balance_id, -shortfall);
  if (picked > 0) {
    await addStock(tx, ctx, {
      warehouseId: t.warehouse_id,
      locationId: r.line_location_id,
      productId: t.product_id!,
      lotCode: t.lot_code,
      expiryDate: origin.expiry_date,
      quantity: picked,
      reserved: picked,
    });
    await insertMovement(tx, ctx, {
      warehouseId: t.warehouse_id,
      movementType: "production_pick",
      productId: t.product_id!,
      lotCode: t.lot_code,
      expiryDate: origin.expiry_date,
      quantity: picked,
      fromLocationId: t.from_location_id,
      toLocationId: r.line_location_id,
      reason: "Separação para produção",
      referenceType: "production_requisition",
      referenceId: r.id,
      referenceCode: r.code,
      taskId: t.id,
    });
  }
  await tx.query(
    `update wms.production_reservations set status = case when $2 > 0 then 'picked' else 'released' end, picked_qty = $2,
            closed_at = case when $2 > 0 then null else now() end where id = $1`,
    [res.id, picked],
  );
  await tx.query(
    `update wms.production_requisition_lines set picked_qty = picked_qty + $2, reserved_qty = reserved_qty - $3 where id = $1`,
    [res.line_id, picked, res.quantity],
  );
  if (shortfall > 0) {
    await tx.query(
      `insert into wms.divergences (company_id, source, divergence_type, product_id, quantity, description, task_id, created_by)
       values ($1, 'picking', 'short_pick', $2, $3, $4, $5, $6)`,
      [ctx.user.companyId, t.product_id, shortfall, `Separação a menor para a requisição ${r.code} na tarefa ${t.code}: reservado ${res.quantity}, separado ${picked}.`, t.id, ctx.user.id],
    );
  }
  return { confirmed: picked, destination: r.line_location_id };
}

// -----------------------------------------------------------------------------
// Entrega à linha
// -----------------------------------------------------------------------------

const deliverSchema = z.object({
  receivedBy: z.string({ error: "Informe quem recebeu na linha." }).trim().min(2, "Informe quem recebeu na linha.").max(120),
  notes: optionalText,
});

/**
 * Confirma a entrega à linha de tudo o que foi separado e ainda não entregue:
 * o material sai do estoque do WMS (movimentação "production_issue") e passa a
 * ser consumo da produção. Exige que não haja separação pendente.
 */
export async function deliverToLine(ctx: Ctx, id: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "production.operate");
  const d = parse(deliverSchema, input);
  return runOperation(ctx, "production.deliver", opts, async (tx) => {
    const r = await lockRequisition(tx, ctx, id);
    requireStatus(r, ["picking", "delivered"], "confirmar a entrega");
    const [open] = await tx.query<{ n: number }>(
      `select count(*) as n from wms.tasks where production_requisition_id = $1 and task_type = 'production_pick' and status in ('pending', 'in_progress')`,
      [id],
    );
    if (open.n > 0) throw new DomainError(`Conclua as ${open.n} tarefa(s) de separação antes de confirmar a entrega.`, "PICKING_PENDING");
    const picked = await tx.query<{ id: string; line_id: string; product_id: string; sku: string; lot_code: string; expiry_date: string | null; picked_qty: number }>(
      `select v.id, v.line_id, v.product_id, p.sku, v.lot_code, v.expiry_date::text as expiry_date, v.picked_qty
       from wms.production_reservations v join wms.production_requisition_lines x on x.id = v.line_id
       join erp.products p on p.id = v.product_id
       where x.requisition_id = $1 and v.status = 'picked' and v.picked_qty > 0 order by x.line_no for update of v`,
      [id],
    );
    if (picked.length === 0) throw new DomainError("Não há material separado aguardando entrega.", "VALIDATION");
    const code = await nextCode(tx, ctx.user.companyId, "ENT");
    const [delivery] = await tx.query<{ id: string }>(
      `insert into wms.production_deliveries (company_id, requisition_id, code, received_by, notes, delivered_by)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [ctx.user.companyId, id, code, d.receivedBy, d.notes, ctx.user.id],
    );
    const items: { sku: string; lot: string; quantity: number }[] = [];
    for (const v of picked) {
      const bal = await lockBalance(tx, ctx.user.companyId, r.line_location_id, v.product_id, v.lot_code);
      if (!bal || bal.reserved_qty < v.picked_qty) {
        throw new DomainError(`Saldo na linha menor que o separado de ${v.sku}. Verifique as movimentações.`, "STAGING_MISMATCH");
      }
      await removeStock(tx, ctx, { balanceId: bal.id, quantity: v.picked_qty, consumeReserved: v.picked_qty });
      await insertMovement(tx, ctx, {
        warehouseId: r.warehouse_id,
        movementType: "production_issue",
        productId: v.product_id,
        lotCode: v.lot_code,
        expiryDate: v.expiry_date,
        quantity: v.picked_qty,
        fromLocationId: r.line_location_id,
        reason: `Entrega à linha (${code}) — recebido por ${d.receivedBy}`,
        referenceType: "production_requisition",
        referenceId: id,
        referenceCode: r.code,
      });
      await tx.query(
        `insert into wms.production_delivery_items (delivery_id, line_id, lot_code, quantity) values ($1,$2,$3,$4)`,
        [delivery.id, v.line_id, v.lot_code, v.picked_qty],
      );
      await tx.query(`update wms.production_reservations set status = 'delivered', closed_at = now() where id = $1`, [v.id]);
      await tx.query(`update wms.production_requisition_lines set delivered_qty = delivered_qty + $2 where id = $1`, [v.line_id, v.picked_qty]);
      items.push({ sku: v.sku, lot: v.lot_code, quantity: v.picked_qty });
    }
    await tx.query(
      `update wms.production_requisitions set status = 'delivered', delivered_at = now(), updated_at = now(), version = version + 1 where id = $1`,
      [id],
    );
    const orderNumber = await productionOrderNumber(tx, r.production_order_id);
    await enqueueIntegrationEvent(tx, ctx, "production.materials_delivered", "production_requisition", id, {
      code: r.code,
      productionOrder: orderNumber,
      delivery: code,
      receivedBy: d.receivedBy,
      items,
    });
    await audit(tx, ctx, "production.delivered", "production_requisition", id, r.code, { delivery: code, items });
    return { id, delivery: code, items };
  });
}

// -----------------------------------------------------------------------------
// Devolução de sobras
// -----------------------------------------------------------------------------

const leftoverSchema = z.object({
  lineId: uuid("Componente"),
  lotCode: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ?? "").toUpperCase()),
  quantity: qty(),
  locationId: uuid("Endereço de destino"),
  reason: optionalText,
});

/**
 * Devolve ao estoque a sobra de um componente entregue à linha. A quantidade
 * não pode ultrapassar o entregue − já devolvido do componente/lote, e o destino
 * passa pela mesma validação de capacidade/compatibilidade da armazenagem.
 */
export async function returnLeftovers(ctx: Ctx, id: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "production.operate");
  const d = parse(leftoverSchema, input);
  return runOperation(ctx, "production.return_leftovers", opts, async (tx) => {
    const r = await lockRequisition(tx, ctx, id);
    requireStatus(r, ["delivered"], "devolver sobras");
    const [line] = await tx.query<{ id: string; product_id: string; sku: string; delivered_qty: number; returned_qty: number }>(
      `select x.id, x.product_id, p.sku, x.delivered_qty, x.returned_qty
       from wms.production_requisition_lines x join erp.products p on p.id = x.product_id
       where x.id = $1 and x.requisition_id = $2 for update of x`,
      [d.lineId, id],
    );
    if (!line) throw new NotFoundError("Componente da requisição");
    const [lot] = await tx.query<{ delivered: number; expiry_date: string | null }>(
      `select coalesce(sum(i.quantity), 0) as delivered,
              (select v.expiry_date::text from wms.production_reservations v where v.line_id = $1 and v.lot_code = $2 limit 1) as expiry_date
       from wms.production_delivery_items i where i.line_id = $1 and i.lot_code = $2`,
      [line.id, d.lotCode],
    );
    if (!lot || lot.delivered <= 0) throw new DomainError(`O lote ${d.lotCode || "(sem lote)"} não foi entregue para ${line.sku}.`, "VALIDATION");
    const [ret] = await tx.query<{ returned: number }>(
      `select coalesce(sum(quantity), 0) as returned from wms.stock_movements
       where reference_type = 'production_requisition' and reference_id = $1 and movement_type = 'production_return'
         and product_id = $2 and lot_code = $3`,
      [id, line.product_id, d.lotCode],
    );
    const maxLot = round3(lot.delivered - ret.returned);
    const maxLine = round3(line.delivered_qty - line.returned_qty);
    const max = Math.min(maxLot, maxLine);
    if (d.quantity > max) {
      throw new DomainError(`Sobra maior que o entregue de ${line.sku}${d.lotCode ? ` lote ${d.lotCode}` : ""}: máximo ${max}, informado ${d.quantity}.`, "OVER_RETURN");
    }
    const loc = await validateDestination(tx, ctx, { locationId: d.locationId, warehouseId: r.warehouse_id, productId: line.product_id, quantity: d.quantity });
    await addStock(tx, ctx, {
      warehouseId: r.warehouse_id,
      locationId: d.locationId,
      productId: line.product_id,
      lotCode: d.lotCode,
      expiryDate: lot.expiry_date,
      quantity: d.quantity,
    });
    await insertMovement(tx, ctx, {
      warehouseId: r.warehouse_id,
      movementType: "production_return",
      productId: line.product_id,
      lotCode: d.lotCode,
      expiryDate: lot.expiry_date,
      quantity: d.quantity,
      fromLocationId: r.line_location_id,
      toLocationId: d.locationId,
      reason: d.reason ?? "Sobra devolvida pela produção",
      referenceType: "production_requisition",
      referenceId: id,
      referenceCode: r.code,
    });
    await tx.query(`update wms.production_requisition_lines set returned_qty = returned_qty + $2 where id = $1`, [line.id, d.quantity]);
    const orderNumber = await productionOrderNumber(tx, r.production_order_id);
    await enqueueIntegrationEvent(tx, ctx, "production.leftovers_returned", "production_requisition", id, {
      code: r.code,
      productionOrder: orderNumber,
      sku: line.sku,
      lot: d.lotCode,
      quantity: d.quantity,
      location: loc.code,
    });
    await audit(tx, ctx, "production.leftovers_returned", "production_requisition", id, r.code, { sku: line.sku, ...d, location: loc.code });
    return { id, location: loc.code };
  });
}

// -----------------------------------------------------------------------------
// Produto acabado
// -----------------------------------------------------------------------------

const outputSchema = z.object({
  quantity: qty(),
  expiryDate: optionalDate,
});

/**
 * Registra a entrada do produto acabado com o lote gerado pela ordem. Gera
 * tarefas de armazenagem normais (sugestão de endereço); o saldo só nasce na
 * confirmação física da armazenagem, como em qualquer recebimento.
 */
export async function receiveOutput(ctx: Ctx, id: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "production.operate");
  const d = parse(outputSchema, input);
  return runOperation(ctx, "production.output", opts, async (tx) => {
    const r = await lockRequisition(tx, ctx, id);
    requireStatus(r, ["delivered"], "receber produto acabado");
    const pending = round3(r.planned_output_qty - r.output_qty);
    if (d.quantity > pending) {
      throw new DomainError(`Quantidade acima do saldo da ordem: planejado ${r.planned_output_qty}, já recebido ${r.output_qty}.`, "OVER_OUTPUT");
    }
    const rules = await getProductRules(tx, ctx.user.companyId, r.output_product_id);
    if (rules.expiry_controlled && !d.expiryDate) throw new DomainError(`O produto ${rules.sku} exige validade.`, "VALIDATION", "expiryDate");
    const chunk = rules.max_units_per_location ?? d.quantity;
    let remaining = d.quantity;
    const tasks: string[] = [];
    while (remaining > 0) {
      const q = round3(Math.min(chunk, remaining));
      remaining = round3(remaining - q);
      const suggestion = await suggestLocations(tx, ctx, { warehouseId: r.warehouse_id, productId: r.output_product_id, lotCode: r.output_lot_code, quantity: q });
      const code = await nextCode(tx, ctx.user.companyId, "TAR");
      const [t] = await tx.query<{ id: string }>(
        `insert into wms.tasks (company_id, warehouse_id, code, task_type, priority, product_id, lot_code, expiry_date, quantity,
                                from_location_id, suggested_location_id, production_requisition_id, notes, created_by)
         values ($1,$2,$3,'putaway',2,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
        [ctx.user.companyId, r.warehouse_id, code, r.output_product_id, r.output_lot_code, d.expiryDate, q, r.line_location_id,
          suggestion.best?.id ?? null, id, suggestion.best ? null : `Sem sugestão automática: ${suggestion.reason}`, ctx.user.id],
      );
      await recordTaskEvent(tx, t.id, ctx.user.id, "created", null, "pending", { requisition: r.code, suggested: suggestion.best?.code ?? null });
      tasks.push(code);
    }
    await tx.query(`update wms.production_requisitions set output_qty = output_qty + $2, updated_at = now(), version = version + 1 where id = $1`, [
      id,
      d.quantity,
    ]);
    const orderNumber = await productionOrderNumber(tx, r.production_order_id);
    await enqueueIntegrationEvent(tx, ctx, "production.output_received", "production_requisition", id, {
      code: r.code,
      productionOrder: orderNumber,
      sku: rules.sku,
      lot: r.output_lot_code,
      expiryDate: d.expiryDate,
      quantity: d.quantity,
      totalReceived: round3(r.output_qty + d.quantity),
    });
    await audit(tx, ctx, "production.output_received", "production_requisition", id, r.code, { ...d, lot: r.output_lot_code, tasks });
    return { id, tasks, lot: r.output_lot_code };
  });
}

// -----------------------------------------------------------------------------
// Encerramento e cancelamento
// -----------------------------------------------------------------------------

export async function completeRequisition(ctx: Ctx, id: string, opts?: OpOptions) {
  assertCan(ctx, "production.manage");
  return runOperation(ctx, "production.complete", opts, async (tx) => {
    const r = await lockRequisition(tx, ctx, id);
    requireStatus(r, ["delivered"], "encerrar");
    const [open] = await tx.query<{ n: number }>(
      `select count(*) as n from wms.tasks where production_requisition_id = $1 and status in ('pending', 'in_progress')`,
      [id],
    );
    if (open.n > 0) throw new DomainError(`Há ${open.n} tarefa(s) abertas desta requisição (separação ou armazenagem do produto acabado).`, "TASKS_PENDING");
    // Reservas ainda ativas (componentes não separados) são liberadas.
    const active = await tx.query<{ id: string; balance_id: string; quantity: number; line_id: string }>(
      `select v.id, v.balance_id, v.quantity, v.line_id from wms.production_reservations v
       join wms.production_requisition_lines x on x.id = v.line_id where x.requisition_id = $1 and v.status = 'active' for update of v`,
      [id],
    );
    for (const v of active) {
      await changeReserved(tx, v.balance_id, -v.quantity);
      await tx.query(`update wms.production_reservations set status = 'released', closed_at = now() where id = $1`, [v.id]);
      await tx.query(`update wms.production_requisition_lines set reserved_qty = reserved_qty - $2 where id = $1`, [v.line_id, v.quantity]);
    }
    await tx.query(
      `update wms.production_requisitions set status = 'completed', completed_at = now(), updated_at = now(), version = version + 1 where id = $1`,
      [id],
    );
    if (round3(r.output_qty) >= round3(r.planned_output_qty)) await erp.setProductionOrderStatus(tx, r.production_order_id, "completed");
    await audit(tx, ctx, "production.completed", "production_requisition", id, r.code, { outputQty: r.output_qty, released: active.length });
    return { id };
  });
}

const cancelSchema = z.object({ reason: z.string().trim().min(5, "Informe o motivo do cancelamento.") });

/** Cancela antes da separação, liberando as reservas. */
export async function cancelRequisition(ctx: Ctx, id: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "production.manage");
  const d = parse(cancelSchema, input);
  return runOperation(ctx, "production.cancel", opts, async (tx) => {
    const r = await lockRequisition(tx, ctx, id);
    requireStatus(r, ["open", "reserved"], "cancelar");
    const active = await tx.query<{ id: string; balance_id: string; quantity: number; line_id: string }>(
      `select v.id, v.balance_id, v.quantity, v.line_id from wms.production_reservations v
       join wms.production_requisition_lines x on x.id = v.line_id where x.requisition_id = $1 and v.status = 'active' for update of v`,
      [id],
    );
    for (const v of active) {
      await changeReserved(tx, v.balance_id, -v.quantity);
      await tx.query(`update wms.production_reservations set status = 'released', closed_at = now() where id = $1`, [v.id]);
      await tx.query(`update wms.production_requisition_lines set reserved_qty = reserved_qty - $2 where id = $1`, [v.line_id, v.quantity]);
    }
    await tx.query(
      `update wms.production_requisitions set status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now(),
              version = version + 1 where id = $1`,
      [id, d.reason],
    );
    await erp.setProductionOrderStatus(tx, r.production_order_id, "open");
    await audit(tx, ctx, "production.cancelled", "production_requisition", id, r.code, { ...d, released: active.length });
    return { id };
  });
}
