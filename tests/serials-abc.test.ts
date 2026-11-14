import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, type TestEnv } from "./helpers";
import * as outbound from "@/server/services/outbound";
import * as tasks from "@/server/services/tasks";
import * as slotting from "@/server/services/slotting";
import { parseSerials } from "@/server/services/serials";
import { adjustStock } from "@/server/services/stock";

describe("Número de série na separação e na expedição", () => {
  let env: TestEnv;
  let warehouseId: string;
  let sensor: string;

  beforeAll(async () => {
    env = await createTestEnv();
    warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    sensor = await env.product("SEN-005"); // serial_controlled no seed
    await adjustStock(env.as("admin"), {
      locationId: await env.location("DEP-01/RUA-01/MOD-03/NIV-01/POS-00"),
      productId: sensor,
      direction: "in",
      quantity: 5,
      reason: "Sensores para teste de série",
    });
  });

  const pickTaskFor = async (quantity: number) => {
    const sup = env.as("supervisor");
    const o = await outbound.createManualOrder(sup, { warehouseId, customerName: "Cliente sensores", lines: [{ productId: sensor, quantity }] });
    await outbound.reserveOrder(sup, o.id);
    await outbound.releaseForPicking(sup, o.id);
    const t = (await tasks.listTasks(sup, { type: "picking", pageSize: 100 })).rows.find((x) => x.order_id === o.id)!;
    return { order: o, task: t };
  };

  it("normaliza a lista de séries", () => {
    expect(parseSerials("sn-1\nSN-2, sn-3; ")).toEqual(["SN-1", "SN-2", "SN-3"]);
  });

  it("exige uma série por unidade separada, sem repetição, e impede série duplicada em estoque", async () => {
    const op = env.as("operator");
    const { order, task } = await pickTaskFor(2);
    await expect(tasks.completeTask(op, task.id, {})).rejects.toThrow(/Informe 2 número/);
    await expect(tasks.completeTask(op, task.id, { serials: "A1\nA1" })).rejects.toThrow(/repetidos/);
    await tasks.completeTask(op, task.id, { serials: "A1\nA2" });

    const second = await pickTaskFor(1);
    await expect(tasks.completeTask(op, second.task.id, { serials: "A2" })).rejects.toThrow(/já está em estoque/);
    await tasks.completeTask(op, second.task.id, { serials: "A3" });

    // Restrição do banco: mesma série duas vezes em estoque.
    await expect(
      env.db.query(
        `insert into wms.serial_numbers (company_id, product_id, serial, status, location_id)
         select company_id, product_id, serial, 'in_stock', location_id from wms.serial_numbers where serial = 'A1'`,
      ),
    ).rejects.toMatchObject({ code: "23505" });

    // Expedição: as séries lidas precisam ser exatamente as separadas.
    const o = (await outbound.getOrder(op, order.id))!;
    const line = o.lines[0];
    expect((await outbound.checkOrder(op, order.id, { lines: [{ lineId: line.id, checkedQty: 2 }] })).ok).toBe(true);
    await expect(outbound.shipOrder(op, order.id, { serials: { [line.id]: "A1 A3" } })).rejects.toThrow(/não conferem/);
    await expect(outbound.shipOrder(op, order.id, {})).rejects.toThrow(/Informe 2 número/);
    await outbound.shipOrder(op, order.id, { serials: { [line.id]: "a2, a1" } });
    const s = await env.db.query<{ serial: string; status: string }>(`select serial, status from wms.serial_numbers order by serial`);
    expect(s).toEqual([
      { serial: "A1", status: "shipped" },
      { serial: "A2", status: "shipped" },
      { serial: "A3", status: "picked" },
    ]);
    const links = await env.one<{ n: number }>(
      `select count(*) as n from wms.movement_serials ms join wms.stock_movements m on m.id = ms.movement_id where m.movement_type in ('pick', 'shipment')`,
    );
    expect(links.n).toBe(5); // 3 separações + 2 expedições
  });

  it("série devolvida após cancelamento volta ao estoque no endereço", async () => {
    const sup = env.as("supervisor");
    const orderId = await env.id(
      `select l.order_id as id from wms.serial_numbers s join wms.outbound_order_lines l on l.id = s.order_line_id where s.serial = 'A3'`,
    );
    await outbound.cancelOrder(sup, orderId, { reason: "Pedido duplicado" });
    const ret = await env.id(`select id from wms.tasks where task_type = 'return' and order_id = $1`, [orderId]);
    await tasks.completeTask(env.as("operator"), ret, {});
    const s = await env.one<{ status: string; code: string }>(
      `select s.status, l.code from wms.serial_numbers s join wms.locations l on l.id = s.location_id where s.serial = 'A3'`,
    );
    expect(s).toEqual({ status: "in_stock", code: "DEP-01/RUA-01/MOD-03/NIV-01/POS-00" });
  });
});

