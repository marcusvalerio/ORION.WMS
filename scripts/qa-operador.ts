/**
 * Harness de QA do teste real ATLAS ↔ ORION (docs/QA-INTEGRACAO.md): executa
 * ações de operador no ORION pelos MESMOS serviços que as telas chamam, com o
 * usuário (provisionado pelo SSO do ATLAS) indicado em `as`. Não fala com o
 * ATLAS: os eventos ficam na outbox e saem pelo processador do servidor
 * (POST /api/integracao/processar), por HTTP real.
 *
 * Uso: DATABASE_URL=... npx tsx --conditions=react-server scripts/qa-operador.ts <ação> '<json>'
 * Imprime uma linha JSON com o resultado.
 */
import { createPostgresDb } from "../src/server/db/drivers";
import { loadSessionUser } from "../src/server/auth/users";
import type { Ctx } from "../src/server/context";
import * as warehouse from "../src/server/services/warehouse";
import * as tasks from "../src/server/services/tasks";
import * as outbound from "../src/server/services/outbound";
import * as receiving from "../src/server/services/receiving";
import * as production from "../src/server/services/production";
import * as stock from "../src/server/services/stock";
import { randomUUID } from "node:crypto";

type Args = Record<string, unknown> & { as: string };

async function main() {
  const [action, raw] = process.argv.slice(2);
  const args = JSON.parse(raw ?? "{}") as Args;
  const db = await createPostgresDb(process.env.DATABASE_URL!);
  try {
    const [u] = await db.query<{ id: string }>(`select id from wms.users where lower(email) = lower($1) and active`, [args.as]);
    if (!u) throw new Error(`usuário ORION ${args.as} não existe/ativo`);
    const user = await loadSessionUser(db, u.id);
    const ctx = { db, user } as unknown as Ctx;
    const one = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p))[0];
    const key = () => ({ idempotencyKey: randomUUID() });
    const locationByCode = async (code: string) => (await one<{ id: string }>(`select id from wms.locations where company_id = $1 and code = $2`, [user!.companyId, code]))?.id;
    const doTasks = async (where: string, p: unknown[]) => {
      const list = await db.query<{ id: string; quantity: number; from_location_id: string | null; suggested_location_id: string | null; to_location_id: string | null }>(
        `select id, quantity::float8 as quantity, from_location_id, suggested_location_id, to_location_id from wms.tasks
         where company_id = $1 and status in ('pending','in_progress') and ${where} order by created_at`,
        [user!.companyId, ...p],
      );
      for (const t of list) {
        const picking = where.includes("'picking'") || where.includes("'production_pick'");
        const input = picking
          ? { quantity: t.quantity, locationId: t.from_location_id ?? undefined }
          : { locationId: t.suggested_location_id ?? t.to_location_id ?? (args.toLocation ? await locationByCode(String(args.toLocation)) : undefined) };
        await tasks.completeTask(ctx, t.id, input, key());
      }
      return list.length;
    };
    let out: unknown;
    switch (action) {
      case "layout": {
        const wh = await one<{ id: string }>(`select id from wms.warehouses where company_id = $1 and code = $2`, [user!.companyId, args.warehouse]);
        const made: string[] = [];
        for (const [code, type, aisle, ltype] of [
          ["REC", "receiving", "RC", "floor"], ["ARM", "storage", "A1", "rack"], ["EXP", "shipping", "EX", "dock"], ["PRD", "production", "LP", "floor"],
        ] as const) {
          const z = await warehouse.createZone(ctx, { warehouseId: wh.id, code, name: `Zona ${code}`, zoneType: type }, key());
          const l = await warehouse.createLocation(ctx, { zoneId: z.id, aisle, bay: "01", level: "00", position: "00", locationType: ltype, capacityUnits: 100000 }, key());
          made.push(String((l as { code?: string }).code ?? l.id));
        }
        out = { zones: 4, locations: made };
        break;
      }
      case "tarefas": // conclui tarefas de transferência/armazenagem pendentes
        out = { done: await doTasks(`task_type in ('transfer','putaway')`, []) };
        break;
      case "separar": { // reserva, libera, separa e confere o pedido de saída do pedido ATLAS
        const o = await one<{ id: string }>(`select o.id from wms.outbound_orders o join erp.sales_orders so on so.id = o.sales_order_id
          where so.external_id = $1 and o.status <> 'cancelled' order by o.created_at desc`, [args.atlas_sales_order_id]);
        await outbound.reserveOrder(ctx, o.id);
        await outbound.releaseForPicking(ctx, o.id);
        const n = await doTasks(`task_type = 'picking' and order_id = $2`, [o.id]);
        const order = await outbound.getOrder(ctx, o.id);
        const check = await outbound.checkOrder(ctx, o.id, { lines: order!.lines.filter((l) => !l.cancelled_at).map((l) => ({ lineId: l.id, checkedQty: l.picked_qty })) });
        out = { outbound: o.id, picks: n, check };
        break;
      }
      case "expedir": {
        const o = await one<{ id: string }>(`select o.id from wms.outbound_orders o join erp.sales_orders so on so.id = o.sales_order_id
          where so.external_id = $1 and o.status <> 'cancelled' order by o.created_at desc`, [args.atlas_sales_order_id]);
        try {
          out = await outbound.shipOrder(ctx, o.id, { carrier: "Transportes QA", vehiclePlate: "QAA1B23" }, key());
        } catch (e) {
          out = { blocked: (e as Error).message };
        }
        break;
      }
      case "receber": { // recebimento previsto do pedido de compra ATLAS: confere, libera e armazena
        const po = await one<{ id: string }>(`select id from erp.purchase_orders where company_id = $1 and external_id = $2`, [user!.companyId, args.atlas_purchase_order_id]);
        const wh = await one<{ id: string }>(`select id from wms.warehouses where company_id = $1 and code = $2`, [user!.companyId, args.warehouse]);
        const r = await receiving.createReceiptFromPurchaseOrder(ctx, { purchaseOrderId: po.id, warehouseId: wh.id }, key());
        await receiving.startCheck(ctx, r.id);
        const rec = await receiving.getReceipt(ctx, r.id);
        await receiving.saveCounts(ctx, r.id, { items: rec!.items.map((i) => ({ itemId: i.id, countedQty: i.expected_qty, lotCode: args.lot ?? undefined, expiryDate: args.expiry ?? undefined })) });
        await receiving.finishCheck(ctx, r.id, {});
        await receiving.releaseReceipt(ctx, r.id);
        const n = await doTasks(`task_type = 'putaway' and receipt_id = $2`, [r.id]);
        out = { receipt: r.id, putaway: n, status: (await receiving.getReceipt(ctx, r.id))!.status };
        break;
      }
      case "abastecer": { // requisição de abastecimento da OP ATLAS: reserva, separa e entrega à linha
        const req = await one<{ id: string }>(`select r.id from wms.production_requisitions r join erp.production_orders p on p.id = r.production_order_id
          where p.external_id = $1 and r.status <> 'cancelled'`, [args.atlas_production_order_id]);
        await production.reserveRequisition(ctx, req.id, key());
        await production.releaseRequisition(ctx, req.id, key());
        const n = await doTasks(`task_type = 'production_pick' and production_requisition_id = $2`, [req.id]);
        out = { requisition: req.id, picks: n, delivered: await production.deliverToLine(ctx, req.id, { receivedBy: "Líder da linha QA" }, key()) };
        break;
      }
      case "ajustar": {
        const b = await one<{ location_id: string; product_id: string; lot_code: string }>(
          `select b.location_id, b.product_id, b.lot_code from wms.stock_balances b join erp.products p on p.id = b.product_id join wms.locations l on l.id = b.location_id
           join wms.zones z on z.id = l.zone_id where b.company_id = $1 and p.sku = $2 and z.zone_type = 'storage' and b.quantity > 0 order by b.quantity desc`,
          [user!.companyId, args.sku],
        );
        out = await stock.adjustStock(ctx, { locationId: b.location_id, productId: b.product_id, lotCode: b.lot_code, direction: args.direction, quantity: args.quantity, reason: String(args.reason) }, key());
        break;
      }
      default:
        throw new Error(`ação desconhecida: ${action}`);
    }
    console.log(JSON.stringify({ ok: true, result: out }));
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exitCode = 0;
});
