import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, type TestEnv } from "./helpers";
import * as outbound from "@/server/services/outbound";
import { adjustStock } from "@/server/services/stock";
import { loadText, suggestLocations } from "@/server/services/stock-core";
import { updateSettings } from "@/server/services/settings";

describe("Regras de operação da banca (etapa 2)", () => {
  let env: TestEnv;
  let warehouseId: string;

  beforeAll(async () => {
    env = await createTestEnv();
    warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
  });

  it("R2: a reserva FEFO ignora lotes abaixo da validade mínima e explica o motivo", async () => {
    const sup = env.as("supervisor");
    const adm = env.as("admin");
    const productId = await env.id(`insert into erp.products (company_id, sku, description) values ($1, 'VAL-900', 'Produto com validade') returning id`, [
      adm.user.companyId,
    ]);
    const loc = await env.location("DEP-01/RUA-02/MOD-02/NIV-01/POS-00");
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await env.db.query(
      `insert into wms.product_settings (product_id, company_id, lot_controlled, expiry_controlled) values ($1, $2, true, true)
       on conflict (product_id) do update set lot_controlled = true, expiry_controlled = true`,
      [productId, adm.user.companyId],
    );
    await adjustStock(adm, { locationId: loc, productId, lotCode: "VENCE10", expiryDate: soon, direction: "in", quantity: 5, reason: "Lote curto" });
    await updateSettings(adm, { "inventory.segregation_of_duties": "on", "quality.required_for_output": "on", "outbound.min_shelf_life_days": "30" });
    const order = await outbound.createManualOrder(sup, { warehouseId, customerName: "Cliente Validade", lines: [{ productId, quantity: 5 }] });
    await expect(outbound.reserveOrder(sup, order.id)).rejects.toThrow(/abaixo do mínimo/);
    // produto com mínimo próprio menor prevalece sobre o padrão da empresa
    await env.db.query(`update wms.product_settings set min_shelf_life_days = 5 where product_id = $1`, [productId]);
    const r = await outbound.reserveOrder(sup, order.id);
    expect(r.reservations).toBeGreaterThan(0);
    await updateSettings(adm, { "inventory.segregation_of_duties": "on", "quality.required_for_output": "on", "outbound.min_shelf_life_days": "0" });
  });

  it("R4: o endereço recusa a entrada que estoura o volume e mostra a carga", async () => {
    const sup = env.as("supervisor");
    const productId = await env.product("CIA-001");
    await env.db.query(`update erp.products set length_cm = 50, width_cm = 50, height_cm = 40 where id = $1`, [productId]); // 0,1 m³
    await env.db.query(`update wms.locations set max_volume_m3 = 0.25 where warehouse_id = $1`, [warehouseId]);
    await env.db.transaction(async (tx) => {
      const s = await suggestLocations(tx, sup, { warehouseId, productId, lotCode: "", quantity: 3 });
      expect(s.best).toBeNull();
      expect(s.candidates).toHaveLength(0);
      const ok = await suggestLocations(tx, sup, { warehouseId, productId, lotCode: "", quantity: 2 });
      expect(ok.best).not.toBeNull();
      expect(ok.candidates[0].load).toMatch(/de 0,25 m³/);
    });
    expect(loadText({ max_volume_m3: 1.2, max_weight_kg: 1000, occupied_volume: 0.9, occupied_weight: 620 }, { volume_m3: 0.1, weight_kg: 100 }, 2)).toBe(
      "1,10 de 1,20 m³ · 820 de 1.000 kg",
    );
    await env.db.query(`update wms.locations set max_volume_m3 = null where warehouse_id = $1`, [warehouseId]);
  });
});
