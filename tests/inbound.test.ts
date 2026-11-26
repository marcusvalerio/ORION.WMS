import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, balanceOf, key, type TestEnv } from "./helpers";
import * as receiving from "@/server/services/receiving";
import * as nfe from "@/server/services/nfe";
import * as docks from "@/server/services/docks";
import * as returns from "@/server/services/returns";
import * as outbound from "@/server/services/outbound";
import * as tasks from "@/server/services/tasks";
import * as quality from "@/server/services/quality";
import { accessKeyCheckDigit, isValidAccessKey, parseNfeXml, MAX_NFE_BYTES } from "@/server/integrations/nfe/parser";

const SAMPLE = readFileSync(path.join(process.cwd(), "docs/exemplos/nfe-pc-4588-entrega-1.xml"), "utf8");

async function receiveAll(env: TestEnv, receiptId: string, counts: Record<string, number>, extra: Record<string, { lotCode?: string; expiryDate?: string; damagedQty?: number }> = {}) {
  const op = env.as("operator");
  await receiving.startCheck(op, receiptId);
  const r = (await receiving.getReceipt(op, receiptId))!;
  const expiry = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
  await receiving.saveCounts(op, receiptId, {
    items: r.items.map((i) => ({
      itemId: i.id,
      countedQty: counts[i.sku] ?? i.expected_qty,
      lotCode: extra[i.sku]?.lotCode ?? (i.lot_code || (i.lot_controlled ? "L-TESTE" : "")),
      expiryDate: extra[i.sku]?.expiryDate ?? (i.expiry_date || (i.expiry_controlled ? expiry : null)),
      damagedQty: extra[i.sku]?.damagedQty ?? 0,
    })),
  });
  return receiving.finishCheck(op, receiptId, {});
}

async function putawayAll(env: TestEnv, receiptId: string) {
  const sup = env.as("supervisor");
  await receiving.releaseReceipt(sup, receiptId);
  const { rows } = await tasks.listTasks(sup, { type: "putaway", pageSize: 100 });
  for (const t of rows.filter((x) => x.receipt_id === receiptId && x.status === "pending")) await tasks.completeTask(env.as("operator"), t.id, {});
}

