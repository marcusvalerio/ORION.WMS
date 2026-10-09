import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, type TestEnv } from "./helpers";
import * as wh from "@/server/services/warehouse";
import { adjustStock } from "@/server/services/stock";
import { suggestLocations } from "@/server/services/stock-core";

describe("Estrutura física", () => {
  let env: TestEnv;
  let zoneId: string;
  let warehouseId: string;

  beforeAll(async () => {
    env = await createTestEnv();
    zoneId = await env.id(`select id from wms.zones where code = 'ARM'`);
    warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
  });

  it("cria e consulta um endereço com código legível", async () => {
    const sup = env.as("supervisor");
    const created = await wh.createLocation(sup, {
      zoneId,
      aisle: "5",
      bay: "1",
      level: "3",
      position: "0",
      locationType: "rack",
      capacityUnits: 120,
    });
    expect(created.code).toBe("DEP-01/RUA-05/MOD-01/NIV-03/POS-00");
    const { rows } = await wh.listLocations(sup, { q: "RUA-05" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ capacity_units: 120, status: "active", occupied: 0 });
    await expect(wh.createLocation(sup, { zoneId, aisle: "05", bay: "01", level: "03", position: "00", locationType: "rack", capacityUnits: 1 })).rejects.toThrow(
      /Já existe/,
    );
    await expect(wh.createLocation(env.as("operator"), { zoneId, aisle: "9", bay: "1", level: "1", position: "0", locationType: "rack", capacityUnits: 1 })).rejects.toThrow(
      /permissão/,
    );
  });

  it("gera endereços em lote sem duplicar", async () => {
    const sup = env.as("supervisor");
    const input = { zoneId, aisle: "06", bayFrom: 1, bayTo: 2, levelFrom: 1, levelTo: 3, positions: 1, locationType: "rack", capacityUnits: 100 };
    expect(await wh.generateLocations(sup, input)).toEqual({ created: 6, skipped: 0 });
    expect(await wh.generateLocations(sup, input)).toEqual({ created: 0, skipped: 6 });
  });

  it("não exclui nem inativa endereço com estoque/histórico; exclui endereço sem uso", async () => {
    const sup = env.as("supervisor");
    const used = await env.location("DEP-01/RUA-02/MOD-01/NIV-01/POS-00");
    await expect(wh.deleteLocation(sup, used)).rejects.toThrow(/não pode ser excluído/);
    await expect(wh.setLocationStatus(sup, used, { status: "inactive", reason: "Reforma" })).rejects.toThrow(/com estoque/);
    await expect(wh.updateLocation(sup, used, { locationType: "shelf", capacityUnits: 10 })).rejects.toThrow(/menor que a ocupação/);
    const free = await env.location("DEP-01/RUA-05/MOD-01/NIV-03/POS-00");
    await wh.deleteLocation(sup, free);
    expect((await wh.listLocations(sup, { q: "RUA-05" })).total).toBe(0);
  });

  it("endereço bloqueado não é sugerido nem aceita armazenagem; sem posição elegível informa o motivo", async () => {
    const sup = env.as("supervisor");
    const productId = await env.product("ADE-003"); // refrigerado
    for (const code of ["DEP-01/RUA-03/MOD-01/NIV-01/POS-00", "DEP-01/RUA-03/MOD-02/NIV-01/POS-00"]) {
      await wh.setLocationStatus(sup, await env.location(code), { status: "blocked", reason: "Manutenção da câmara" });
    }
    const s = await suggestLocations(env.db, sup, { warehouseId, productId, lotCode: "", quantity: 10 });
    expect(s.best).toBeNull();
    expect(s.reason).toMatch(/classe de armazenagem "refrigerated"/);
    const big = await suggestLocations(env.db, sup, { warehouseId, productId: await env.product("CIA-001"), lotCode: "", quantity: 100000 });
    expect(big.best).toBeNull();
    expect(big.reason).toMatch(/capacidade/);
  });

  it("consolida no endereço que já contém o mesmo produto", async () => {
    const sup = env.as("supervisor");
    const productId = await env.product("CIA-001");
    const target = await env.location("DEP-01/RUA-01/MOD-03/NIV-02/POS-00");
    await adjustStock(sup, { locationId: target, productId, direction: "in", quantity: 10, reason: "Saldo para consolidação" });
    const s = await suggestLocations(env.db, sup, { warehouseId, productId, lotCode: "", quantity: 20 });
    expect(s.best?.id).toBe(target);
  });
});
