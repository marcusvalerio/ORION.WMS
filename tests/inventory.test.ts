import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, balanceOf, type TestEnv } from "./helpers";
import * as inventory from "@/server/services/inventory";
import * as tasks from "@/server/services/tasks";
import { adjustStock } from "@/server/services/stock";
import { suggestLocations, validateDestination } from "@/server/services/stock-core";
import { updateSettings } from "@/server/services/settings";
import { adjustedExpected, decideRounds, withinTolerance } from "@/lib/inventory-rules";

const TOL5 = ["A", "B", "C"].map((abcClass) => ({ abcClass, tolerancePct: 5, toleranceUnits: 0, approvalLimitValue: 500, approvalRole: "admin" }));

describe("Inventário: regras puras", () => {
  it("tolerância: vale o maior entre % e unidades", () => {
    expect(withinTolerance(100, 98, { tolerance_pct: 2, tolerance_units: 0 })).toBe(true);
    expect(withinTolerance(100, 97, { tolerance_pct: 2, tolerance_units: 0 })).toBe(false);
    expect(withinTolerance(10, 7, { tolerance_pct: 1, tolerance_units: 3 })).toBe(true);
    expect(withinTolerance(0, 1, { tolerance_pct: 5, tolerance_units: 0 })).toBe(false);
  });

  it("desempate: vale o valor que se repete; se as três diferem, vale a 3ª", () => {
    const tol = { tolerance_pct: 0, tolerance_units: 0 };
    expect(decideRounds(10, [10], tol)).toEqual({ closed: true, value: 10 });
    expect(decideRounds(10, [8], tol)).toEqual({ closed: false, nextRound: 2 });
    expect(decideRounds(10, [8, 8], tol)).toEqual({ closed: true, value: 8 });
    expect(decideRounds(10, [8, 9], tol)).toEqual({ closed: false, nextRound: 3 });
    expect(decideRounds(10, [8, 9, 8], tol)).toEqual({ closed: true, value: 8 });
    expect(decideRounds(10, [8, 9, 9], tol)).toEqual({ closed: true, value: 9 });
    expect(decideRounds(10, [8, 9, 7], tol)).toEqual({ closed: true, value: 7 });
  });

  it("esperado ajustado no modo reconcile", () => {
    expect(adjustedExpected(30, 5, 2)).toBe(33);
  });
});

