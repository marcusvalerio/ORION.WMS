import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, key, type TestEnv } from "./helpers";
import { seedCdOperations, seedInventoryShowcase } from "@/server/seed/showcase";
import * as nfe from "@/server/services/nfe";
import * as receiving from "@/server/services/receiving";
import * as outbound from "@/server/services/outbound";
import * as tasks from "@/server/services/tasks";
import * as waves from "@/server/services/waves";

const SAMPLE = readFileSync(path.join(process.cwd(), "docs/exemplos/nfe-pc-4588-entrega-1.xml"), "utf8");

describe("CD-02 operável (vitrine de demonstração)", () => {
  let env: TestEnv;
  let wh: string;
  beforeAll(async () => {
    env = await createTestEnv();
    await seedInventoryShowcase(env.db);
    wh = await env.id(`select id from wms.warehouses where code = 'CD-02'`);
  }, 180_000);

  const structure = () =>
    env.one<{ zones: number; locations: number; docks: number }>(
      `select (select count(*)::int from wms.zones where warehouse_id = $1) as zones,
              (select count(*)::int from wms.locations where warehouse_id = $1) as locations,
              (select count(*)::int from wms.docks where warehouse_id = $1) as docks`,
      [wh],
    );

  it("tem doca de recebimento, doca de expedição e endereços refrigerados; reexecutar não duplica", async () => {
    const zones = await env.db.query<{ code: string; zone_type: string }>(`select code, zone_type from wms.zones where warehouse_id = $1 order by code`, [wh]);
    expect(zones.map((z) => z.zone_type)).toEqual(expect.arrayContaining(["receiving", "shipping", "storage", "picking"]));
    const cold = await env.one<{ n: number }>(
      `select count(*)::int as n from wms.locations l join wms.zones z on z.id = l.zone_id
       where l.warehouse_id = $1 and l.storage_class = 'refrigerated' and z.zone_type = 'storage' and l.status = 'active'`,
      [wh],
    );
    expect(cold.n).toBeGreaterThan(0);
    expect((await waves.listDocks(env.as("supervisor"))).some((d) => d.warehouse_id === wh)).toBe(true);
    const before = await structure();
    expect(before.docks).toBeGreaterThanOrEqual(2);
    await seedCdOperations(env.db);
    await seedInventoryShowcase(env.db);
    expect(await structure()).toEqual(before);
  });

  it("pedido de saída + onda no CD-02 usam a doca do próprio depósito", async () => {
    const sup = env.as("supervisor");
    const productId = await env.product("ROL-102");
    const o = await outbound.createManualOrder(sup, {
      warehouseId: wh,
      customerName: "Cliente CD Leste",
      priority: 2,
      lines: [{ productId, quantity: 5 }],
    });
    await outbound.reserveOrder(sup, o.id);
    const w = await waves.createWave(sup, {
      warehouseId: wh,
      grouping: "manual",
      orderIds: [o.id],
    });
    const rel = await waves.releaseWave(sup, w.id);
    expect(rel.tasks.length).toBeGreaterThan(0);
    const wave = (await waves.getWave(sup, w.id))!;
    expect(wave.status).toBe("released");
    expect(wave.dock_code).toMatch(/^CD-02\//);
  });

  it("NF-e de exemplo recebida no CD-02 chega à armazenagem, inclusive o item refrigerado", async () => {
    const op = env.as("operator");
    const sup = env.as("supervisor");
    const { id } = await nfe.importNfe(op, { xml: SAMPLE }, { idempotencyKey: key() });
    const n = (await nfe.getNfe(op, id))!;
    for (const i of n.items.filter((x) => !x.product_id))
      await nfe.linkNfeItem(op, i.id, {
        productId: await env.product("ADE-003"),
      });
    const r = await nfe.createReceiptFromNfe(op, id, { warehouseId: wh }, { idempotencyKey: key() });
    await receiving.startCheck(op, r.id);
    const rec = (await receiving.getReceipt(op, r.id))!;
    await receiving.saveCounts(op, r.id, {
      items: rec.items.map((i) => ({
        itemId: i.id,
        countedQty: i.expected_qty,
        lotCode: i.lot_code,
        expiryDate: i.expiry_date,
        damagedQty: 0,
      })),
    });
    await receiving.finishCheck(op, r.id, {});
    await receiving.releaseReceipt(sup, r.id);
    const pending = await env.db.query<{ id: string }>(`select id from wms.tasks where receipt_id = $1 and task_type = 'putaway' and status = 'pending'`, [
      r.id,
    ]);
    expect(pending.length).toBeGreaterThan(0);
    for (const t of pending) await tasks.completeTask(op, t.id, {});
    const stored = await env.db.query<{
      sku: string;
      storage_class: string | null;
      warehouse_id: string;
    }>(
      `select p.sku, l.storage_class, l.warehouse_id from wms.tasks t join erp.products p on p.id = t.product_id
       join wms.locations l on l.id = t.to_location_id where t.receipt_id = $1 and t.task_type = 'putaway'`,
      [r.id],
    );
    expect(stored.every((s) => s.warehouse_id === wh)).toBe(true);
    expect(stored.filter((s) => s.sku === "ADE-003").every((s) => s.storage_class === "refrigerated")).toBe(true);
    expect((await env.one<{ n: number }>(`select count(*)::int as n from wms.tasks where receipt_id = $1 and status <> 'completed'`, [r.id])).n).toBe(0);
  });
});
