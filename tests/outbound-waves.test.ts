import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, balanceOf, type TestEnv } from "./helpers";
import * as outbound from "@/server/services/outbound";
import * as tasks from "@/server/services/tasks";
import * as waves from "@/server/services/waves";
import { adjustStock } from "@/server/services/stock";

const LOC = (aisle: string, bay: string, level: string) => `DEP-01/RUA-${aisle}/MOD-${bay}/NIV-${level}/POS-00`;

describe("Ondas de separação", () => {
  let env: TestEnv;
  let warehouseId: string;
  let productA: string;

  beforeAll(async () => {
    env = await createTestEnv();
    warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    productA = await env.product("CIA-001");
    const admin = env.as("admin");
    await adjustStock(admin, { locationId: await env.location(LOC("01", "01", "01")), productId: productA, direction: "in", quantity: 50, reason: "Saldo para teste de ondas" });
    await adjustStock(admin, { locationId: await env.location(LOC("02", "02", "02")), productId: productA, direction: "in", quantity: 30, reason: "Saldo para teste de ondas" });
  });

  const reservedOrder = async (quantity: number, priority = 2) => {
    const sup = env.as("supervisor");
    const o = await outbound.createManualOrder(sup, { warehouseId, customerName: `Cliente onda ${quantity}`, priority, lines: [{ productId: productA, quantity }] });
    await outbound.reserveOrder(sup, o.id);
    return o;
  };

  it("sequencia o roteiro por rua, módulo em serpentina, nível e posição", () => {
    const stops = [
      { aisle: "02", bay: "01", level: "01", position: "00", id: "c" },
      { aisle: "01", bay: "02", level: "02", position: "00", id: "b" },
      { aisle: "01", bay: "02", level: "01", position: "00", id: "a2" },
      { aisle: "01", bay: "01", level: "01", position: "00", id: "a" },
      { aisle: "02", bay: "03", level: "01", position: "00", id: "d" },
      { aisle: "10", bay: "01", level: "01", position: "00", id: "e" },
    ];
    // Rua 01 crescente; rua 02 decrescente (serpentina); rua 10 depois da 02 (ordem numérica).
    expect(waves.sequenceRoute(stops).map((s) => s.id)).toEqual(["a", "a2", "b", "d", "c", "e"]);
  });

  it("consolida reservas por endereço, rastreia a quantidade por pedido e distribui na doca", async () => {
    const sup = env.as("supervisor");
    const o1 = await reservedOrder(10);
    const o2 = await reservedOrder(15);
    const w = await waves.createWave(sup, { warehouseId, grouping: "manual", orderIds: [o1.id, o2.id] });
    expect(w.orders).toBe(2);
    // Pedido em onda não é liberado individualmente.
    await expect(outbound.releaseForPicking(sup, o1.id)).rejects.toThrow(/está na onda/);

    const rel = await waves.releaseWave(sup, w.id);
    const wave = await waves.getWave(sup, w.id);
    expect(wave!.status).toBe("released");
    // Ambas as reservas vieram do mesmo saldo (menor saldo primeiro) → uma tarefa consolidada de 25.
    expect(rel.tasks).toHaveLength(1);
    const task = wave!.tasks[0];
    expect(task.quantity).toBe(25);
    expect(task.pick_sequence).toBe(1);
    expect(task.allocations.map((a) => a.quantity).sort()).toEqual([10, 15]);
    expect((await outbound.getOrder(sup, o1.id))!.status).toBe("picking");

    // Operador separa 22 (falta 3): o pedido mais antigo recebe tudo; a falta fica com o segundo.
    const op = env.as("operator");
    await tasks.startTask(op, task.id);
    expect((await waves.getWave(sup, w.id))!.status).toBe("picking");
    await tasks.completeTask(op, task.id, { quantity: 22, notes: "Faltaram 3" });
    const after = await waves.getWave(sup, w.id);
    expect(after!.status).toBe("picked");
    const byCode = Object.fromEntries(after!.orders.map((o) => [o.code, o]));
    expect(byCode[o1.code].picked).toBe(10);
    expect(byCode[o2.code].picked).toBe(12);
    // Movimento de separação por pedido.
    const moves = await env.db.query<{ reference_code: string; quantity: number }>(
      `select reference_code, quantity from wms.stock_movements where task_id = $1 order by reference_code`,
      [task.id],
    );
    expect(moves.map((m) => `${m.reference_code}:${m.quantity}`)).toEqual([`${o1.code}:10`, `${o2.code}:12`]);
    const div = await env.one<{ quantity: number }>(`select quantity from wms.divergences where order_id = $1 and divergence_type = 'short_pick'`, [o2.id]);
    expect(div.quantity).toBe(3);
    // Antes da distribuição, os pedidos continuam em separação: a conferência por pedido não é possível.
    expect((await outbound.getOrder(sup, o1.id))!.status).toBe("picking");
    const lines1 = (await outbound.getOrder(sup, o1.id))!.lines;
    await expect(outbound.checkOrder(op, o1.id, { lines: [{ lineId: lines1[0].id, checkedQty: 10 }] })).rejects.toThrow(/status "picking"/);

    await waves.distributeWaveOrder(op, w.id, { orderId: o1.id });
    await expect(waves.distributeWaveOrder(op, w.id, { orderId: o1.id })).rejects.toThrow(/já foi distribuído/);
    expect((await outbound.getOrder(sup, o1.id))!.status).toBe("picked");
    const ok = await outbound.checkOrder(op, o1.id, { lines: [{ lineId: lines1[0].id, checkedQty: 10 }] });
    expect(ok.ok).toBe(true);
    await waves.distributeWaveOrder(op, w.id, { orderId: o2.id });
    expect((await waves.getWave(sup, w.id))!.status).toBe("completed");
    // Saldo: 80 físicos − 3 que seguem no endereço (falta física apurada por divergência); 22 na doca reservados.
    const b = await balanceOf(env, "CIA-001");
    expect(b.quantity).toBe(80);
    expect(b.reserved).toBe(22);
  });

  it("um pedido participa de no máximo uma onda ativa (serviço, concorrência e banco)", async () => {
    const sup = env.as("supervisor");
    const o = await reservedOrder(2);
    const results = await Promise.allSettled([
      waves.createWave(sup, { warehouseId, grouping: "manual", orderIds: [o.id] }),
      waves.createWave(sup, { warehouseId, grouping: "manual", orderIds: [o.id] }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const active = await env.one<{ n: number; wave_id: string }>(
      `select count(*) as n, min(wave_id::text) as wave_id from wms.wave_orders where order_id = $1 and active`,
      [o.id],
    );
    expect(active.n).toBe(1);
    // A restrição do banco barra a segunda onda ativa mesmo por fora do serviço.
    const other = await env.id(
      `insert into wms.waves (company_id, warehouse_id, code, grouping, dock_location_id, created_by)
       select w.company_id, w.warehouse_id, 'OND-X', 'manual', w.dock_location_id, w.created_by from wms.waves w
       where w.id = $1 returning id`,
      [active.wave_id],
    );
    await expect(
      env.db.query(`insert into wms.wave_orders (company_id, wave_id, order_id, added_by) select company_id, $1, order_id, added_by from wms.wave_orders where order_id = $2`, [
        other,
        o.id,
      ]),
    ).rejects.toMatchObject({ code: "23505" });
    // Cancelar a onda (sem separação iniciada) devolve o pedido a "reservado" e libera para outra onda.
    await waves.cancelWave(sup, active.wave_id, { reason: "Replanejamento" });
    expect((await outbound.getOrder(sup, o.id))!.status).toBe("reserved");
    const again = await waves.createWave(sup, { warehouseId, grouping: "manual", orderIds: [o.id] });
    expect(again.orders).toBe(1);
  });

  it("agrupa por transportadora e por data prevista; exige permissão", async () => {
    const sup = env.as("supervisor");
    const o = await reservedOrder(1);
    await outbound.setOrderPlanning(sup, o.id, { carrier: "Rápido Sul", plannedShipDate: "2026-12-01" });
    await expect(waves.createWave(sup, { warehouseId, grouping: "carrier", carrier: "Lenta Norte" })).rejects.toThrow(/Nenhum pedido/);
    const w = await waves.createWave(sup, { warehouseId, grouping: "carrier", carrier: "rápido sul" });
    expect(w.orders).toBe(1);
    await expect(waves.createWave(env.as("operator"), { warehouseId, grouping: "date", plannedDate: "2026-12-01" })).rejects.toThrow(/permissão/);
  });

  it("cancelar pedido de onda em separação retira suas alocações das tarefas consolidadas", async () => {
    const sup = env.as("supervisor");
    const o1 = await reservedOrder(3);
    const o2 = await reservedOrder(4);
    const w = await waves.createWave(sup, { warehouseId, grouping: "manual", orderIds: [o1.id, o2.id] });
    await waves.releaseWave(sup, w.id);
    const before = (await waves.getWave(sup, w.id))!.tasks.filter((t) => t.status !== "cancelled");
    const total = before.reduce((s, t) => s + t.quantity, 0);
    await outbound.cancelOrder(sup, o2.id, { reason: "Cliente desistiu" });
    const after = (await waves.getWave(sup, w.id))!;
    const open = after.tasks.filter((t) => t.status !== "cancelled");
    expect(open.reduce((s, t) => s + t.quantity, 0)).toBe(total - 4);
    expect(after.orders.find((o) => o.order_id === o2.id)!.active).toBe(false);
    for (const t of open) await tasks.completeTask(env.as("operator"), t.id, {});
    expect((await waves.getWave(sup, w.id))!.status).toBe("picked");
    await waves.distributeWaveOrder(env.as("operator"), w.id, { orderId: o1.id });
    expect((await waves.getWave(sup, w.id))!.status).toBe("completed");
  });
});
