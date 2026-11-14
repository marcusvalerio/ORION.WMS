import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, type TestEnv } from "./helpers";
import * as erp from "@/server/integrations/erp/gateway";
import * as outbound from "@/server/services/outbound";
import * as labels from "@/server/services/labels";

describe("Etiquetas", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv();
  });

  it("endereços por zona, rua e lista de ids", async () => {
    const ctx = env.as("operator");
    const zoneId = await env.id(`select id from wms.zones where code = 'ARM'`);
    const byZone = await labels.listLocationLabels(ctx, { zoneId });
    expect(byZone.rows).toHaveLength(10);
    expect(byZone.truncated).toBe(false);
    const byAisle = await labels.listLocationLabels(ctx, { aisle: "02" });
    expect(byAisle.rows.every((r) => r.aisle === "02")).toBe(true);
    expect(byAisle.rows).toHaveLength(4);
    const id = await env.location("DEP-01/RUA-04/MOD-01/NIV-00/POS-00");
    const one = await labels.listLocationLabels(ctx, { ids: [id] });
    expect(one.rows.map((r) => r.code)).toEqual(["DEP-01/RUA-04/MOD-01/NIV-00/POS-00"]);
    expect(labels.levelArrow("00")).toBe("down");
    expect(labels.levelArrow("02")).toBe("up");
    expect(await labels.listAisles(ctx)).toContain("EX");
  });

  it("produto com embalagens e volumes do pedido de saída", async () => {
    const ctx = env.as("operator");
    const p = await labels.getProductLabel(ctx, await env.product("CIA-001"));
    expect(p!.barcode).toBe("7890000000017");
    expect(p!.packaging.map((x) => x.code)).toEqual(["CX10", "PLT200"]);

    const sup = env.as("supervisor");
    const so = (await erp.listSalesOrders(env.db, sup.user.companyId)).find((s) => s.number === "PV-1001")!;
    const warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    const o = await outbound.importSalesOrder(sup, { salesOrderId: so.id, warehouseId });
    const r = await labels.getShippingLabels(ctx, o.id, 3);
    expect(r!.order.customer_name).toMatch(/Horizonte/);
    // A doca é definida na liberação para separação; antes disso a etiqueta mostra "a definir".
    expect(r!.order.staging_code).toBeNull();
    expect(r!.labels.map((l) => `${l.index}/${l.total}`)).toEqual(["1/3", "2/3", "3/3"]);
    expect(r!.labels[2].barcode).toMatch(/-003$/);
    await expect(labels.getShippingLabels(ctx, o.id, 0)).rejects.toThrow(/volumes/);
    await expect(labels.getShippingLabels(ctx, o.id, 1.5)).rejects.toThrow(/volumes/);
  });
});
