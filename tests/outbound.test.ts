import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, balanceOf, key, type TestEnv } from "./helpers";
import * as outbound from "@/server/services/outbound";
import * as tasks from "@/server/services/tasks";
import { adjustStock } from "@/server/services/stock";

describe("Saída: disponibilidade, separação e expedição", () => {
  let env: TestEnv;
  let warehouseId: string;
  let productA: string;

  beforeAll(async () => {
    env = await createTestEnv();
    warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    productA = await env.product("CIA-001");
    await adjustStock(env.as("admin"), {
      locationId: await env.location("DEP-01/RUA-01/MOD-01/NIV-01/POS-00"),
      productId: productA,
      direction: "in",
      quantity: 50,
      reason: "Saldo inicial para teste de saída",
    });
  });

  it("recusa reservar acima do disponível (PV-1002: 500 un) sem deixar reserva parcial", async () => {
    const sup = env.as("supervisor");
    const so = await env.id(`select id from erp.sales_orders where number = 'PV-1002'`);
    const order = await outbound.importSalesOrder(sup, { salesOrderId: so, warehouseId });
    await expect(outbound.reserveOrder(sup, order.id)).rejects.toThrow(/solicitado 500, disponível 50/);
    const b = await balanceOf(env, "CIA-001");
    expect(b.reserved).toBe(0);
    const o = await outbound.getOrder(sup, order.id);
    expect(o!.status).toBe("open");
    expect(o!.reservations).toHaveLength(0);
    await outbound.cancelOrder(sup, order.id, { reason: "Sem estoque suficiente" });
  });

  it("não importa duas vezes o mesmo pedido de venda", async () => {
    const sup = env.as("supervisor");
    const so = await env.id(`select id from erp.sales_orders where number = 'PV-1001'`);
    await outbound.importSalesOrder(sup, { salesOrderId: so, warehouseId });
    await expect(outbound.importSalesOrder(sup, { salesOrderId: so, warehouseId })).rejects.toThrow(/já foi importado/);
  });

  it("separação a menor gera divergência, libera a reserva restante e expede só o conferido", async () => {
    const sup = env.as("supervisor");
    const order = await outbound.createManualOrder(sup, {
      warehouseId,
      customerName: "Cliente teste",
      lines: [{ productId: productA, quantity: 30 }],
    });
    await outbound.reserveOrder(sup, order.id);
    expect((await balanceOf(env, "CIA-001")).reserved).toBe(30);
    await outbound.releaseForPicking(sup, order.id);
    const { rows } = await tasks.listTasks(sup, { type: "picking" });
    const pick = rows.find((t) => t.order_id === order.id)!;
    const op = env.as("operator");
    await expect(tasks.completeTask(op, pick.id, { quantity: 31 })).rejects.toThrow(/maior que a reservada/);
    await expect(
      tasks.completeTask(op, pick.id, { quantity: 30, locationId: await env.location("DEP-01/RUA-02/MOD-01/NIV-01/POS-00") }),
    ).rejects.toThrow(/não corresponde/);
    await tasks.completeTask(op, pick.id, { quantity: 25, notes: "Caixa faltante" });
    const b = await balanceOf(env, "CIA-001");
    expect(b.quantity).toBe(50);
    expect(b.reserved).toBe(25); // 25 na doca, reservados ao pedido; 5 voltaram a ficar disponíveis

    const o = await outbound.getOrder(op, order.id);
    expect(o!.lines[0].picked_qty).toBe(25);
    // Conferência divergente não avança o pedido.
    const bad = await outbound.checkOrder(op, order.id, { lines: [{ lineId: o!.lines[0].id, checkedQty: 24 }] });
    expect(bad.ok).toBe(false);
    expect((await outbound.getOrder(op, order.id))!.status).toBe("picked");
    await expect(outbound.shipOrder(op, order.id, {})).rejects.toThrow(/status "picked"/);
    const good = await outbound.checkOrder(op, order.id, { lines: [{ lineId: o!.lines[0].id, checkedQty: 25 }] });
    expect(good.ok).toBe(true);
    const k = key();
    const shipped = await outbound.shipOrder(op, order.id, {}, { idempotencyKey: k });
    const replay = await outbound.shipOrder(op, order.id, {}, { idempotencyKey: k });
    expect(replay).toEqual(shipped);
    expect(shipped.total).toBe(25);
    const final = await balanceOf(env, "CIA-001");
    expect(final.quantity).toBe(25);
    expect(final.reserved).toBe(0);
    await expect(outbound.shipOrder(op, order.id, {}, { idempotencyKey: key() })).rejects.toThrow(/status "shipped"/);
    const divs = await env.db.query<{ divergence_type: string }>(`select divergence_type from wms.divergences where order_id = $1`, [order.id]);
    expect(divs.map((d) => d.divergence_type).sort()).toEqual(["short_pick", "shortage"]);
  });

  it("a restrição do banco impede expedir acima do conferido", async () => {
    const line = await env.id(`select id from wms.outbound_order_lines where shipped_qty > 0 limit 1`);
    await expect(env.db.query(`update wms.outbound_order_lines set shipped_qty = shipped_qty + 1 where id = $1`, [line])).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("auditor não cria nem reserva pedidos", async () => {
    await expect(
      outbound.createManualOrder(env.as("auditor"), { warehouseId, customerName: "X cliente", lines: [{ productId: productA, quantity: 1 }] }),
    ).rejects.toThrow(/permissão/);
  });
});