describe("Inventário", () => {
  let env: TestEnv;
  let warehouseId: string;

  beforeAll(async () => {
    env = await createTestEnv();
    warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    await inventory.saveInventoryConfig(env.as("admin"), { tolerances: TOL5 });
  });

  const itemsOf = async (id: string) =>
    env.db.query<{ id: string; status: string; location_id: string; expected_qty: number; product_id: string | null; empty_location: boolean }>(
      `select id, status, location_id, expected_qty, product_id, empty_location from wms.inventory_count_items where inventory_id = $1`,
      [id],
    );

  it("rotativo exige filtro; geral captura saldo, endereços vazios (esperado 0) e gera tarefa", async () => {
    const sup = env.as("supervisor");
    await expect(inventory.createInventory(sup, { warehouseId, countType: "cyclic" })).rejects.toThrow(/exige ao menos um filtro/);
    await expect(inventory.createInventory(env.as("operator"), { warehouseId, countType: "general" })).rejects.toThrow(/permissão/);
    const inv = await inventory.createInventory(sup, { warehouseId, countType: "general" });
    const items = await itemsOf(inv.id);
    const data = await inventory.getInventory(sup, inv.id);
    // Seed: LUB-002 (30) e CHP-004 (40)
    expect(data!.items.filter((i) => !i.empty_location).map((i) => i.sku).sort()).toEqual(["CHP-004", "LUB-002"]);
    expect(items.filter((i) => !i.empty_location).map((i) => Number(i.expected_qty)).sort()).toEqual([30, 40]);
    expect(items.some((i) => i.empty_location && i.product_id === null && Number(i.expected_qty) === 0)).toBe(true);
    const { rows } = await tasks.listTasks(sup, { type: "inventory" });
    expect(rows.some((t) => t.inventory_id === inv.id && t.status === "pending")).toBe(true);
    await inventory.cancelInventory(sup, inv.id, { reason: "Somente teste da abertura" });
  });

  it("calendário ABC gera as contagens de hoje sem duplicar", async () => {
    const sup = env.as("supervisor");
    const cal = await inventory.getCycleCalendar(sup, warehouseId);
    expect(cal.calendar).toHaveLength(30);
    const first = await inventory.generateCycleCounts(sup, { warehouseId });
    expect(first.created).toBe(true);
    expect(first.locations).toBeGreaterThan(0);
    const again = await inventory.generateCycleCounts(sup, { warehouseId });
    expect(again).toMatchObject({ id: first.id, created: false });
    const n = await env.one<{ n: number }>(
      `select count(*)::int as n from wms.inventory_counts where origin = 'calendar' and plan_date = current_date and status <> 'cancelled'`,
    );
    expect(n.n).toBe(1);
    await inventory.cancelInventory(sup, first.id!, { reason: "Fim do teste do calendário" });
  });

  it("contagem cega: a folha não devolve o esperado durante a contagem (nem ao supervisor)", async () => {
    const sup = env.as("supervisor");
    const inv = await inventory.createInventory(sup, { warehouseId, countType: "cyclic", productId: await env.product("CHP-004") });
    const data = await inventory.getInventory(sup, inv.id);
    expect(data!.blind).toBe(true);
    expect(data!.items.every((i) => i.expected_qty === null)).toBe(true);
    await inventory.cancelInventory(sup, inv.id, { reason: "Somente teste da folha" });
  });

  it("dentro da tolerância: fecha na 1ª contagem e o ajuste é automático na aprovação, valorizado e com evento por linha", async () => {
    const sup = env.as("supervisor");
    const op = env.as("operator");
    const inv = await inventory.createInventory(sup, { warehouseId, countType: "cyclic", productId: await env.product("CHP-004") });
    const [item] = await itemsOf(inv.id);
    const r = await inventory.recordCounts(op, inv.id, { items: [{ itemId: item.id, countedQty: 39, notes: "1 chapa danificada" }] });
    expect(r.results[0]).toMatchObject({ closed: true, round: 1 });
    expect((await balanceOf(env, "CHP-004")).quantity).toBe(40);
    // o lock sai quando o endereço fecha dentro da tolerância
    expect(await env.one(`select count(*)::int as n from wms.inventory_location_locks where inventory_id = $1`, [inv.id])).toEqual({ n: 0 });
    await expect(inventory.recordCounts(op, inv.id, { items: [{ itemId: item.id, countedQty: 38 }] })).rejects.toThrow(/já foi contado/);
    expect((await inventory.submitInventory(op, inv.id)).differences).toBe(1);
    await expect(inventory.approveInventory(op, inv.id, {})).rejects.toThrow(/permissão/);
    const approved = await inventory.approveInventory(sup, inv.id, { notes: "Conferido" });
    expect(approved.adjustments).toBe(1);
    expect((await balanceOf(env, "CHP-004")).quantity).toBe(39);
    const mov = await env.one<{ movement_type: string; quantity: number; unit_cost: number | null; reason_code: string }>(
      `select movement_type, quantity, unit_cost, reason_code from wms.stock_movements where reference_type = 'inventory' and reference_id = $1`,
      [inv.id],
    );
    expect(mov).toMatchObject({ movement_type: "adjustment_out", quantity: 1, reason_code: "INV_FALTA" });
    const events = await env.db.query<{ payload: { idempotency_key: string; quantity: number } }>(
      `select payload from wms.integration_events where event_type = 'inventory.adjustment_posted' and aggregate_id = $1`,
      [inv.id],
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ idempotency_key: `${inv.id}+${item.id}+1`, quantity: -1 });
    await expect(inventory.approveInventory(sup, inv.id, {})).rejects.toThrow(/não está aguardando aprovação/);
  });

  it("fora da tolerância: 2ª contagem cega por outro usuário; desempate pelo supervisor", async () => {
    const sup = env.as("supervisor");
    const op = env.as("operator");
    const adm = env.as("admin");
    const inv = await inventory.createInventory(sup, { warehouseId, countType: "cyclic", productId: await env.product("LUB-002") });
    const [item] = await itemsOf(inv.id);
    const r1 = await inventory.recordCounts(op, inv.id, { items: [{ itemId: item.id, countedQty: 20 }] });
    expect(r1.results[0]).toMatchObject({ closed: false, nextRound: 2 });
    await expect(inventory.recordCounts(op, inv.id, { items: [{ itemId: item.id, countedQty: 20 }] })).rejects.toThrow(/outro usuário/);
    await expect(inventory.submitInventory(op, inv.id)).rejects.toThrow(/aguardando recontagem/);
    const r2 = await inventory.recordCounts(adm, inv.id, { items: [{ itemId: item.id, countedQty: 22 }] });
    expect(r2.results[0]).toMatchObject({ closed: false, nextRound: 3 });
    await expect(inventory.recordCounts(op, inv.id, { items: [{ itemId: item.id, countedQty: 22 }] })).rejects.toThrow(/supervisor/);
    const r3 = await inventory.recordCounts(sup, inv.id, { items: [{ itemId: item.id, countedQty: 22 }] });
    expect(r3.results[0]).toMatchObject({ closed: true, round: 3 });
    const counted = await env.one<{ counted_qty: number; rounds: number }>(
      `select i.counted_qty, (select count(*)::int from wms.inventory_count_rounds r where r.inventory_item_id = i.id) as rounds
       from wms.inventory_count_items i where i.id = $1`,
      [item.id],
    );
    expect(counted).toEqual({ counted_qty: 22, rounds: 3 });
    await inventory.cancelInventory(sup, inv.id, { reason: "Fim do teste de rodadas" });
  });

  it("lock: endereço em contagem recusa entrada, saída, sugestão e destino; libera ao cancelar", async () => {
    const sup = env.as("supervisor");
    const op = env.as("operator");
    const productId = await env.product("LUB-002");
    const inv = await inventory.createInventory(sup, { warehouseId, countType: "cyclic", productId });
    const [item] = await itemsOf(inv.id);
    await inventory.recordCounts(op, inv.id, { items: [{ itemId: item.id, countedQty: 10 }] }); // fora da tolerância: lock continua
    const code = (await env.one<{ code: string }>(`select code from wms.inventory_counts where id = $1`, [inv.id])).code;
    const lotCode = (await env.one<{ lot_code: string }>(`select lot_code from wms.inventory_count_items where id = $1`, [item.id])).lot_code;
    const adj = (direction: "in" | "out") =>
      adjustStock(sup, { locationId: item.location_id, productId, lotCode, direction, quantity: 1, reason: "Teste de bloqueio" });
    await expect(adj("in")).rejects.toThrow(new RegExp(`Endereço em contagem \\(${code}\\)`));
    await expect(adj("out")).rejects.toThrow(/Endereço em contagem/);
    await env.db.transaction(async (tx) => {
      const s = await suggestLocations(tx, sup, { warehouseId, productId, lotCode, quantity: 1 });
      expect(s.candidates.some((c) => c.location.id === item.location_id)).toBe(false);
      await expect(validateDestination(tx, sup, { locationId: item.location_id, warehouseId, productId, quantity: 1 })).rejects.toThrow(
        /Endereço em contagem/,
      );
    });
    await inventory.cancelInventory(sup, inv.id, { reason: "Libera o endereço" });
    await adj("in");
    await adj("out");
  });

  it("saldo alterado antes da contagem: o item volta para recontagem sem derrubar o inventário", async () => {
    const sup = env.as("supervisor");
    const op = env.as("operator");
    const productId = await env.product("LUB-002");
    const inv = await inventory.createInventory(sup, { warehouseId, countType: "cyclic", productId });
    const [item] = await itemsOf(inv.id);
    const lotCode = (await env.one<{ lot_code: string }>(`select lot_code from wms.inventory_count_items where id = $1`, [item.id])).lot_code;
    // movimento antes do lock (ninguém começou a contar o endereço)
    await adjustStock(sup, { locationId: item.location_id, productId, lotCode, direction: "in", quantity: 1, reason: "Entrada antes da contagem" });
    await inventory.recordCounts(op, inv.id, { items: [{ itemId: item.id, countedQty: 30 }] });
    await inventory.submitInventory(op, inv.id);
    const r = await inventory.approveInventory(sup, inv.id, {});
    expect(r).toMatchObject({ adjustments: 0, stale: 1 });
    const data = await inventory.getInventory(sup, inv.id);
    expect(data!.status).toBe("counting");
    expect(data!.items[0].status).toBe("recount");
    await adjustStock(sup, { locationId: item.location_id, productId, lotCode, direction: "out", quantity: 1, reason: "Desfaz" }).catch(() => undefined);
    await inventory.cancelInventory(sup, inv.id, { reason: "Fim do teste de foto" });
  });

  it("modo reconcile: sem bloqueio; o esperado considera entradas e saídas desde a foto", async () => {
    const adm = env.as("admin");
    const sup = env.as("supervisor");
    const op = env.as("operator");
    await updateSettings(adm, { "inventory.segregation_of_duties": "on", "inventory.lock_mode": "reconcile" });
    try {
      const productId = await env.product("LUB-002");
      const before = (await balanceOf(env, "LUB-002")).quantity;
      const inv = await inventory.createInventory(sup, { warehouseId, countType: "cyclic", productId });
      const [item] = await itemsOf(inv.id);
      const lotCode = (await env.one<{ lot_code: string }>(`select lot_code from wms.inventory_count_items where id = $1`, [item.id])).lot_code;
      const expected = Number(item.expected_qty);
      await inventory.recordCounts(op, inv.id, { items: [{ itemId: item.id, countedQty: expected }] });
      await adjustStock(sup, { locationId: item.location_id, productId, lotCode, direction: "in", quantity: 2, reason: "Entrada durante a contagem" });
      await inventory.submitInventory(op, inv.id);
      const r = await inventory.approveInventory(sup, inv.id, {});
      // contado = foto; esperado ajustado = foto + 2: ajuste de −2 sobre o saldo atual
      expect(r).toMatchObject({ stale: 0, adjustments: 1 });
      expect((await balanceOf(env, "LUB-002")).quantity).toBe(before);
    } finally {
      await updateSettings(adm, { "inventory.segregation_of_duties": "on", "inventory.lock_mode": "lock" });
    }
  });

  it("alçada: diferença acima do limite só o Administrador aprova; segregação avisada antes", async () => {
    const sup = env.as("supervisor");
    const op = env.as("operator");
    const adm = env.as("admin");
    const productId = await env.product("LUB-002"); // último preço de compra: R$ 10
    await inventory.saveInventoryConfig(adm, { tolerances: TOL5.map((t) => ({ ...t, approvalLimitValue: 1 })) });
    try {
      const inv = await inventory.createInventory(sup, { warehouseId, countType: "cyclic", productId });
      const [item] = await itemsOf(inv.id);
      const target = Number(item.expected_qty) + 30; // fora da tolerância; 30 × R$ 10 acima da alçada de R$ 1
      await inventory.recordCounts(op, inv.id, { items: [{ itemId: item.id, countedQty: target }] });
      await inventory.recordCounts(adm, inv.id, { items: [{ itemId: item.id, countedQty: target }] });
      await inventory.submitInventory(op, inv.id);
      const forSup = await inventory.getInventory(sup, inv.id);
      expect(forSup!.canApprove).toBe(false);
      expect(forSup!.blockedReason).toMatch(/alçada/);
      await expect(inventory.approveInventory(sup, inv.id, {})).rejects.toThrow(/alçada/);
      const forAdm = await inventory.getInventory(adm, inv.id);
      expect(forAdm!.blockedReason).toMatch(/Você contou neste inventário/);
      await expect(inventory.approveInventory(adm, inv.id, {})).rejects.toThrow(/Segregação/);
      await inventory.cancelInventory(sup, inv.id, { reason: "Fim do teste de alçada" });
    } finally {
      await inventory.saveInventoryConfig(adm, { tolerances: TOL5 });
      await updateSettings(adm, { "inventory.segregation_of_duties": "on" });
    }
  });

  it("endereço vazio entra na foto; item encontrado nele é criado e a linha vazia fecha", async () => {
    const sup = env.as("supervisor");
    const op = env.as("operator");
    const adm = env.as("admin");
    const loc = await env.location("DEP-01/RUA-02/MOD-02/NIV-01/POS-00");
    const inv = await inventory.createInventory(sup, { warehouseId, countType: "cyclic", locationId: loc });
    const items = await itemsOf(inv.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ empty_location: true, product_id: null });
    await expect(inventory.recordCounts(op, inv.id, { items: [{ itemId: items[0].id, countedQty: 3 }] })).rejects.toThrow(/previsto vazio/);
    const before = (await balanceOf(env, "CIA-001")).quantity;
    const found = await inventory.addInventoryItem(op, inv.id, { locationId: loc, productId: await env.product("CIA-001"), countedQty: 4 });
    expect(found).toMatchObject({ closed: false, nextRound: 2 }); // esperado 0: fora da tolerância
    await inventory.recordCounts(sup, inv.id, { items: [{ itemId: found.id, countedQty: 4 }] });
    const after = await itemsOf(inv.id);
    expect(after.find((i) => i.empty_location)!.status).toBe("closed");
    await inventory.submitInventory(op, inv.id);
    await inventory.approveInventory(adm, inv.id, {});
    expect((await balanceOf(env, "CIA-001")).quantity).toBe(before + 4);
  });

  it("devolver itens para recontagem exige motivo e reabre só os itens escolhidos", async () => {
    const sup = env.as("supervisor");
    const op = env.as("operator");
    const inv = await inventory.createInventory(sup, { warehouseId, countType: "cyclic", productId: await env.product("LUB-002") });
    const [item] = await itemsOf(inv.id);
    await inventory.recordCounts(op, inv.id, { items: [{ itemId: item.id, countedQty: Number(item.expected_qty) }] });
    await inventory.submitInventory(op, inv.id);
    await expect(inventory.returnItemsForRecount(sup, inv.id, { itemIds: [item.id], notes: "ok" })).rejects.toThrow(/mínimo de 5/);
    await inventory.returnItemsForRecount(sup, inv.id, { itemIds: [item.id], notes: "Conferir de novo" });
    const data = await inventory.getInventory(sup, inv.id);
    expect(data!.status).toBe("counting");
    expect(data!.items[0]).toMatchObject({ status: "recount", round: 2 });
    await inventory.cancelInventory(sup, inv.id, { reason: "Fim do teste de recontagem" });
  });

  it("registro de inventário por data de referência (Bloco H)", async () => {
    const sup = env.as("supervisor");
    const op = env.as("operator");
    const adm = env.as("admin");
    const inv = await inventory.createInventory(sup, {
      warehouseId,
      countType: "cyclic",
      productId: await env.product("LUB-002"),
      referenceDate: "2026-12-31",
    });
    const [item] = await itemsOf(inv.id);
    await inventory.recordCounts(op, inv.id, { items: [{ itemId: item.id, countedQty: Number(item.expected_qty) }] });
    await inventory.submitInventory(op, inv.id);
    await inventory.approveInventory(adm, inv.id, {});
    const reg = await inventory.inventoryRegister(adm, "2026-12-31");
    expect(reg.lines.map((l) => l.sku)).toEqual(["LUB-002"]);
    const csv = inventory.inventoryRegisterCsv(reg);
    expect(csv.split("\n")[1]).toMatch(/^H010;LUB-002;/);
  });
});
