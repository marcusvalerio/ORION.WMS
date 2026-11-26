import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, type TestEnv } from "./helpers";
import * as inventory from "@/server/services/inventory";
import * as outbound from "@/server/services/outbound";
import * as tasks from "@/server/services/tasks";
import { adjustStock } from "@/server/services/stock";
import { getSetting, listSettings, updateSettings } from "@/server/services/settings";
import { productivityByUser, fmtDuration } from "@/server/services/productivity";
import { buildReport, toCsv } from "@/server/services/reports";

describe("Segregação de funções no inventário e configurações do WMS", () => {
  let env: TestEnv;
  let warehouseId: string;

  beforeAll(async () => {
    env = await createTestEnv();
    warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
  });

  async function countedBy(role: "supervisor" | "operator") {
    const sup = env.as("supervisor");
    const inv = await inventory.createInventory(sup, { warehouseId, countType: "cyclic", productId: await env.product("CHP-004") });
    const data = await inventory.getInventory(sup, inv.id);
    await inventory.recordCounts(env.as(role), inv.id, { items: [{ itemId: data!.items[0].id, countedQty: 40 }] });
    await inventory.submitInventory(env.as(role), inv.id);
    return inv.id;
  }

  it("parâmetro ligado por padrão", async () => {
    const company = env.as("admin").user.companyId;
    expect(await getSetting(env.db, company, "inventory.segregation_of_duties")).toBe(true);
    const list = await listSettings(env.as("admin"));
    expect(list.find((s) => s.key === "inventory.segregation_of_duties")).toMatchObject({ value: true, customized: false });
  });

  it("quem contou não aprova o mesmo inventário; outro aprovador sim", async () => {
    const id = await countedBy("supervisor");
    await expect(inventory.approveInventory(env.as("supervisor"), id, {})).rejects.toThrow(/Segregação de funções.*não pode aprová-lo/);
    const r = await inventory.approveInventory(env.as("admin"), id, {});
    expect(r.adjustments).toBe(0);
    // Contado pelo operador: supervisor aprova normalmente.
    const id2 = await countedBy("operator");
    await inventory.approveInventory(env.as("supervisor"), id2, {});
  });

  it("vale também para quem contou numa rodada anterior (recontagem)", async () => {
    const sup = env.as("supervisor");
    const id = await countedBy("supervisor");
    await inventory.rejectInventory(sup, id, { notes: "Recontar o endereço" });
    const data = await inventory.getInventory(sup, id);
    await inventory.recordCounts(env.as("operator"), id, { items: [{ itemId: data!.items[0].id, countedQty: 40 }] });
    await inventory.submitInventory(env.as("operator"), id);
    await expect(inventory.approveInventory(sup, id, {})).rejects.toThrow(/Segregação de funções/);
    await inventory.approveInventory(env.as("admin"), id, {});
  });

  it("somente o administrador altera o parâmetro; desligado, quem contou pode aprovar; alteração auditada", async () => {
    await expect(updateSettings(env.as("supervisor"), {})).rejects.toThrow(/permissão/);
    await expect(updateSettings(env.as("admin"), { "nao.existe": "on" })).rejects.toThrow(/desconhecido/);
    const keep = { "quality.required_for_output": "on" };
    expect((await updateSettings(env.as("admin"), keep)).changed).toBe(1); // checkbox ausente = desligado
    expect((await updateSettings(env.as("admin"), keep)).changed).toBe(0);
    const id = await countedBy("supervisor");
    await inventory.approveInventory(env.as("supervisor"), id, {});
    const log = await env.one<{ details: Record<string, unknown> }>(
      `select details from wms.audit_log where action = 'settings.updated' order by created_at desc limit 1`,
    );
    expect(log.details["inventory.segregation_of_duties"]).toEqual({ from: true, to: false });
    await updateSettings(env.as("admin"), { "inventory.segregation_of_duties": "on" });
    expect(await getSetting(env.db, env.as("admin").user.companyId, "inventory.segregation_of_duties")).toBe(true);
  });
});