describe("Recebimento parcial em várias entregas", () => {
  let env: TestEnv;
  let wh: string;
  let po: string;
  beforeAll(async () => {
    env = await createTestEnv();
    wh = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    po = await env.id(`select id from erp.purchase_orders where number = 'PC-4587'`);
  });

  it("primeira entrega parcial deixa o pedido 'recebido parcial' com saldo pendente", async () => {
    const sup = env.as("supervisor");
    const [item] = await receiving.purchaseOrderBalance(env.db, po);
    expect(item.pending).toBe(100);
    const r1 = await receiving.createReceiptFromPurchaseOrder(sup, { purchaseOrderId: po, warehouseId: wh, items: [{ purchaseOrderItemId: item.purchase_order_item_id, quantity: 60 }] });
    // segunda entrega simultânea só pode levar o saldo restante (40)
    await expect(
      receiving.createReceiptFromPurchaseOrder(sup, { purchaseOrderId: po, warehouseId: wh, items: [{ purchaseOrderItemId: item.purchase_order_item_id, quantity: 41 }] }),
    ).rejects.toThrow(/ultrapassa o saldo pendente/);
    const res = await receiveAll(env, r1.id, {});
    expect(res.divergences).toBe(0);
    await putawayAll(env, r1.id);
    expect((await env.one<{ status: string }>(`select status from erp.purchase_orders where id = $1`, [po])).status).toBe("partially_received");
    const [b] = await receiving.purchaseOrderBalance(env.db, po);
    expect(b).toMatchObject({ ordered: 100, received: 60, in_transit: 0, pending: 40 });
  });

  it("segunda entrega recebe o saldo pendente; sobra física vira divergência; pedido fica recebido", async () => {
    const sup = env.as("supervisor");
    const r2 = await receiving.createReceiptFromPurchaseOrder(sup, { purchaseOrderId: po, warehouseId: wh });
    const rec = (await receiving.getReceipt(sup, r2.id))!;
    expect(rec.items.map((i) => i.expected_qty)).toEqual([40]);
    // sem saldo: nenhuma terceira entrega enquanto a segunda está em andamento
    await expect(receiving.createReceiptFromPurchaseOrder(sup, { purchaseOrderId: po, warehouseId: wh })).rejects.toThrow(/não possui saldo pendente/);
    const res = await receiveAll(env, r2.id, { "CIA-001": 43 });
    expect(res.divergences).toBe(1);
    const div = await env.one<{ divergence_type: string; quantity: number }>(`select divergence_type, quantity from wms.divergences where receipt_id = $1`, [r2.id]);
    expect(div).toEqual({ divergence_type: "overage", quantity: 3 });
    await putawayAll(env, r2.id);
    expect((await env.one<{ status: string }>(`select status from erp.purchase_orders where id = $1`, [po])).status).toBe("received");
    expect((await balanceOf(env, "CIA-001")).quantity).toBe(103);
    const deliveries = await receiving.listPurchaseOrderDeliveries(env.db, env.as("supervisor").user.companyId, po);
    expect(deliveries).toHaveLength(2);
    await expect(receiving.createReceiptFromPurchaseOrder(sup, { purchaseOrderId: po, warehouseId: wh })).rejects.toThrow(/totalmente recebido/);
  });

  it("falta e avaria mantêm saldo pendente para nova entrega; cancelamento devolve o saldo", async () => {
    const sup = env.as("supervisor");
    const po2 = await env.id(`select id from erp.purchase_orders where number = 'PC-4588'`);
    const r = await receiving.createReceiptFromPurchaseOrder(sup, { purchaseOrderId: po2, warehouseId: wh });
    await receiving.cancelReceipt(sup, r.id, { reason: "Veículo não chegou" });
    expect((await receiving.purchaseOrderBalance(env.db, po2)).map((b) => b.pending)).toEqual([60, 40]);
    const r2 = await receiving.createReceiptFromPurchaseOrder(sup, { purchaseOrderId: po2, warehouseId: wh });
    await receiveAll(env, r2.id, { "LUB-002": 50, "ADE-003": 40 }, { "LUB-002": { damagedQty: 5 } });
    const bal = await receiving.purchaseOrderBalance(env.db, po2);
    expect(bal.map((b) => [b.sku, b.received, b.pending])).toEqual([
      ["LUB-002", 45, 15],
      ["ADE-003", 40, 0],
    ]);
  });
});

