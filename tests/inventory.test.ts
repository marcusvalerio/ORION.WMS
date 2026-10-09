import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, balanceOf, type TestEnv } from "./helpers";
import * as inventory from "@/server/services/inventory";
import * as tasks from "@/server/services/tasks";
import { adjustStock } from "@/server/services/stock";

describe("Inventário", () => {
  let env: TestEnv;
  let warehouseId: string;

  beforeAll(async () => {
    env = await createTestEnv();
    warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
  });

  it("inventário rotativo exige filtro; geral captura o saldo esperado e gera tarefa", async () => {
    const sup = env.as("supervisor");
    await expect(inventory.createInventory(sup, { warehouseId, countType: "cyclic" })).rejects.toThrow(/exige ao menos um filtro/);
    await expect(inventory.createInventory(env.as("operator"), { warehouseId, countType: "general" })).rejects.toThrow(/permissão/);
    const inv = await inventory.createInventory(sup, { warehouseId, countType: "general" });
    const data = await inventory.getInventory(sup, inv.id);
    // Seed: LUB-002 (30) e CHP-004 (40)
    expect(data!.items.map((i) => `${i.sku}:${i.expected_qty}`).sort()).toEqual(["CHP-004:40", "LUB-002:30"]);
    const { rows } = await tasks.listTasks(sup, { type: "inventory" });
    expect(rows.some((t) => t.inventory_id === inv.id && t.status === "pending")).toBe(true);
  });

  it("contagem não altera saldo; ajuste só após aprovação com permissão", async () => {
    const sup = env.as("supervisor");
    const op = env.as("operator");
    const inv = await inventory.createInventory(sup, { warehouseId, countType: "cyclic", productId: await env.product("CHP-004") });
    const data = await inventory.getInventory(op, inv.id);
    await expect(inventory.submitInventory(op, inv.id)).rejects.toThrow(/sem contagem/);
    await inventory.recordCounts(op, inv.id, { items: [{ itemId: data!.items[0].id, countedQty: 37, notes: "3 chapas danificadas descartadas" }] });
    expect((await balanceOf(env, "CHP-004")).quantity).toBe(40);
    const sub = await inventory.submitInventory(op, inv.id);
    expect(sub.differences).toBe(1);
    expect((await balanceOf(env, "CHP-004")).quantity).toBe(40);
    await expect(inventory.approveInventory(op, inv.id, {})).rejects.toThrow(/permissão/);
    const approved = await inventory.approveInventory(sup, inv.id, { notes: "Conferido com o supervisor" });
    expect(approved.adjustments).toBe(1);
    expect((await balanceOf(env, "CHP-004")).quantity).toBe(37);
    const mov = await env.one<{ movement_type: string; quantity: number; reference_code: string }>(
      `select movement_type, quantity, reference_code from wms.stock_movements where reference_type = 'inventory'`,
    );
    expect(mov).toMatchObject({ movement_type: "adjustment_out", quantity: 3 });
    const open = await env.one<{ n: number }>(`select count(*) as n from wms.divergences where inventory_id = $1 and status = 'open'`, [inv.id]);
    expect(open.n).toBe(0);
    await expect(inventory.approveInventory(sup, inv.id, {})).rejects.toThrow(/não está aguardando aprovação/);
  });

  it("recusa aprovar quando o saldo mudou durante a contagem", async () => {
    const sup = env.as("supervisor");
    const productId = await env.product("LUB-002");
    const inv = await inventory.createInventory(sup, { warehouseId, countType: "cyclic", productId });
    const data = await inventory.getInventory(sup, inv.id);
    await inventory.recordCounts(sup, inv.id, { items: [{ itemId: data!.items[0].id, countedQty: 28 }] });
    await inventory.submitInventory(sup, inv.id);
    await adjustStock(sup, {
      locationId: data!.items[0].location_id,
      productId,
      lotCode: "L2026-01",
      direction: "in",
      quantity: 5,
      reason: "Entrada durante a contagem",
    });
    await expect(inventory.approveInventory(sup, inv.id, {})).rejects.toThrow(/mudou durante a contagem/);
    expect((await balanceOf(env, "LUB-002")).quantity).toBe(35);
    await inventory.rejectInventory(sup, inv.id, { notes: "Saldo alterado; recontar" });
    expect((await inventory.getInventory(sup, inv.id))!.status).toBe("counting");
  });

  it("permite incluir item encontrado fora do sistema", async () => {
    const sup = env.as("supervisor");
    const loc = await env.location("DEP-01/RUA-02/MOD-02/NIV-01/POS-00");
    const inv = await inventory.createInventory(sup, { warehouseId, countType: "cyclic", locationId: loc });
    await inventory.addInventoryItem(sup, inv.id, { locationId: loc, productId: await env.product("CIA-001"), countedQty: 4 });
    await inventory.submitInventory(sup, inv.id);
    await inventory.approveInventory(sup, inv.id, {});
    expect((await balanceOf(env, "CIA-001")).quantity).toBe(4);
  });
});