describe("Produtividade por operador", () => {
  let env: TestEnv;
  let warehouseId: string;
  let productA: string;
  let countedLines = 0;

  beforeAll(async () => {
    env = await createTestEnv();
    warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    productA = await env.product("CIA-001");
    await adjustStock(env.as("admin"), {
      locationId: await env.location("DEP-01/RUA-01/MOD-01/NIV-01/POS-00"),
      productId: productA,
      direction: "in",
      quantity: 50,
      reason: "Saldo inicial para teste de produtividade",
    });
    const sup = env.as("supervisor");
    const op = env.as("operator");
    for (const [qty, picked] of [
      [10, 10],
      [10, 8],
    ]) {
      const order = await outbound.createManualOrder(sup, { warehouseId, customerName: "Cliente", lines: [{ productId: productA, quantity: qty }] });
      await outbound.reserveOrder(sup, order.id);
      await outbound.releaseForPicking(sup, order.id);
      const pick = (await tasks.listTasks(sup, { type: "picking", pageSize: 100 })).rows.find((t) => t.order_id === order.id)!;
      await tasks.startTask(op, pick.id);
      await tasks.completeTask(op, pick.id, { quantity: picked, notes: picked < qty ? "Faltou" : null });
    }
    // Contagem de inventário pelo operador (linhas conferidas).
    const inv = await inventory.createInventory(sup, { warehouseId, countType: "general" });
    const items = await env.db.query<{ id: string; expected_qty: number }>(`select id, expected_qty from wms.inventory_count_items where inventory_id = $1`, [
      inv.id,
    ]);
    countedLines = items.length;
    await inventory.recordCounts(op, inv.id, { items: items.map((i) => ({ itemId: i.id, countedQty: Number(i.expected_qty) })) });
  });

  it("calcula tarefas por tipo, unidades, itens separados, linhas conferidas, tempo médio e acuracidade", async () => {
    const { rows, period } = await productivityByUser(env.as("supervisor"));
    expect(period.from <= period.to).toBe(true);
    const op = rows.find((r) => r.user_id === env.as("operator").user.id)!;
    expect(op.tasks_by_type.picking).toBe(2);
    expect(op.tasks_total).toBe(2);
    expect(op.units_picked).toBe(18);
    expect(op.units_moved).toBe(18); // movimentações de separação feitas pelo operador
    expect(op.picks_total).toBe(2);
    expect(op.picks_accurate).toBe(1);
    expect(op.accuracy).toBe(0.5);
    expect(countedLines).toBeGreaterThan(0);
    expect(op.lines_checked).toBe(countedLines);
    expect(op.avg_task_seconds).not.toBeNull();
    expect(op.avg_task_seconds!).toBeGreaterThanOrEqual(0);
    // O administrador fez só ajustes (não contam como unidades movimentadas) e não aparece.
    expect(rows.find((r) => r.user_id === env.as("admin").user.id)).toBeUndefined();
  });

  it("respeita período, depósito, permissão e acesso por depósito", async () => {
    await expect(productivityByUser(env.as("operator"))).rejects.toThrow(/permissão/);
    expect((await productivityByUser(env.as("auditor"), { from: "2020-01-01", to: "2020-01-31" })).rows).toHaveLength(0);
    await expect(productivityByUser(env.as("auditor"), { from: "2026-12-31", to: "2026-01-01" })).rejects.toThrow(/anterior/);
    const other = await env.id(`insert into wms.warehouses (company_id, code, name) values ($1, 'DEP-09', 'Vazio') returning id`, [
      env.as("admin").user.companyId,
    ]);
    expect((await productivityByUser(env.as("auditor"), { warehouseId: other })).rows).toHaveLength(0);
    const restricted = { ...env.as("auditor"), user: { ...env.as("auditor").user, warehouseIds: [other] } };
    expect((await productivityByUser(restricted)).rows).toHaveLength(0);
  });

  it("exporta CSV no padrão dos relatórios", async () => {
    const table = await buildReport(env.as("auditor"), "produtividade", new URLSearchParams());
    expect(table.headers).toContain("Acuracidade de separação (%)");
    const csv = toCsv(table);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Operador");
    expect(csv).toContain(";50;");
    await expect(buildReport(env.as("operator"), "produtividade", new URLSearchParams())).rejects.toThrow(/permissão/);
  });

  it("formata a duração", () => {
    expect(fmtDuration(null)).toBe("—");
    expect(fmtDuration(42)).toBe("42 s");
    expect(fmtDuration(600)).toBe("10 min");
    expect(fmtDuration(3900)).toBe("1 h 05 min");
  });
});
