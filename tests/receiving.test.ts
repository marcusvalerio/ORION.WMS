import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, balanceOf, key, type TestEnv } from "./helpers";
import * as receiving from "@/server/services/receiving";
import * as tasks from "@/server/services/tasks";
import { listDivergences, resolveDivergence } from "@/server/services/divergences";
import { DomainError } from "@/server/errors";

/** Cenário com divergência: PC-4588 (60 Lubrificante B + 40 Adesivo C refrigerado). */
describe("Recebimento com divergência", () => {
  let env: TestEnv;
  let receiptId: string;
  let warehouseId: string;
  let poId: string;

  beforeAll(async () => {
    env = await createTestEnv();
    warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    poId = await env.id(`select id from erp.purchase_orders where number = 'PC-4588'`);
  });

  it("não duplica o recebimento ao reenviar a mesma requisição (idempotência)", async () => {
    const sup = env.as("supervisor");
    const k = key();
    const first = await receiving.createReceiptFromPurchaseOrder(sup, { purchaseOrderId: poId, warehouseId }, { idempotencyKey: k });
    const again = await receiving.createReceiptFromPurchaseOrder(sup, { purchaseOrderId: poId, warehouseId }, { idempotencyKey: k });
    expect(again).toEqual(first);
    receiptId = first.id;
    const n = await env.one<{ n: number }>(`select count(*) as n from wms.receipts where purchase_order_id = $1`, [poId]);
    expect(n.n).toBe(1);
  });

  it("bloqueia um segundo recebimento ativo para o mesmo pedido (nova requisição)", async () => {
    await expect(
      receiving.createReceiptFromPurchaseOrder(env.as("supervisor"), { purchaseOrderId: poId, warehouseId }, { idempotencyKey: key() }),
    ).rejects.toThrow(/já possui o recebimento/);
  });

  it("não conclui a conferência sem quantidades, lote e validade obrigatórios", async () => {
    const op = env.as("operator");
    await expect(receiving.finishCheck(op, receiptId, {})).rejects.toThrow(/status "expected"/);
    await receiving.startCheck(op, receiptId);
    await expect(receiving.finishCheck(op, receiptId, {})).rejects.toThrow(/sem quantidade conferida/);
    const rec = await receiving.getReceipt(op, receiptId);
    const [b, c] = rec!.items;
    await receiving.saveCounts(op, receiptId, {
      items: [
        { itemId: b.id, countedQty: 55, damagedQty: 3 },
        { itemId: c.id, countedQty: 42, qualityHoldQty: 10 },
      ],
    });
    await expect(receiving.finishCheck(op, receiptId, {})).rejects.toThrow(/exige lote/);
  });

  it("rejeita avaria + retenção acima do conferido", async () => {
    const op = env.as("operator");
    const rec = await receiving.getReceipt(op, receiptId);
    await expect(
      receiving.saveCounts(op, receiptId, { items: [{ itemId: rec!.items[0].id, countedQty: 5, damagedQty: 6 }] }),
    ).rejects.toThrow(/não podem superar/);
  });

  it("registra falta, sobra, avaria e retenção automaticamente", async () => {
    const op = env.as("operator");
    const rec = await receiving.getReceipt(op, receiptId);
    const [b, c] = rec!.items;
    const expiry = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
    await receiving.saveCounts(op, receiptId, {
      items: [
        { itemId: b.id, countedQty: 55, damagedQty: 3, lotCode: "lb-77", expiryDate: expiry },
        { itemId: c.id, countedQty: 42, qualityHoldQty: 10, lotCode: "AC-9", expiryDate: expiry },
      ],
    });
    await receiving.addReceiptDivergence(op, receiptId, { divergenceType: "other", description: "Lacre do veículo violado" });
    const res = await receiving.finishCheck(op, receiptId, { notes: "Conferência com divergências" });
    expect(res.divergences).toBe(4);
    const divs = await listDivergences(op, { receiptId });
    const types = divs.map((d) => `${d.divergence_type}:${d.quantity ?? "-"}`).sort();
    expect(types).toEqual(["damage:3", "other:-", "overage:2", "quality_hold:10", "shortage:5"]);
    expect(divs.every((d) => d.status === "open")).toBe(true);
  });

  it("operador não pode liberar; supervisor libera somente o elegível (sem retidos)", async () => {
    await expect(receiving.releaseReceipt(env.as("operator"), receiptId)).rejects.toThrow(/permissão/);
    const sup = env.as("supervisor");
    const r = await receiving.releaseReceipt(sup, receiptId);
    expect(r.tasks).toHaveLength(2);
    const { rows } = await tasks.listTasks(sup, { type: "putaway" });
    const mine = rows.filter((t) => t.receipt_id === receiptId);
    const bySku = Object.fromEntries(mine.map((t) => [t.sku, t]));
    expect(bySku["LUB-002"].quantity).toBe(52); // 55 - 3 avariadas
    expect(bySku["ADE-003"].quantity).toBe(32); // 42 - 10 retidas
    // Produto refrigerado só pode ser sugerido em endereço refrigerado.
    expect(bySku["ADE-003"].suggested_code).toMatch(/RUA-03/);
    expect(bySku["LUB-002"].lot_code).toBe("LB-77");
  });

  it("rejeita armazenar produto refrigerado em endereço incompatível", async () => {
    const op = env.as("operator");
    const { rows } = await tasks.listTasks(op, { type: "putaway", q: "ADE-003" });
    const task = rows.find((t) => t.receipt_id === receiptId)!;
    const general = await env.location("DEP-01/RUA-01/MOD-01/NIV-01/POS-00");
    await expect(tasks.completeTask(op, task.id, { locationId: general })).rejects.toThrow(/incompatível/);
    await tasks.completeTask(op, task.id, {});
    expect((await balanceOf(env, "ADE-003")).quantity).toBe(32);
  });

  it("libera retenção de qualidade apenas com permissão e justificativa", async () => {
    const rec = await receiving.getReceipt(env.as("supervisor"), receiptId);
    const c = rec!.items.find((i) => i.sku === "ADE-003")!;
    await expect(receiving.releaseQualityHold(env.as("operator"), c.id, { quantity: 10, justification: "Laudo aprovado pelo CQ" })).rejects.toThrow(
      /permissão/,
    );
    await expect(receiving.releaseQualityHold(env.as("supervisor"), c.id, { quantity: 11, justification: "Laudo aprovado pelo CQ" })).rejects.toThrow(
      /acima do retido/,
    );
    const r = await receiving.releaseQualityHold(env.as("supervisor"), c.id, { quantity: 10, justification: "Laudo aprovado pelo CQ" });
    expect(r.tasks).toHaveLength(1);
  });

  it("divergências não somem: são tratadas com registro de responsável", async () => {
    const sup = env.as("supervisor");
    const [div] = await listDivergences(sup, { receiptId, status: "open" });
    await expect(resolveDivergence(env.as("operator"), div.id, { resolution: "Devolvido ao fornecedor" })).rejects.toBeInstanceOf(DomainError);
    await resolveDivergence(sup, div.id, { resolution: "Fornecedor notificado; crédito solicitado." });
    const all = await listDivergences(sup, { receiptId });
    expect(all).toHaveLength(5);
    expect(all.find((d) => d.id === div.id)!.resolved_by_name).toBe("Sérgio Supervisor");
  });
});
