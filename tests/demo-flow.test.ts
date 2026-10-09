import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, balanceOf, key, type TestEnv } from "./helpers";
import * as erp from "@/server/integrations/erp/gateway";
import * as receiving from "@/server/services/receiving";
import * as tasks from "@/server/services/tasks";
import * as outbound from "@/server/services/outbound";
import { listMovements, listStock } from "@/server/services/stock";

/**
 * Cenário demonstrativo obrigatório (MetalSupply / PC-4587 / Componente Industrial A):
 * recebe 100, armazena, reserva e expede 20 → físico final 80, reservado 0, expedido 20.
 */
describe("Fluxo demonstrativo ponta a ponta", () => {
  let env: TestEnv;
  let receiptId: string;
  let orderId: string;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  it("1-2. consulta o pedido de compra PC-4587 e inicia o recebimento", async () => {
    const sup = env.as("supervisor");
    const pos = await erp.listPurchaseOrders(env.db, sup.user.companyId);
    const pc = pos.find((p) => p.number === "PC-4587")!;
    expect(pc.total_qty).toBe(100);
    expect(pc.receipt_code).toBeNull();
    const warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    const r = await receiving.createReceiptFromPurchaseOrder(sup, { purchaseOrderId: pc.id, warehouseId }, { idempotencyKey: key() });
    receiptId = r.id;
    const op = env.as("operator");
    await receiving.startCheck(op, receiptId);
    const rec = await receiving.getReceipt(op, receiptId);
    expect(rec!.status).toBe("checking");
    expect(rec!.items).toHaveLength(1);
    expect(rec!.items[0].expected_qty).toBe(100);
  });

  it("3-4. confere 100 unidades e conclui a conferência sem divergências", async () => {
    const op = env.as("operator");
    const rec = await receiving.getReceipt(op, receiptId);
    await receiving.saveCounts(op, receiptId, { items: [{ itemId: rec!.items[0].id, countedQty: 100 }] });
    const result = await receiving.finishCheck(op, receiptId, {});
    expect(result.divergences).toBe(0);
    // Chegada física/conferência NÃO gera estoque.
    expect((await balanceOf(env, "CIA-001")).quantity).toBe(0);
  });

  it("5-7. libera, gera tarefa de armazenagem com sugestão elegível e confirma", async () => {
    const sup = env.as("supervisor");
    const released = await receiving.releaseReceipt(sup, receiptId);
    expect(released.tasks).toHaveLength(1);
    const { rows } = await tasks.listTasks(sup, { type: "putaway", status: "pending" });
    const task = rows.find((t) => t.receipt_id === receiptId)!;
    expect(task.quantity).toBe(100);
    expect(task.suggested_code).toMatch(/^DEP-01\/RUA-0[12]\//);
    expect((await balanceOf(env, "CIA-001")).quantity).toBe(0);

    const op = env.as("operator");
    await tasks.startTask(op, task.id);
    await tasks.completeTask(op, task.id, {}, { idempotencyKey: key() });
    const rec = await receiving.getReceipt(op, receiptId);
    expect(rec!.status).toBe("completed");
    const po = await env.one<{ status: string }>(`select status from erp.purchase_orders where number = 'PC-4587'`);
    expect(po.status).toBe("received");
  });

  it("8. verifica o estoque no endereço", async () => {
    const op = env.as("operator");
    const { rows } = await listStock(op, { q: "CIA-001" });
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(100);
    expect(rows[0].available_qty).toBe(100);
  });

  it("9-10. importa o pedido PV-1001 (20 un) e reserva sem baixa física", async () => {
    const sup = env.as("supervisor");
    const so = (await erp.listSalesOrders(env.db, sup.user.companyId)).find((s) => s.number === "PV-1001")!;
    const warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    const o = await outbound.importSalesOrder(sup, { salesOrderId: so.id, warehouseId });
    orderId = o.id;
    await outbound.reserveOrder(sup, orderId);
    const b = await balanceOf(env, "CIA-001");
    expect(b.quantity).toBe(100);
    expect(b.reserved).toBe(20);
  });

  it("11. executa a separação para a doca", async () => {
    const sup = env.as("supervisor");
    const rel = await outbound.releaseForPicking(sup, orderId);
    expect(rel.tasks).toHaveLength(1);
    const { rows } = await tasks.listTasks(sup, { type: "picking" });
    const pick = rows.find((t) => t.order_id === orderId)!;
    expect(pick.quantity).toBe(20);
    expect(pick.to_code).toBe("DEP-01/RUA-EX/MOD-01/NIV-00/POS-00");
    const op = env.as("operator");
    await tasks.completeTask(op, pick.id, { quantity: 20, locationId: pick.from_location_id });
    const order = await outbound.getOrder(op, orderId);
    expect(order!.status).toBe("picked");
    // Ainda é estoque físico do armazém (na doca), reservado ao pedido.
    const b = await balanceOf(env, "CIA-001");
    expect(b.quantity).toBe(100);
    expect(b.reserved).toBe(20);
  });

  it("12-13. confere o pedido e confirma a expedição", async () => {
    const op = env.as("operator");
    const order = await outbound.getOrder(op, orderId);
    const check = await outbound.checkOrder(op, orderId, { lines: order!.lines.map((l) => ({ lineId: l.id, checkedQty: 20 })) });
    expect(check.ok).toBe(true);
    const ship = await outbound.shipOrder(op, orderId, { carrier: "Transportadora Demo", vehiclePlate: "abc1d23" }, { idempotencyKey: key() });
    expect(ship.total).toBe(20);
  });

  it("14. saldo final 80, reservado 0, expedido 20 e histórico completo", async () => {
    const b = await balanceOf(env, "CIA-001");
    expect(b.quantity).toBe(80);
    expect(b.reserved).toBe(0);
    const order = await outbound.getOrder(env.as("auditor"), orderId);
    expect(order!.status).toBe("shipped");
    expect(order!.lines[0].shipped_qty).toBe(20);
    expect(order!.shipment?.vehicle_plate).toBe("ABC1D23");
    const so = await env.one<{ status: string }>(`select status from erp.sales_orders where number = 'PV-1001'`);
    expect(so.status).toBe("shipped");

    const productId = await env.product("CIA-001");
    const { rows } = await listMovements(env.as("auditor"), { productId });
    const types = rows.map((m) => `${m.movement_type}:${m.quantity}`).sort();
    expect(types).toEqual(["pick:20", "putaway:100", "shipment:20"]);
    const events = await env.db.query<{ event_type: string }>(`select event_type from wms.integration_events order by created_at`);
    expect(events.map((e) => e.event_type)).toEqual(["receipt.completed", "outbound.shipped"]);
  });
});