describe("NF-e: parser e segurança", () => {
  it("lê o XML de exemplo (chave, emitente, itens, rastro)", () => {
    const n = parseNfeXml(SAMPLE);
    expect(n.accessKey).toHaveLength(44);
    expect(isValidAccessKey(n.accessKey)).toBe(true);
    expect(n).toMatchObject({ model: "55", number: "12345", series: "1", emitter: { cnpj: "44555666000181" } });
    expect(n.items).toHaveLength(2);
    expect(n.items[0]).toMatchObject({ supplierCode: "QD-LUB-1L", ean: "7890000000024", quantity: 30, poNumberRef: "PC-4588" });
    expect(n.items[0].lots[0]).toMatchObject({ lot: "LB-2611", quantity: 30 });
    expect(n.items[1].ean).toBeNull();
    expect(n.items[1].description).toContain("&");
    expect(n.items[1].lots.map((l) => l.quantity)).toEqual([25, 15]);
  });

  it("calcula o dígito verificador da chave (módulo 11)", () => {
    const k = parseNfeXml(SAMPLE).accessKey;
    expect(accessKeyCheckDigit(k.slice(0, 43))).toBe(Number(k[43]));
  });

  it("recusa chave com DV inválido, DOCTYPE/entidades externas, XML malformado e arquivo grande", () => {
    const k = parseNfeXml(SAMPLE).accessKey;
    const badDv = k.slice(0, 43) + ((Number(k[43]) + 1) % 10);
    expect(() => parseNfeXml(SAMPLE.replace(`NFe${k}`, `NFe${badDv}`))).toThrow(/dígito verificador/);
    const xxe = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]>` + SAMPLE.replace(/^<\?xml[^>]*>/, "");
    expect(() => parseNfeXml(xxe)).toThrow(/DOCTYPE/);
    const bomb = `<!DOCTYPE l [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><l>&b;</l>`;
    expect(() => parseNfeXml(bomb)).toThrow(/DOCTYPE/);
    expect(() => parseNfeXml("<nfeProc><NFe>")).toThrow(/malformado/);
    expect(() => parseNfeXml("x".repeat(MAX_NFE_BYTES + 1))).toThrow(/limite/);
    expect(() => parseNfeXml(SAMPLE.replace("<mod>55</mod>", "<mod>65</mod>"))).toThrow(/modelo 55/);
  });
});

describe("NF-e: importação, de-para e recebimento", () => {
  let env: TestEnv;
  let wh: string;
  beforeAll(async () => {
    env = await createTestEnv();
    wh = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
  });

  it("casa fornecedor por CNPJ, pedido por xPed e item por EAN; item sem EAN fica pendente", async () => {
    const op = env.as("operator");
    const { id } = await nfe.importNfe(op, { xml: SAMPLE }, { idempotencyKey: key() });
    const n = (await nfe.getNfe(op, id))!;
    expect(n.supplier_name).toMatch(/Química Delta/);
    expect(n.po_number).toBe("PC-4588");
    expect(n.items.map((i) => [i.supplier_code, i.sku, i.match_source])).toEqual([
      ["QD-LUB-1L", "LUB-002", "ean"],
      ["QD-ADE-77", null, null],
    ]);
    // comparação NF × pedido
    const lub = n.comparison.find((c) => c.sku === "LUB-002")!;
    expect(lub).toMatchObject({ ordered: 60, pending: 60, nfe_qty: 30, difference: -30 });
    await expect(nfe.createReceiptFromNfe(op, id, { warehouseId: wh })).rejects.toThrow(/pendentes de vínculo/);
    // reimportar a mesma chave enquanto pendente devolve a mesma importação
    expect((await nfe.importNfe(op, { xml: SAMPLE })).id).toBe(id);
  });

  it("de-para confirmado fica salvo e o recebimento nasce com lote/validade da NF", async () => {
    const op = env.as("operator");
    const [imp] = await nfe.listNfeImports(op);
    const n = (await nfe.getNfe(op, imp.id))!;
    const pending = n.items.find((i) => !i.product_id)!;
    await nfe.linkNfeItem(op, pending.id, { productId: await env.product("ADE-003") });
    const saved = await env.one<{ n: number }>(`select count(*) as n from wms.supplier_product_codes where supplier_code = 'QD-ADE-77'`);
    expect(saved.n).toBe(1);
    const r = await nfe.createReceiptFromNfe(op, imp.id, { warehouseId: wh }, { idempotencyKey: key() });
    const rec = (await receiving.getReceipt(op, r.id))!;
    expect(rec.invoice_key).toBe(parseNfeXml(SAMPLE).accessKey);
    expect(rec.items.map((i) => [i.sku, i.expected_qty, i.lot_code])).toEqual([
      ["LUB-002", 30, "LB-2611"],
      ["ADE-003", 25, "AD-0901"],
      ["ADE-003", 15, "AD-0902"],
    ]);
    expect(rec.items.every((i) => i.expiry_date)).toBe(true);
    // saldo do pedido considera a entrega da NF em trânsito
    const po = await env.id(`select id from erp.purchase_orders where number = 'PC-4588'`);
    expect((await receiving.purchaseOrderBalance(env.db, po)).map((b) => b.pending)).toEqual([30, 0]);
    // mesma NF não pode gerar outro recebimento
    await expect(nfe.importNfe(op, { xml: SAMPLE })).rejects.toThrow(/já foi recebida/);
  });

  it("emitente desconhecido: vincular fornecedor grava o CNPJ; de-para salvo é reaproveitado", async () => {
    const env2 = await createTestEnv();
    await env2.db.query(`update erp.suppliers set cnpj = null`);
    await env2.db.query(
      `insert into wms.supplier_product_codes (company_id, supplier_id, supplier_code, product_id, confirmed_by)
       select s.company_id, s.id, 'QD-ADE-77', p.id, u.id from erp.suppliers s, erp.products p, wms.users u
       where s.code = 'FOR-002' and p.sku = 'ADE-003' and u.role = 'admin'`,
    );
    const op = env2.as("operator");
    const { id } = await nfe.importNfe(op, { xml: SAMPLE });
    let n = (await nfe.getNfe(op, id))!;
    expect(n.supplier_id).toBeNull();
    const for1 = await env2.id(`select id from erp.suppliers where code = 'FOR-001'`);
    await env2.db.query(`update erp.suppliers set cnpj = '11222333000181' where id = $1`, [for1]);
    await expect(nfe.linkNfeSupplier(op, id, { supplierId: for1 })).rejects.toThrow(/outro CNPJ/);
    const for2 = await env2.id(`select id from erp.suppliers where code = 'FOR-002'`);
    await nfe.linkNfeSupplier(op, id, { supplierId: for2 });
    expect((await env2.one<{ cnpj: string }>(`select cnpj from erp.suppliers where id = $1`, [for2])).cnpj).toBe("44555666000181");
    n = (await nfe.getNfe(op, id))!;
    expect(n.items.every((i) => i.product_id)).toBe(true);
    expect(n.items[1].match_source).toBe("supplier_code");
    // auditor não importa
    await expect(nfe.importNfe(env2.as("auditor"), { xml: SAMPLE })).rejects.toThrow(/permissão/);
  });
});

describe("Agenda de docas", () => {
  let env: TestEnv;
  let dock1: string;
  let dock2: string;
  let wh: string;
  const date = "2026-12-01";
  beforeAll(async () => {
    env = await createTestEnv();
    dock1 = await env.id(`select id from wms.docks where code = 'DOC-01'`);
    dock2 = await env.id(`select id from wms.docks where code = 'DOC-02'`);
    wh = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
  });

  it("impede sobreposição na mesma doca (serviço e banco) e aceita janelas adjacentes", async () => {
    const sup = env.as("supervisor");
    const a = await docks.createAppointment(sup, { dockId: dock1, date, startTime: "08:00", endTime: "09:00", carrier: "Rota", vehiclePlate: "abc-1d23" });
    await expect(docks.createAppointment(sup, { dockId: dock1, date, startTime: "08:30", endTime: "09:30" })).rejects.toThrow(/ocupada/);
    await docks.createAppointment(sup, { dockId: dock1, date, startTime: "09:00", endTime: "10:00" });
    // a restrição também vale para escrita direta no banco
    const appt = await env.one<{ company_id: string; warehouse_id: string; created_by: string }>(`select company_id, warehouse_id, created_by from wms.dock_appointments where id = $1`, [a.id]);
    await expect(
      env.db.query(
        `insert into wms.dock_appointments (company_id, warehouse_id, dock_id, code, direction, starts_at, ends_at, created_by)
         values ($1,$2,$3,'X-1','inbound', $4::timestamptz, $5::timestamptz, $6)`,
        [appt.company_id, appt.warehouse_id, dock1, "2026-12-01 11:15:00+00", "2026-12-01 11:45:00+00", appt.created_by],
      ),
    ).rejects.toThrow(/Doca ocupada/);
    // cancelado libera a janela
    await docks.changeAppointmentStatus(sup, a.id, { action: "cancel" });
    await docks.createAppointment(sup, { dockId: dock1, date, startTime: "08:00", endTime: "08:45" });
    const day = await docks.listDayAppointments(sup, date);
    expect(day.filter((x) => x.status !== "cancelled").map((x) => `${x.local_start}-${x.local_end}`)).toEqual(["08:00-08:45", "09:00-10:00"]);
    expect(day.find((x) => x.local_start === "09:00")!.start_min).toBe(540);
  });

  it("valida tipo de doca, horários e transições de status", async () => {
    const sup = env.as("supervisor");
    const po = await env.id(`select id from erp.purchase_orders where number = 'PC-4588'`);
    await expect(docks.createAppointment(sup, { dockId: dock2, date, startTime: "10:00", endTime: "11:00", purchaseOrderId: po })).rejects.toThrow(/exclusiva de saída/);
    await expect(docks.createAppointment(sup, { dockId: dock1, date, startTime: "11:00", endTime: "10:00" })).rejects.toThrow(/posterior/);
    const a = await docks.createAppointment(sup, { dockId: dock1, date, startTime: "13:00", endTime: "14:00", purchaseOrderId: po });
    await expect(docks.changeAppointmentStatus(sup, a.id, { action: "complete" })).rejects.toThrow(/status/);
    await expect(docks.changeAppointmentStatus(sup, a.id, { action: "no_show" })).rejects.toThrow(/após o início/);
    await expect(docks.createAppointment(env.as("auditor"), { dockId: dock1, date, startTime: "15:00", endTime: "16:00" })).rejects.toThrow(/permissão/);
    await expect(docks.createDock(env.as("operator"), { warehouseId: wh, code: "D9", name: "Doca 9", dockType: "both" })).rejects.toThrow(/permissão/);
  });

  it("recebimento nasce do agendamento: check-in automático e conclusão junto com o recebimento", async () => {
    const sup = env.as("supervisor");
    const appt = await env.one<{ id: string; purchase_order_id: string }>(`select id, purchase_order_id from wms.dock_appointments where code = 'AGD-000001'`);
    const r = await receiving.createReceiptFromPurchaseOrder(sup, { purchaseOrderId: appt.purchase_order_id, warehouseId: wh, appointmentId: appt.id });
    expect((await env.one<{ status: string }>(`select status from wms.dock_appointments where id = $1`, [appt.id])).status).toBe("checked_in");
    const rec = (await receiving.getReceipt(sup, r.id))!;
    expect(rec.arrived_at).not.toBeNull();
    expect(rec.appointment_code).toBe("AGD-000001");
    await receiveAll(env, r.id, {});
    await putawayAll(env, r.id);
    expect((await env.one<{ status: string }>(`select status from wms.dock_appointments where id = $1`, [appt.id])).status).toBe("completed");
  });
});

describe("Devolução de cliente", () => {
  let env: TestEnv;
  let orderId: string;
  beforeAll(async () => {
    // Fluxo completo: recebe 100 de CIA-001, expede 20 para PV-1001.
    env = await createTestEnv();
    const sup = env.as("supervisor");
    const wh = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    const po = await env.id(`select id from erp.purchase_orders where number = 'PC-4587'`);
    const r = await receiving.createReceiptFromPurchaseOrder(sup, { purchaseOrderId: po, warehouseId: wh });
    await receiveAll(env, r.id, {});
    await putawayAll(env, r.id);
    const so = await env.id(`select id from erp.sales_orders where number = 'PV-1001'`);
    orderId = (await outbound.importSalesOrder(sup, { salesOrderId: so, warehouseId: wh })).id;
    await outbound.reserveOrder(sup, orderId);
    await outbound.releaseForPicking(sup, orderId);
    const { rows } = await tasks.listTasks(sup, { type: "picking" });
    for (const t of rows.filter((x) => x.order_id === orderId)) await tasks.completeTask(env.as("operator"), t.id, {});
    const o = (await outbound.getOrder(sup, orderId))!;
    await outbound.checkOrder(sup, orderId, { lines: o.lines.map((l) => ({ lineId: l.id, checkedQty: l.picked_qty })) });
    await outbound.shipOrder(sup, orderId, {});
  });

  it("recusa devolução acima do expedido e de pedido não expedido", async () => {
    const op = env.as("operator");
    const [line] = await returns.returnableLines(env.db, op.user.companyId, orderId);
    expect(line.returnable).toBe(20);
    await expect(returns.createReturn(op, { outboundOrderId: orderId, reason: "quality", items: [{ orderLineId: line.id, quantity: 21 }] })).rejects.toThrow(/acima do expedido/);
    const sup = env.as("supervisor");
    const wh = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    const manual = await outbound.createManualOrder(sup, { warehouseId: wh, customerName: "Cliente X", lines: [{ productId: await env.product("CIA-001"), quantity: 1 }] });
    await expect(returns.createReturn(op, { outboundOrderId: manual.id, reason: "other", items: [{ orderLineId: line.id, quantity: 1 }] })).rejects.toThrow(/expedido/);
  });

  it("inspeção: apto vira armazenagem, avariado vai bloqueado para quarentena, descarte baixa com movimento próprio", async () => {
    const op = env.as("operator");
    const sup = env.as("supervisor");
    const [line] = await returns.returnableLines(env.db, op.user.companyId, orderId);
    const ret = await returns.createReturn(op, { outboundOrderId: orderId, reason: "damaged_in_transit", items: [{ orderLineId: line.id, quantity: 10 }] }, { idempotencyKey: key() });
    // saldo restante devolvível
    expect((await returns.returnableLines(env.db, op.user.companyId, orderId))[0].returnable).toBe(10);
    const [item] = (await returns.getReturn(op, ret.id))!.items;
    await expect(returns.inspectReturnItem(op, item.id, { approvedQty: 6, damagedQty: 3, discardedQty: 1 })).rejects.toThrow(/permissão/);
    await expect(returns.inspectReturnItem(sup, item.id, { approvedQty: 6, damagedQty: 3 })).rejects.toThrow(/deve ser igual/);
    const before = await balanceOf(env, "CIA-001");
    const res = await returns.inspectReturnItem(sup, item.id, { approvedQty: 6, damagedQty: 3, discardedQty: 1, notes: "Caixa amassada" });
    expect(res.completed).toBe(true);
    // R1: o apto aguarda a qualidade com saldo bloqueado na quarentena (sem armazenagem ainda)
    expect(res.tasks).toHaveLength(0);
    const after = await balanceOf(env, "CIA-001");
    expect(after.quantity).toBe(before.quantity + 9); // avariado (3) + apto aguardando qualidade (6), todos bloqueados
    expect(after.blocked).toBe(before.blocked + 9);
    const qua = await env.one<{ quantity: number; blocked_qty: number }>(
      `select sum(b.quantity) as quantity, sum(b.blocked_qty) as blocked_qty from wms.stock_balances b join wms.locations l on l.id = b.location_id
       where l.location_type = 'quarantine'`,
    );
    expect(qua).toEqual({ quantity: 9, blocked_qty: 9 });
    const [hold] = await quality.listQualityHolds(sup);
    expect(hold).toMatchObject({ source: "customer_return", quantity: 6, status: "pending" });
    await expect(quality.decideQualityHold(op, hold.id, { decision: "approved", report: "Conferido" })).rejects.toThrow(/permissão/);
    await expect(quality.decideQualityHold(sup, hold.id, { decision: "approved", report: "ok" })).rejects.toThrow(/laudo/);
    const decided = await quality.decideQualityHold(sup, hold.id, { decision: "approved", report: "Embalagem íntegra, produto apto." });
    expect(decided.tasks).toHaveLength(1);
    expect((await balanceOf(env, "CIA-001")).quantity).toBe(before.quantity + 3); // apto saiu da quarentena e segue para a armazenagem
    const movs = await env.db.query<{ movement_type: string; quantity: number }>(
      `select movement_type, quantity from wms.stock_movements where reference_id = $1 order by created_at, movement_type`,
      [ret.id],
    );
    expect(movs.map((m) => `${m.movement_type}:${m.quantity}`).sort()).toEqual(["discard:1", "return_in:1", "return_in:3", "return_in:6", "unblock:6"]);
    const task = (await returns.getReturn(sup, ret.id))!.tasks[0];
    await tasks.completeTask(op, task.id, {});
    expect((await balanceOf(env, "CIA-001")).quantity).toBe(before.quantity + 9);
    const putaway = await env.one<{ reference_code: string }>(`select reference_code from wms.stock_movements where task_id = $1`, [task.id]);
    expect(putaway.reference_code).toBe(ret.code);
    const ev = await env.one<{ event_type: string }>(`select event_type from wms.integration_events where aggregate_id = $1`, [ret.id]);
    expect(ev.event_type).toBe("customer_return.completed");
    await expect(returns.inspectReturnItem(sup, item.id, { approvedQty: 10 })).rejects.toThrow(/não está aguardando/);
  });

  it("restrição do banco impede item inspecionado com destinações que não fecham", async () => {
    const [item] = await env.db.query<{ id: string }>(`select id from wms.customer_return_items limit 1`);
    await expect(env.db.query(`update wms.customer_return_items set approved_qty = 99 where id = $1`, [item.id])).rejects.toThrow();
  });

  it("cancelamento devolve o saldo devolvível", async () => {
    const op = env.as("operator");
    const [line] = await returns.returnableLines(env.db, op.user.companyId, orderId);
    const ret = await returns.createReturn(op, { outboundOrderId: orderId, reason: "regret", items: [{ orderLineId: line.id, quantity: 10 }] });
    await expect(returns.createReturn(op, { outboundOrderId: orderId, reason: "regret", items: [{ orderLineId: line.id, quantity: 1 }] })).rejects.toThrow(/acima do expedido/);
    await returns.cancelReturn(op, ret.id, { reason: "Cliente desistiu da devolução" });
    expect((await returns.returnableLines(env.db, op.user.companyId, orderId))[0].returnable).toBe(10);
    expect((await returns.listReturns(op)).length).toBe(2);
  });
});
