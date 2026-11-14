import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, type TestEnv } from "./helpers";
import * as users from "@/server/services/users";
import * as tasks from "@/server/services/tasks";
import * as inventory from "@/server/services/inventory";
import * as outbound from "@/server/services/outbound";
import * as receiving from "@/server/services/receiving";
import { listStock, listMovements, adjustStock } from "@/server/services/stock";
import { listLocations, listWarehouses, createWarehouse, createZone, createLocation } from "@/server/services/warehouse";
import { loadSessionUser } from "@/server/auth/users";
import type { Ctx } from "@/server/context";

describe("Acesso por depósito", () => {
  let env: TestEnv;
  let dep1: string;
  let dep2: string;
  let restricted: Ctx;
  const ctxOf = async (id: string): Promise<Ctx> => ({ db: env.db, user: (await loadSessionUser(env.db, id))! });

  beforeAll(async () => {
    env = await createTestEnv();
    const admin = env.as("admin");
    dep1 = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    dep2 = (await createWarehouse(admin, { code: "DEP-02", name: "Filial Sul" })).id;
    const zone = await createZone(admin, { warehouseId: dep2, code: "ARM", name: "Armazenagem", zoneType: "storage" });
    await createLocation(admin, {
      zoneId: zone.id,
      aisle: "01",
      bay: "01",
      level: "01",
      position: "00",
      locationType: "rack",
      capacityUnits: 100,
    });
    // Saldo e tarefa no DEP-01 (seed já tem estoque; cria uma transferência pendente).
    await tasks.createTransfer(env.as("supervisor"), {
      fromLocationId: await env.location("DEP-01/RUA-02/MOD-01/NIV-01/POS-00"),
      productId: await env.product("LUB-002"),
      lotCode: "L2026-01",
      quantity: 1,
    });
    const operatorId = env.as("operator").user.id;
    await users.setUserWarehouses(admin, operatorId, { warehouseIds: [dep2] });
    restricted = await ctxOf(operatorId);
  });

  it("sem linhas o acesso é total (comportamento original)", async () => {
    const sup = env.as("supervisor");
    expect(sup.user.warehouseIds).toBeNull();
    expect((await listWarehouses(sup)).length).toBe(2);
    expect((await listStock(sup)).rows.length).toBeGreaterThan(0);
  });

  it("usuário restrito só vê os depósitos permitidos", async () => {
    expect(restricted.user.warehouseIds).toEqual([dep2]);
    expect((await listWarehouses(restricted)).map((w) => w.code)).toEqual(["DEP-02"]);
    expect((await listStock(restricted)).rows).toHaveLength(0);
    expect((await listMovements(restricted)).rows).toHaveLength(0);
    const locs = await listLocations(restricted, { pageSize: 100 });
    expect(locs.rows.length).toBe(1);
    expect(locs.rows.every((l) => l.warehouse_id === dep2)).toBe(true);
    const all = await tasks.listTasks(env.as("supervisor"), { pageSize: 100 });
    expect(all.rows.length).toBeGreaterThan(0);
    expect((await tasks.listTasks(restricted, { pageSize: 100 })).rows).toHaveLength(0);
    expect(await tasks.getTask(restricted, all.rows[0].id)).toBeNull();
    expect(await receiving.listReceipts(restricted)).toHaveLength(0);
    expect(await outbound.listOrders(restricted)).toHaveLength(0);
    expect(await inventory.listInventories(restricted)).toHaveLength(0);
  });

  it("usuário restrito não opera depósito não permitido", async () => {
    const pending = (await tasks.listTasks(env.as("supervisor"), { status: "pending", pageSize: 100 })).rows[0];
    await expect(tasks.startTask(restricted, pending.id)).rejects.toThrow(/acesso a este depósito/);
    await expect(
      tasks.createTransfer(restricted, {
        fromLocationId: await env.location("DEP-01/RUA-02/MOD-01/NIV-01/POS-00"),
        productId: await env.product("LUB-002"),
        lotCode: "L2026-01",
        quantity: 1,
      }),
    ).rejects.toThrow(/acesso a este depósito/);
    const supplier = await env.id(`select id from erp.suppliers limit 1`);
    await expect(
      receiving.createManualReceipt(restricted, { warehouseId: dep1, supplierId: supplier, items: [{ productId: await env.product("LUB-002"), expectedQty: 1 }] }),
    ).rejects.toThrow(/acesso a este depósito/);
    // Supervisor restrito ao DEP-02 não abre inventário nem ajusta estoque no DEP-01.
    const supId = env.as("supervisor").user.id;
    await users.setUserWarehouses(env.as("admin"), supId, { warehouseIds: [dep2] });
    const sup = await ctxOf(supId);
    await expect(inventory.createInventory(sup, { warehouseId: dep1, countType: "general" })).rejects.toThrow(/acesso a este depósito/);
    await expect(
      adjustStock(sup, {
        locationId: await env.location("DEP-01/RUA-02/MOD-01/NIV-01/POS-00"),
        productId: await env.product("LUB-002"),
        lotCode: "L2026-01",
        direction: "out",
        quantity: 1,
        reason: "Teste de acesso por depósito",
      }),
    ).rejects.toThrow(/acesso a este depósito/);
    await expect(outbound.createManualOrder(sup, { warehouseId: dep1, customerName: "Cliente", lines: [{ productId: await env.product("LUB-002"), quantity: 1 }] })).rejects.toThrow(
      /acesso a este depósito/,
    );
    // Lista vazia devolve o acesso a todos.
    await users.setUserWarehouses(env.as("admin"), supId, { warehouseIds: [] });
    const freed = await ctxOf(supId);
    expect(freed.user.warehouseIds).toBeNull();
    const inv = await inventory.createInventory(freed, { warehouseId: dep1, countType: "general" });
    expect(await inventory.getInventory(restricted, inv.id)).toBeNull();
    expect(await inventory.getInventory(freed, inv.id)).not.toBeNull();
  });

  it("o banco impede vincular usuário a depósito de outra empresa", async () => {
    const other = await env.id(`insert into erp.companies (name) values ('Outra Empresa') returning id`);
    const foreignWh = await env.id(`insert into wms.warehouses (company_id, code, name) values ($1, 'X-01', 'Outro') returning id`, [other]);
    const operatorId = env.as("operator").user.id;
    await expect(
      env.db.query(`insert into wms.user_warehouses (user_id, warehouse_id, company_id) values ($1, $2, $3)`, [operatorId, foreignWh, other]),
    ).rejects.toThrow();
    const company = env.as("admin").user.companyId;
    await expect(
      env.db.query(`insert into wms.user_warehouses (user_id, warehouse_id, company_id) values ($1, $2, $3)`, [operatorId, foreignWh, company]),
    ).rejects.toThrow();
    await expect(users.setUserWarehouses(env.as("admin"), operatorId, { warehouseIds: [foreignWh] })).rejects.toThrow(/Depósito/);
  });

  it("alteração de depósitos é auditada", async () => {
    const rows = await env.db.query(`select 1 from wms.audit_log where action = 'user.warehouses_updated'`);
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });
});
