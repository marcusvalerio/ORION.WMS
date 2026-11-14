import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, balanceOf, type TestEnv } from "./helpers";
import * as outbound from "@/server/services/outbound";
import * as tasks from "@/server/services/tasks";
import * as repl from "@/server/services/replenishment";
import { adjustStock } from "@/server/services/stock";

const PK1 = "DEP-01/RUA-PK/MOD-01/NIV-01/POS-00";
const PULMAO_LUB = "DEP-01/RUA-02/MOD-01/NIV-01/POS-00";

describe("Reposição de picking", () => {
  let env: TestEnv;
  let warehouseId: string;
  let pk1: string;

  beforeAll(async () => {
    env = await createTestEnv();
    warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    pk1 = await env.location(PK1);
  });

  const openRepl = () =>
    env.db.query<{ id: string; quantity: number; emergency: boolean; priority: number; from_location_id: string; status: string }>(
      `select id, quantity, emergency, priority, from_location_id, status from wms.tasks
       where task_type = 'replenishment' and to_location_id = $1 and status in ('pending', 'in_progress')`,
      [pk1],
    );

  it("a carga do pulmão abaixo do mínimo gerou uma única tarefa (FEFO, até o máximo)", async () => {
    // Seed: LUB-002 mín. 10 / máx. 20 em PK-01 (vazio) e 30 un no pulmão RUA-02.
    const open = await openRepl();
    expect(open).toHaveLength(1);
    expect(open[0].quantity).toBe(20);
    expect(open[0].from_location_id).toBe(await env.location(PULMAO_LUB));
  });

  it("não duplica tarefa aberta para o mesmo endereço (verificações concorrentes e índice do banco)", async () => {
    const sup = env.as("supervisor");
    const results = await Promise.all([repl.runReplenishmentCheck(sup, { warehouseId }), repl.runReplenishmentCheck(sup, {})]);
    expect(results.flatMap((r) => r.tasks)).toHaveLength(0);
    expect(await openRepl()).toHaveLength(1);
    const [t] = await openRepl();
    await expect(
      env.db.query(
        `insert into wms.tasks (company_id, warehouse_id, code, task_type, product_id, quantity, from_location_id, to_location_id, created_by)
         select company_id, warehouse_id, 'TAR-DUP', 'replenishment', product_id, 1, from_location_id, to_location_id, created_by from wms.tasks where id = $1`,
        [t.id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("valida configuração: só supervisor, endereço de picking e máximo > mínimo", async () => {
    const productId = await env.product("CIA-001");
    const loc2 = await env.location("DEP-01/RUA-PK/MOD-02/NIV-01/POS-00");
    await expect(repl.saveReplenishmentSetting(env.as("operator"), { locationId: loc2, productId, minQty: 5, maxQty: 20 })).rejects.toThrow(/permissão/);
    await expect(
      repl.saveReplenishmentSetting(env.as("supervisor"), { locationId: await env.location(PULMAO_LUB), productId, minQty: 5, maxQty: 20 }),
    ).rejects.toThrow(/zona de picking/);
    await expect(repl.saveReplenishmentSetting(env.as("supervisor"), { locationId: loc2, productId, minQty: 20, maxQty: 10 })).rejects.toThrow(/maior que o mínimo/);
    await expect(repl.saveReplenishmentSetting(env.as("supervisor"), { locationId: pk1, productId, minQty: 1, maxQty: 10 })).rejects.toThrow(/já abastece/);
  });

  it("executa a reposição com movimento próprio e respeita a quantidade planejada", async () => {
    const [t] = await openRepl();
    const op = env.as("operator");
    await expect(tasks.completeTask(op, t.id, { quantity: 21 })).rejects.toThrow(/maior que a planejada/);
    await tasks.completeTask(op, t.id, {});
    const pk = await env.one<{ q: number }>(`select coalesce(sum(quantity), 0) as q from wms.stock_balances where location_id = $1`, [pk1]);
    expect(pk.q).toBe(20);
    expect((await balanceOf(env, "LUB-002")).quantity).toBe(30);
    const m = await env.one<{ movement_type: string; quantity: number }>(`select movement_type, quantity from wms.stock_movements where task_id = $1`, [t.id]);
    expect(m).toEqual({ movement_type: "replenishment", quantity: 20 });
    expect(await openRepl()).toHaveLength(0);
  });

  it("separação a menor no picking gera reposição de emergência (alta prioridade) a partir do pulmão", async () => {
    const sup = env.as("supervisor");
    const o = await outbound.createManualOrder(sup, { warehouseId, customerName: "Cliente reposição", lines: [{ productId: await env.product("LUB-002"), quantity: 15 }] });
    await outbound.reserveOrder(sup, o.id);
    // FEFO empata (mesmo lote) → o picking tem preferência sobre o pulmão.
    const r = await env.one<{ location_id: string }>(
      `select r.location_id from wms.stock_reservations r join wms.outbound_order_lines l on l.id = r.order_line_id where l.order_id = $1`,
      [o.id],
    );
    expect(r.location_id).toBe(pk1);
    await outbound.releaseForPicking(sup, o.id);
    const pick = (await tasks.listTasks(sup, { type: "picking" })).rows.find((t) => t.order_id === o.id)!;
    await tasks.completeTask(env.as("operator"), pick.id, { quantity: 12, notes: "Falta no flow rack" });
    const [em] = await openRepl();
    expect(em.emergency).toBe(true);
    expect(em.priority).toBe(1);
    expect(em.quantity).toBe(10); // tudo o que havia disponível no pulmão
  });

  it("ajuste de estoque também dispara a verificação", async () => {
    const sup = env.as("supervisor");
    const productId = await env.product("CIA-001");
    const loc2 = await env.location("DEP-01/RUA-PK/MOD-02/NIV-01/POS-00");
    await repl.saveReplenishmentSetting(sup, { locationId: loc2, productId, minQty: 5, maxQty: 30 });
    await adjustStock(env.as("admin"), {
      locationId: await env.location("DEP-01/RUA-01/MOD-01/NIV-02/POS-00"),
      productId,
      direction: "in",
      quantity: 50,
      reason: "Entrada no pulmão para teste",
    });
    const t = await env.one<{ quantity: number }>(
      `select quantity from wms.tasks where task_type = 'replenishment' and to_location_id = $1 and status = 'pending'`,
      [loc2],
    );
    expect(t.quantity).toBe(30);
  });
});

describe("Cancelamento após o início da separação", () => {
  let env: TestEnv;
  let warehouseId: string;
  let productA: string;
  let origin: string;

  beforeAll(async () => {
    env = await createTestEnv();
    warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    productA = await env.product("CIA-001");
    origin = await env.location("DEP-01/RUA-01/MOD-01/NIV-01/POS-00");
    await adjustStock(env.as("admin"), { locationId: origin, productId: productA, direction: "in", quantity: 40, reason: "Saldo para teste de cancelamento" });
  });

  it("pedido separado cancelado gera devolução ao endereço com movimento próprio e evento ao ERP", async () => {
    const sup = env.as("supervisor");
    const so = await env.id(`select id from erp.sales_orders where number = 'PV-1001'`);
    const o = await outbound.importSalesOrder(sup, { salesOrderId: so, warehouseId });
    await outbound.reserveOrder(sup, o.id);
    await outbound.releaseForPicking(sup, o.id);
    const pick = (await tasks.listTasks(sup, { type: "picking" })).rows.find((t) => t.order_id === o.id)!;
    await tasks.completeTask(env.as("operator"), pick.id, {});
    expect((await outbound.getOrder(sup, o.id))!.status).toBe("picked");

    await expect(outbound.cancelOrder(env.as("operator"), o.id, { reason: "Cliente desistiu" })).rejects.toThrow(/permissão/);
    const r = await outbound.cancelOrder(sup, o.id, { reason: "Cliente desistiu" });
    expect(r.returns).toHaveLength(1);
    const order = await outbound.getOrder(sup, o.id);
    expect(order!.status).toBe("cancelled");
    expect(order!.reservations[0].status).toBe("returning");
    // Volume ainda na doca, reservado (indisponível) até a devolução.
    let b = await balanceOf(env, "CIA-001");
    expect(b.quantity).toBe(40);
    expect(b.reserved).toBe(20);
    expect((await env.one<{ status: string }>(`select status from erp.sales_orders where number = 'PV-1001'`)).status).toBe("open");
    const ev = await env.one<{ n: number }>(`select count(*) as n from wms.integration_events where event_type = 'outbound.cancelled' and aggregate_id = $1`, [o.id]);
    expect(ev.n).toBe(1);

    const ret = await env.one<{ id: string; to_location_id: string }>(`select id, to_location_id from wms.tasks where task_type = 'return' and order_id = $1`, [o.id]);
    expect(ret.to_location_id).toBe(origin);
    await expect(tasks.cancelTask(sup, ret.id, { reason: "Não quero devolver" })).rejects.toThrow(/devolução não podem/);
    await tasks.completeTask(env.as("operator"), ret.id, {});
    b = await balanceOf(env, "CIA-001");
    expect(b.quantity).toBe(40);
    expect(b.reserved).toBe(0);
    const atOrigin = await env.one<{ quantity: number }>(`select quantity from wms.stock_balances where location_id = $1 and product_id = $2`, [origin, productA]);
    expect(atOrigin.quantity).toBe(40);
    const m = await env.one<{ movement_type: string }>(`select movement_type from wms.stock_movements where task_id = $1`, [ret.id]);
    expect(m.movement_type).toBe("return");
    expect((await outbound.getOrder(sup, o.id))!.reservations[0].status).toBe("released");
  });

  it("cancelamento de linha em separação cancela a tarefa aberta e mantém o restante do pedido", async () => {
    const sup = env.as("supervisor");
    const chp = await env.product("CHP-004");
    const o = await outbound.createManualOrder(sup, {
      warehouseId,
      customerName: "Cliente duas linhas",
      lines: [
        { productId: productA, quantity: 5 },
        { productId: chp, quantity: 4 },
      ],
    });
    await outbound.reserveOrder(sup, o.id);
    await outbound.releaseForPicking(sup, o.id);
    const picks = (await tasks.listTasks(sup, { type: "picking", pageSize: 100 })).rows.filter((t) => t.order_id === o.id);
    await tasks.completeTask(env.as("operator"), picks.find((t) => t.sku === "CIA-001")!.id, {});
    const order = (await outbound.getOrder(sup, o.id))!;
    expect(order.status).toBe("picking");
    const chpLine = order.lines.find((l) => l.sku === "CHP-004")!;
    await outbound.cancelOrderLine(sup, o.id, { lineId: chpLine.id, reason: "Item descontinuado" });
    const after = (await outbound.getOrder(sup, o.id))!;
    expect(after.status).toBe("picked");
    expect(after.lines.find((l) => l.sku === "CHP-004")!.cancelled_at).not.toBeNull();
    expect((await balanceOf(env, "CHP-004")).reserved).toBe(0);
    const chpTask = await env.one<{ status: string }>(`select status from wms.tasks where id = $1`, [picks.find((t) => t.sku === "CHP-004")!.id]);
    expect(chpTask.status).toBe("cancelled");
    // Conferência ignora a linha cancelada; o pedido segue para expedição.
    const cia = after.lines.find((l) => l.sku === "CIA-001")!;
    expect((await outbound.checkOrder(env.as("operator"), o.id, { lines: [{ lineId: cia.id, checkedQty: 5 }] })).ok).toBe(true);
    const shipped = await outbound.shipOrder(env.as("operator"), o.id, {});
    expect(shipped.total).toBe(5);
    await expect(outbound.cancelOrder(sup, o.id, { reason: "Tarde demais" })).rejects.toThrow(/status "shipped"/);
  });
});