describe("Curva ABC e slotting", () => {
  let env: TestEnv;

  beforeAll(async () => {
    env = await createTestEnv();
  });

  it("classifica pela participação acumulada com cortes configuráveis", () => {
    const rows = [
      { sku: "X", metric: 70 },
      { sku: "Y", metric: 20 },
      { sku: "Z", metric: 6 },
      { sku: "W", metric: 4 },
      { sku: "V", metric: 0 },
    ];
    expect(slotting.classifyAbc(rows, 80, 15).map((r) => `${r.sku}:${r.abc}`)).toEqual(["X:A", "Y:A", "Z:B", "W:C", "V:C"]);
    expect(slotting.classifyAbc(rows, 60, 30).map((r) => `${r.sku}:${r.abc}`)).toEqual(["X:A", "Y:B", "Z:C", "W:C", "V:C"]);
  });

  it("calcula o giro pelas separações e sugere levar item A do nível alto para o picking", async () => {
    const sup = env.as("supervisor");
    const warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    const cia = await env.product("CIA-001");
    const high = await env.location("DEP-01/RUA-01/MOD-03/NIV-02/POS-00");
    await adjustStock(env.as("admin"), { locationId: high, productId: cia, direction: "in", quantity: 30, reason: "Saldo para curva ABC" });
    const o = await outbound.createManualOrder(sup, { warehouseId, customerName: "Cliente giro", lines: [{ productId: cia, quantity: 10 }] });
    await outbound.reserveOrder(sup, o.id);
    await outbound.releaseForPicking(sup, o.id);
    const pick = (await tasks.listTasks(sup, { type: "picking" })).rows.find((t) => t.order_id === o.id)!;
    await tasks.completeTask(env.as("operator"), pick.id, {});

    const abc = await slotting.computeAbc(sup);
    const bySku = Object.fromEntries(abc.rows.map((r) => [r.sku, r]));
    expect(bySku["CIA-001"].abc).toBe("A");
    expect(bySku["CIA-001"].units).toBe(10);
    expect(bySku["CHP-004"].abc).toBe("C"); // estoque sem giro
    const lines = await slotting.computeAbc(sup, { basis: "lines" });
    expect(lines.rows.find((r) => r.sku === "CIA-001")!.metric).toBe(1);

    const suggestions = await slotting.slottingSuggestions(sup);
    const s = suggestions.find((x) => x.sku === "CIA-001")!;
    expect(s.from_code).toBe("DEP-01/RUA-01/MOD-03/NIV-02/POS-00");
    expect(s.to_code).toMatch(/RUA-PK/);
    expect(s.to_cost).toBeLessThan(s.from_cost);
    await expect(slotting.createSlottingTransfer(env.as("operator"), { ...s, fromLocationId: s.from_location_id, toLocationId: s.to_location_id, productId: s.product_id, quantity: s.available })).rejects.toThrow(/permissão/);
    const t = await slotting.createSlottingTransfer(sup, {
      fromLocationId: s.from_location_id,
      toLocationId: s.to_location_id,
      productId: s.product_id,
      lotCode: s.lot_code,
      quantity: s.available,
    });
    const task = await env.one<{ task_type: string; quantity: number }>(`select task_type, quantity from wms.tasks where id = $1`, [t.id]);
    expect(task).toEqual({ task_type: "transfer", quantity: 20 });
  });

  it("parâmetros validados e salvos por supervisor", async () => {
    await expect(slotting.saveSlottingSettings(env.as("supervisor"), { days: 30, basis: "units", aPct: 90, bPct: 15 })).rejects.toThrow(/menor que 100/);
    await expect(slotting.saveSlottingSettings(env.as("operator"), { days: 30, basis: "units", aPct: 70, bPct: 20 })).rejects.toThrow(/permissão/);
    await slotting.saveSlottingSettings(env.as("supervisor"), { days: 30, basis: "lines", aPct: 70, bPct: 20 });
    expect(await slotting.getSlottingSettings(env.as("auditor"))).toEqual({ days: 30, basis: "lines", a_pct: 70, b_pct: 20 });
  });
});
