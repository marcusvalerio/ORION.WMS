import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, balanceOf, key, type TestEnv } from "./helpers";
import * as erp from "@/server/integrations/erp/gateway";
import * as receiving from "@/server/services/receiving";
import * as tasks from "@/server/services/tasks";
import * as outbound from "@/server/services/outbound";
import * as inventory from "@/server/services/inventory";
import * as collector from "@/server/services/collector";

const DOCK = "DEP-01/RUA-EX/MOD-01/NIV-00/POS-00";
const LUB_LOC = "DEP-01/RUA-02/MOD-01/NIV-01/POS-00";

/** Coletor: os fluxos usam os mesmos serviços da tela web, validando cada leitura. */
describe("Coletor (operador com leitor de código de barras)", () => {
  let env: TestEnv;
  let warehouseId: string;
  let putawayId: string;
  let orderId: string;

  beforeAll(async () => {
    env = await createTestEnv();
    warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    const sup = env.as("supervisor");
    const pc = (await erp.listPurchaseOrders(env.db, sup.user.companyId)).find((p) => p.number === "PC-4587")!;
    const r = await receiving.createReceiptFromPurchaseOrder(sup, { purchaseOrderId: pc.id, warehouseId });
    await receiving.startCheck(sup, r.id);
    const rec = await receiving.getReceipt(sup, r.id);
    await receiving.saveCounts(sup, r.id, { items: [{ itemId: rec!.items[0].id, countedQty: 100 }] });
    await receiving.finishCheck(sup, r.id, {});
    await receiving.releaseReceipt(sup, r.id);
    const { rows } = await tasks.listTasks(sup, { type: "putaway", status: "pending" });
    putawayId = rows.find((t) => t.receipt_id === r.id)!.id;
  });

  it("resolve endereço pelo código lido e produto por EAN ou SKU", async () => {
    const op = env.as("operator");
    expect((await collector.resolveLocationCode(op, ` ${LUB_LOC.toLowerCase()}\n`)).code).toBe(LUB_LOC);
    expect((await collector.resolveProductCode(op, "7890000000017")).sku).toBe("CIA-001");
    expect((await collector.resolveProductCode(op, "cia-001")).sku).toBe("CIA-001");
    await expect(collector.resolveLocationCode(op, "XYZ")).rejects.toThrow(/não encontrado/);
    await expect(collector.resolveProductCode(op, "000")).rejects.toThrow(/não encontrado/);
  });

  it("lista minhas tarefas (sem responsável ou minhas) e pega a tarefa", async () => {
    const op = env.as("operator");
    const mine = await collector.listCollectorTasks(op);
    expect(mine.map((t) => t.id)).toContain(putawayId);
    await collector.claimTask(op, putawayId);
    // Reabrir a mesma tarefa não falha (continua com o operador).
    await collector.claimTask(op, putawayId);
    const t = await tasks.getTask(op, putawayId);
    expect(t!.status).toBe("in_progress");
    expect(t!.assigned_to).toBe(op.user.id);
    // Outro perfil não vê a tarefa atribuída ao operador na lista dele.
    expect((await collector.listCollectorTasks(env.as("supervisor"))).map((x) => x.id)).not.toContain(putawayId);
    await expect(collector.listCollectorTasks(env.as("auditor"))).rejects.toThrow(/permissão/);
  });

  it("armazenagem: valida destino sugerido, recusa inelegível com motivo e conclui", async () => {
    const op = env.as("operator");
    const task = (await tasks.getTask(op, putawayId))!;
    const ok = await collector.checkDestination(op, putawayId, task.suggested_code!);
    expect(ok.expected).toBe(true);
    // Doca de expedição não é zona de armazenagem; câmara fria tem classe incompatível.
    await expect(collector.checkDestination(op, putawayId, DOCK)).rejects.toThrow(/recusado: .*zona não é de armazenagem.*Destino sugerido/);
    await expect(collector.checkDestination(op, putawayId, "DEP-01/RUA-03/MOD-01/NIV-01/POS-00")).rejects.toThrow(/classe do endereço/);
    // Outro endereço elegível é aceito, informando que difere do sugerido.
    const other = await collector.checkDestination(op, putawayId, "DEP-01/RUA-01/MOD-03/NIV-02/POS-00");
    expect(other.expected).toBe(false);
    expect(other.message).toMatch(/diferente do sugerido/);
    await expect(collector.checkTaskProduct(op, putawayId, "7890000000024")).rejects.toThrow(/não é o da tarefa/);
    await expect(
      collector.completeFromCollector(op, putawayId, { locationCode: task.suggested_code, productCode: "7890000000017", quantity: 90 }),
    ).rejects.toThrow(/quantidade total/);
    const r = await collector.completeFromCollector(
      op,
      putawayId,
      { locationCode: "DEP-01/RUA-01/MOD-03/NIV-02/POS-00", productCode: "7890000000017", quantity: 100 },
      { idempotencyKey: key() },
    );
    expect(r.confirmed).toBe(100);
    expect(r.destinationCode).toBe("DEP-01/RUA-01/MOD-03/NIV-02/POS-00");
    expect((await balanceOf(env, "CIA-001")).quantity).toBe(100);
    await expect(collector.claimTask(op, putawayId)).rejects.toThrow(/já foi concluída/);
  });

  it("separação: confere origem e produto; quantidade a menor gera divergência e leva à doca", async () => {
    const sup = env.as("supervisor");
    const so = (await erp.listSalesOrders(env.db, sup.user.companyId)).find((s) => s.number === "PV-1001")!;
    orderId = (await outbound.importSalesOrder(sup, { salesOrderId: so.id, warehouseId })).id;
    await outbound.reserveOrder(sup, orderId);
    await outbound.releaseForPicking(sup, orderId);
    const op = env.as("operator");
    const pick = (await collector.listCollectorTasks(op)).find((t) => t.order_id === orderId)!;
    expect(pick.task_type).toBe("picking");
    await collector.claimTask(op, pick.id);
    await expect(collector.checkOrigin(op, pick.id, LUB_LOC)).rejects.toThrow(/não é a origem/);
    expect((await collector.checkOrigin(op, pick.id, pick.from_code!)).expected).toBe(true);
    await expect(
      collector.completeFromCollector(op, pick.id, { originCode: pick.from_code, productCode: "CIA-001", quantity: 25 }),
    ).rejects.toThrow(/maior que a da tarefa/);
    const r = await collector.completeFromCollector(op, pick.id, {
      originCode: pick.from_code,
      productCode: "CIA-001",
      quantity: 18,
      notes: "2 un avariadas",
    });
    expect(r.confirmed).toBe(18);
    expect(r.shortfall).toBe(2);
    expect(r.destinationCode).toBe(DOCK);
    const div = await env.one<{ n: number }>(
      `select count(*) as n from wms.divergences where order_id = $1 and divergence_type = 'short_pick'`,
      [orderId],
    );
    expect(div.n).toBe(1);
    const b = await balanceOf(env, "CIA-001");
    expect(b.quantity).toBe(100);
    expect(b.reserved).toBe(18);
  });

  it("transferência: origem, destino elegível, produto e quantidade", async () => {
    const op = env.as("operator");
    const fromLocationId = await env.location(LUB_LOC);
    const t = await tasks.createTransfer(op, {
      fromLocationId,
      productId: await env.product("LUB-002"),
      lotCode: "L2026-01",
      quantity: 10,
      toLocationId: await env.location("DEP-01/RUA-02/MOD-02/NIV-01/POS-00"),
    });
    await collector.claimTask(op, t.id);
    await expect(collector.checkDestination(op, t.id, LUB_LOC)).rejects.toThrow(/mesmo endereço/);
    await expect(
      collector.completeFromCollector(op, t.id, { originCode: "DEP-01/RUA-01/MOD-01/NIV-01/POS-00", locationCode: "DEP-01/RUA-02/MOD-02/NIV-01/POS-00", productCode: "LUB-002", quantity: 10 }),
    ).rejects.toThrow(/não é a origem/);
    const r = await collector.completeFromCollector(op, t.id, {
      originCode: LUB_LOC,
      locationCode: "DEP-01/RUA-02/MOD-02/NIV-01/POS-00",
      productCode: "7890000000024",
      quantity: 10,
    });
    expect(r.confirmed).toBe(10);
    const moved = await env.one<{ q: number }>(
      `select quantity as q from wms.stock_balances where location_id = $1 and lot_code = 'L2026-01'`,
      [await env.location("DEP-01/RUA-02/MOD-02/NIV-01/POS-00")],
    );
    expect(moved.q).toBe(10);
  });

  it("inventário: escolhe contagem, lê endereço (cega), conta produto e inclui item não previsto", async () => {
    const sup = env.as("supervisor");
    const inv = await inventory.createInventory(sup, { warehouseId, countType: "cyclic", productId: await env.product("CHP-004") });
    const op = env.as("operator");
    expect((await collector.listCountingInventories(op)).map((i) => i.id)).toContain(inv.id);
    const chpLoc = "DEP-01/RUA-04/MOD-01/NIV-00/POS-00";
    const at = await collector.inventoryLocation(op, inv.id, chpLoc);
    expect(at.items).toHaveLength(1);
    expect(at.items[0]).not.toHaveProperty("expected_qty");
    const c1 = await collector.countFromCollector(op, inv.id, { locationCode: chpLoc, productCode: "7890000000048", quantity: 7 });
    expect(c1.added).toBe(false);
    const c2 = await collector.countFromCollector(op, inv.id, { locationCode: "DEP-01/RUA-04/MOD-02/NIV-00/POS-00", productCode: "CHP-004", quantity: 3 });
    expect(c2.added).toBe(true);
    const detail = await inventory.getInventory(sup, inv.id);
    expect(detail!.items.map((i) => i.counted_qty).sort()).toEqual([3, 7]);
    // Contagem não altera saldo.
    expect((await balanceOf(env, "CHP-004")).quantity).not.toBe(10);
    await expect(collector.countFromCollector(env.as("auditor"), inv.id, { locationCode: chpLoc, productCode: "CHP-004", quantity: 1 })).rejects.toThrow(
      /permissão/,
    );
  });

  it("consulta rápida: endereço → conteúdo; produto → onde está e quanto", async () => {
    const op = env.as("auditor");
    const byLoc = await collector.lookupCode(op, LUB_LOC);
    expect(byLoc.kind).toBe("location");
    if (byLoc.kind === "location") expect(byLoc.balances[0].sku).toBe("LUB-002");
    const byProduct = await collector.lookupCode(op, "7890000000017");
    expect(byProduct.kind).toBe("product");
    if (byProduct.kind === "product") {
      expect(byProduct.total).toBe(100);
      expect(byProduct.available).toBe(82);
      expect(byProduct.balances.map((b) => b.location_code)).toContain(DOCK);
    }
    await expect(collector.lookupCode(op, "nada-disso")).rejects.toThrow(/nem a produto/);
  });
});
