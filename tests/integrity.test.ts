import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, balanceOf, key, type TestEnv } from "./helpers";
import * as tasks from "@/server/services/tasks";
import * as outbound from "@/server/services/outbound";
import { adjustStock, blockStock, unblockStock, listStock } from "@/server/services/stock";
import { runOperation, nextCode } from "@/server/services/common";
import { addStock } from "@/server/services/stock-core";

describe("Integridade do estoque", () => {
  let env: TestEnv;
  let productA: string;
  let loc1: string;
  let loc2: string;
  let warehouseId: string;

  beforeAll(async () => {
    env = await createTestEnv();
    productA = await env.product("CIA-001");
    loc1 = await env.location("DEP-01/RUA-01/MOD-01/NIV-01/POS-00");
    loc2 = await env.location("DEP-01/RUA-01/MOD-02/NIV-01/POS-00");
    warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    await adjustStock(env.as("supervisor"), { locationId: loc1, productId: productA, direction: "in", quantity: 100, reason: "Saldo para testes de integridade" });
  });

  it("o banco impede saldo negativo e reserva acima do físico", async () => {
    await expect(
      env.db.query(`update wms.stock_balances set quantity = -1 where location_id = $1`, [loc1]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      env.db.query(`update wms.stock_balances set reserved_qty = quantity + 1 where location_id = $1`, [loc1]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("movimentações e auditoria são imutáveis", async () => {
    await expect(env.db.query(`update wms.stock_movements set quantity = 1`)).rejects.toThrow(/imutável/);
    await expect(env.db.query(`delete from wms.audit_log`)).rejects.toThrow(/imutável/);
  });

  it("ajuste manual exige permissão específica e justificativa", async () => {
    const base = { locationId: loc1, productId: productA, direction: "out", quantity: 1 };
    await expect(adjustStock(env.as("operator"), { ...base, reason: "Quebra identificada na contagem" })).rejects.toThrow(/permissão/);
    await expect(adjustStock(env.as("supervisor"), { ...base, reason: "curto" })).rejects.toThrow(/Justificativa/);
    await expect(adjustStock(env.as("supervisor"), { ...base, quantity: 101, reason: "Ajuste maior que o saldo" })).rejects.toThrow(/maior que o disponível/);
  });

  it("transfere de forma transacional sem duplicar nem perder saldo", async () => {
    const op = env.as("operator");
    const t = await tasks.createTransfer(op, { fromLocationId: loc1, productId: productA, quantity: 40, toLocationId: loc2 });
    await tasks.completeTask(op, t.id, {});
    const { rows } = await listStock(op, { productId: productA });
    const byLoc = Object.fromEntries(rows.map((r) => [r.location_id, r.quantity]));
    expect(byLoc[loc1]).toBe(60);
    expect(byLoc[loc2]).toBe(40);
    expect((await balanceOf(env, "CIA-001")).quantity).toBe(100);
  });

  it("impede dupla conclusão de tarefa e execução de tarefa cancelada", async () => {
    const op = env.as("operator");
    const t = await tasks.createTransfer(op, { fromLocationId: loc2, productId: productA, quantity: 5, toLocationId: loc1 });
    await tasks.completeTask(op, t.id, {});
    await expect(tasks.completeTask(op, t.id, {})).rejects.toThrow(/já foi concluída/);
    await expect(tasks.startTask(op, t.id)).rejects.toThrow(/já foi concluída/);
    const t2 = await tasks.createTransfer(op, { fromLocationId: loc2, productId: productA, quantity: 5, toLocationId: loc1 });
    await expect(tasks.cancelTask(op, t2.id, { reason: "Não é mais necessária" })).rejects.toThrow(/permissão/);
    await tasks.cancelTask(env.as("supervisor"), t2.id, { reason: "Não é mais necessária" });
    await expect(tasks.completeTask(op, t2.id, {})).rejects.toThrow(/cancelada/);
    expect((await balanceOf(env, "CIA-001")).quantity).toBe(100);
  });

  it("não transfere saldo reservado ou bloqueado (movimentação incompatível)", async () => {
    const sup = env.as("supervisor");
    const balanceId = await env.id(`select id from wms.stock_balances where location_id = $1 and product_id = $2`, [loc2, productA]);
    await blockStock(sup, balanceId, { quantity: 30, reason: "Avaria em inspeção" });
    await expect(
      tasks.createTransfer(env.as("operator"), { fromLocationId: loc2, productId: productA, quantity: 10, toLocationId: loc1 }),
    ).rejects.toThrow(/disponível insuficiente: disponível 5/);
    await expect(blockStock(sup, balanceId, { quantity: 6, reason: "Teste de bloqueio" })).rejects.toThrow(/disponível/);
    await unblockStock(sup, balanceId, { quantity: 30, reason: "Inspeção concluída" });
    expect((await balanceOf(env, "CIA-001")).blocked).toBe(0);
  });

  it("revalida o saldo na conclusão (concorrência entre tarefa criada e reserva)", async () => {
    const op = env.as("operator");
    const sup = env.as("supervisor");
    // loc2 tem 35. Cria transferência de 35 e, antes de executá-la, um pedido reserva 30 do mesmo saldo.
    const t = await tasks.createTransfer(op, { fromLocationId: loc2, productId: productA, quantity: 35, toLocationId: loc1 });
    const o = await outbound.createManualOrder(sup, { warehouseId, customerName: "Concorrente", lines: [{ productId: productA, quantity: 95 }] });
    await outbound.reserveOrder(sup, o.id);
    await expect(tasks.completeTask(op, t.id, {})).rejects.toThrow(/disponível insuficiente/);
    const task = await tasks.getTask(op, t.id);
    expect(task!.status).toBe("pending");
    await outbound.cancelOrder(sup, o.id, { reason: "Teste concluído" });
  });

  it("reservas concorrentes nunca ultrapassam o disponível", async () => {
    const sup = env.as("supervisor");
    const orders = await Promise.all(
      [1, 2, 3].map((i) => outbound.createManualOrder(sup, { warehouseId, customerName: `Paralelo ${i}`, lines: [{ productId: productA, quantity: 40 }] })),
    );
    const results = await Promise.allSettled(orders.map((o) => outbound.reserveOrder(sup, o.id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const b = await balanceOf(env, "CIA-001");
    expect(b.reserved).toBe(80);
    expect(b.reserved).toBeLessThanOrEqual(b.quantity);
    for (const o of orders) await outbound.cancelOrder(sup, o.id, { reason: "Limpeza do teste" }).catch(() => undefined);
  });

  it("requisições repetidas com a mesma chave executam uma única vez", async () => {
    const op = env.as("operator");
    const k = key();
    const [a, b] = await Promise.all([
      tasks.createTransfer(op, { fromLocationId: loc1, productId: productA, quantity: 1, toLocationId: loc2, executeNow: true }, { idempotencyKey: k }),
      tasks.createTransfer(op, { fromLocationId: loc1, productId: productA, quantity: 1, toLocationId: loc2, executeNow: true }, { idempotencyKey: k }),
    ]);
    expect(a).toEqual(b);
    const n = await env.one<{ n: number }>(`select count(*) as n from wms.tasks where task_type = 'transfer' and quantity = 1`);
    expect(n.n).toBe(1);
  });

  it("faz rollback completo quando uma operação crítica falha no meio", async () => {
    const before = await balanceOf(env, "CIA-001");
    const movementsBefore = await env.one<{ n: number }>(`select count(*) as n from wms.stock_movements`);
    const ctx = env.as("admin");
    await expect(
      runOperation(ctx, "test.rollback", { idempotencyKey: "rollback-key" }, async (tx) => {
        await nextCode(tx, ctx.user.companyId, "TAR");
        await addStock(tx, ctx, { warehouseId, locationId: loc1, productId: productA, lotCode: "", expiryDate: null, quantity: 999 });
        throw new Error("falha simulada");
      }),
    ).rejects.toThrow("falha simulada");
    expect(await balanceOf(env, "CIA-001")).toEqual(before);
    expect(await env.one<{ n: number }>(`select count(*) as n from wms.stock_movements`)).toEqual(movementsBefore);
    const k = await env.db.query(`select 1 from wms.idempotency_keys where key = 'rollback-key'`);
    expect(k).toHaveLength(0);
  });
});
