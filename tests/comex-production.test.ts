import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, balanceOf, key, type TestEnv } from "./helpers";
import * as receiving from "@/server/services/receiving";
import * as outbound from "@/server/services/outbound";
import * as tasks from "@/server/services/tasks";
import * as comex from "@/server/services/comex";
import * as production from "@/server/services/production";
import { listStock } from "@/server/services/stock";
import { isValidContainer, iso6346CheckDigit, isCountryCode, isNcm } from "@/lib/comex";

const LINE = "DEP-01/RUA-PR/MOD-01/NIV-00/POS-00";

describe("Regras de comércio exterior (lib)", () => {
  it("valida o dígito verificador ISO 6346", () => {
    expect(iso6346CheckDigit("CSQU305438")).toBe(3);
    expect(isValidContainer("CSQU3054383")).toBe(true);
    expect(isValidContainer("MSCU1234566")).toBe(true);
    expect(isValidContainer("CSQU3054384")).toBe(false);
    expect(isValidContainer("CSQX3054383")).toBe(false);
    expect(isValidContainer("CSQU305438")).toBe(false);
  });

  it("valida NCM e país", () => {
    expect(isNcm("84879000")).toBe(true);
    expect(isNcm("8487900")).toBe(false);
    expect(isNcm("8487.90.00")).toBe(false);
    expect(isCountryCode("CN")).toBe(true);
    expect(isCountryCode("XX")).toBe(false);
  });
});

describe("Importação: dados aduaneiros e retenção até o desembaraço", () => {
  let env: TestEnv;
  let receiptId: string;
  let warehouseId: string;

  beforeAll(async () => {
    env = await createTestEnv();
    warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    const poId = await env.id(`select id from erp.purchase_orders where number = 'PC-4587'`);
    receiptId = (await receiving.createReceiptFromPurchaseOrder(env.as("supervisor"), { purchaseOrderId: poId, warehouseId })).id;
  });

  const base = { importDocType: "DUIMP", importDocNumber: "24BR0001234567", incoterm: "FOB", originCountry: "cn", sealNumber: "SL-998877" };

  it("recusa contêiner com dígito verificador inválido, NCM inválido, Incoterm e país inválidos", async () => {
    const sup = env.as("supervisor");
    const rec = await receiving.getReceipt(sup, receiptId);
    await expect(comex.saveReceiptImport(sup, receiptId, { ...base, containerNumber: "CSQU3054384" })).rejects.toThrow(/ISO 6346/);
    await expect(
      comex.saveReceiptImport(sup, receiptId, { ...base, items: [{ id: rec!.items[0].id, ncm: "8487900" }] }),
    ).rejects.toThrow(/NCM inválido/);
    await expect(comex.saveReceiptImport(sup, receiptId, { ...base, incoterm: "FOT" })).rejects.toThrow(/Incoterm/);
    await expect(comex.saveReceiptImport(sup, receiptId, { ...base, originCountry: "XX" })).rejects.toThrow(/ISO 3166/);
    await expect(comex.saveReceiptImport(sup, receiptId, { holdForClearance: "on" })).rejects.toThrow(/DI ou DUIMP/);
    await expect(comex.saveReceiptImport(env.as("operator"), receiptId, base)).rejects.toThrow(/permissão/);
    // O banco também recusa contêiner/NCM inválidos gravados por fora do serviço.
    await expect(env.db.query(`update wms.receipts set container_number = 'CSQU3054384' where id = $1`, [receiptId])).rejects.toMatchObject({
      code: "23514",
    });
    await expect(env.db.query(`update wms.receipt_items set ncm = '123' where receipt_id = $1`, [receiptId])).rejects.toMatchObject({ code: "23514" });
  });

  it("grava os dados de importação com retenção aduaneira", async () => {
    const sup = env.as("supervisor");
    const rec = await receiving.getReceipt(sup, receiptId);
    const r = await comex.saveReceiptImport(sup, receiptId, {
      ...base,
      containerNumber: "csqu 305438-3",
      holdForClearance: "on",
      items: [{ id: rec!.items[0].id, ncm: "8487.90.00" }],
    });
    expect(r.customsStatus).toBe("awaiting");
    const info = await comex.getReceiptImport(sup, receiptId);
    expect(info).toMatchObject({ container_number: "CSQU3054383", origin_country: "CN", incoterm: "FOB", customs_status: "awaiting" });
    expect(info!.items[0].ncm).toBe("84879000");
  });

  it("recusa liberar a armazenagem antes do desembaraço (serviço e banco)", async () => {
    const op = env.as("operator");
    await receiving.startCheck(op, receiptId);
    const rec = await receiving.getReceipt(op, receiptId);
    await receiving.saveCounts(op, receiptId, { items: [{ itemId: rec!.items[0].id, countedQty: 100, lotCode: "IMP-CN-01" }] });
    await receiving.finishCheck(op, receiptId, {});
    await expect(receiving.releaseReceipt(env.as("supervisor"), receiptId)).rejects.toThrow(/aguardando desembaraço/);
    await expect(env.db.query(`update wms.receipts set status = 'released' where id = $1`, [receiptId])).rejects.toMatchObject({ code: "23514" });
    const n = await env.one<{ n: number }>(`select count(*) as n from wms.tasks where receipt_id = $1`, [receiptId]);
    expect(n.n).toBe(0);
  });

  it("desembaraço exige supervisor, gera import.cleared e libera a armazenagem", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await expect(comex.clearCustoms(env.as("operator"), receiptId, { clearedOn: today })).rejects.toThrow(/permissão/);
    await expect(comex.clearCustoms(env.as("supervisor"), receiptId, { clearedOn: "2999-01-01" })).rejects.toThrow(/futuro/);
    await comex.clearCustoms(env.as("supervisor"), receiptId, { clearedOn: today });
    await expect(comex.clearCustoms(env.as("supervisor"), receiptId, { clearedOn: today })).rejects.toThrow(/não está aguardando/);
    const ev = await env.one<{ payload: { declaration: { type: string }; originCountry: string; items: { ncm: string }[] } }>(
      `select payload from wms.integration_events where event_type = 'import.cleared' and aggregate_id = $1`,
      [receiptId],
    );
    expect(ev.payload.declaration.type).toBe("DUIMP");
    expect(ev.payload.originCountry).toBe("CN");
    expect(ev.payload.items[0].ncm).toBe("84879000");

    const sup = env.as("supervisor");
    const released = await receiving.releaseReceipt(sup, receiptId);
    expect(released.tasks.length).toBeGreaterThan(0);
    const putaways = await env.db.query<{ id: string }>(`select id from wms.tasks where receipt_id = $1 and status = 'pending'`, [receiptId]);
    for (const t of putaways) await tasks.completeTask(env.as("operator"), t.id, {});
  });

  it("o país de origem segue o lote no saldo (consulta de estoque)", async () => {
    const productId = await env.product("CIA-001");
    const { rows } = await listStock(env.as("auditor"), { productId });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.lot_code === "IMP-CN-01" && r.origin_country === "CN")).toBe(true);
    expect((await balanceOf(env, "CIA-001")).quantity).toBe(100);
  });
});

describe("Exportação: volumes, packing list e estufagem", () => {
  let env: TestEnv;
  let orderId: string;

  beforeAll(async () => {
    env = await createTestEnv();
    const warehouseId = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    const sup = env.as("supervisor");
    const order = await outbound.createManualOrder(sup, {
      warehouseId,
      customerName: "Importadora Andes (demo)",
      lines: [{ productId: await env.product("CHP-004"), quantity: 10 }],
    });
    orderId = order.id;
    await comex.saveOrderExport(sup, orderId, {
      isExport: "on",
      incoterm: "FCA",
      destinationCountry: "cl",
      commercialInvoice: "INV-2026-0042",
      exportDeclaration: "26BR0000123456",
    });
    await outbound.reserveOrder(sup, orderId);
    await outbound.releaseForPicking(sup, orderId);
  });

  it("exige país de destino válido para marcar exportação", async () => {
    await expect(comex.saveOrderExport(env.as("supervisor"), orderId, { isExport: "on" })).rejects.toThrow(/país de destino/);
  });

  it("só monta volume após a separação e nunca acima do separado", async () => {
    const o = await outbound.getOrder(env.as("operator"), orderId);
    const lineId = o!.lines[0].id;
    const pkg = { grossWeightKg: 65, netWeightKg: 60, lengthCm: 110, widthCm: 60, heightCm: 20, packageType: "pallet" };
    await expect(comex.addExportPackage(env.as("operator"), orderId, { ...pkg, items: [{ orderLineId: lineId, quantity: 5 }] })).rejects.toThrow(
      /após a separação/,
    );
    const picks = await env.db.query<{ id: string }>(`select id from wms.tasks where order_id = $1 and task_type = 'picking'`, [orderId]);
    for (const t of picks) await tasks.completeTask(env.as("operator"), t.id, {});
    await expect(comex.addExportPackage(env.as("operator"), orderId, { ...pkg, items: [{ orderLineId: lineId, quantity: 11 }] })).rejects.toThrow(
      /excede o separado/,
    );
    await expect(
      comex.addExportPackage(env.as("operator"), orderId, { ...pkg, netWeightKg: 70, items: [{ orderLineId: lineId, quantity: 5 }] }),
    ).rejects.toThrow(/peso líquido/);
  });

  it("packing list soma pesos e volumes; fechamento exige tudo embalado e gera export.packed", async () => {
    const op = env.as("operator");
    const o = await outbound.getOrder(op, orderId);
    const lineId = o!.lines[0].id;
    await comex.addExportPackage(op, orderId, {
      packageType: "pallet",
      grossWeightKg: 65.5,
      netWeightKg: 60,
      lengthCm: 110,
      widthCm: 60,
      heightCm: 20,
      items: [{ orderLineId: lineId, quantity: 5 }],
    });
    await expect(comex.finishPacking(op, orderId)).rejects.toThrow(/fora dos volumes/);
    await comex.addExportPackage(op, orderId, {
      packageType: "pallet",
      grossWeightKg: 64.25,
      netWeightKg: 60,
      lengthCm: 100,
      widthCm: 50,
      heightCm: 10,
      items: [{ orderLineId: lineId, quantity: 5 }],
    });
    const list = await comex.getPackingList(op, orderId);
    expect(list!.totals).toEqual({ packages: 2, grossWeightKg: 129.75, netWeightKg: 120, volumeM3: 0.182, quantity: 10 });
    expect(list!.packages[0].items[0]).toMatchObject({ sku: "CHP-004", ncm: "72085200", quantity: 5 });
    expect(list!.pending).toHaveLength(0);

    // Pedido de exportação não é expedido sem packing list fechado.
    await outbound.checkOrder(op, orderId, { lines: [{ lineId, checkedQty: 10 }] });
    await expect(outbound.shipOrder(op, orderId, {})).rejects.toThrow(/packing list/);

    await expect(comex.stuffContainer(op, orderId, { containerNumber: "MSCU1234566", sealNumber: "L1" })).rejects.toThrow(/Feche o packing/);
    await comex.finishPacking(op, orderId, { idempotencyKey: key() });
    const ev = await env.one<{ payload: { totals: { grossWeightKg: number }; packages: unknown[] } }>(
      `select payload from wms.integration_events where event_type = 'export.packed' and aggregate_id = $1`,
      [orderId],
    );
    expect(ev.payload.totals.grossWeightKg).toBe(129.75);
    expect(ev.payload.packages).toHaveLength(2);
    await expect(comex.removeExportPackage(op, list!.packages[0].id)).rejects.toThrow(/já foi fechado/);
  });

  it("estufagem valida o contêiner ISO 6346 e então o pedido pode ser expedido", async () => {
    const op = env.as("operator");
    await expect(comex.stuffContainer(op, orderId, { containerNumber: "MSCU1234567", sealNumber: "L1" })).rejects.toThrow(/ISO 6346/);
    await comex.stuffContainer(op, orderId, { containerNumber: "MSCU1234566", sealNumber: "LACRE-7781" });
    const shipped = await outbound.shipOrder(op, orderId, {});
    expect(shipped).toBeTruthy();
    const o = await env.one<{ status: string; container_number: string }>(`select status, container_number from wms.outbound_orders where id = $1`, [orderId]);
    expect(o).toEqual({ status: "shipped", container_number: "MSCU1234566" });
  });
});

describe("Abastecimento de produção (requisição de materiais do MRP)", () => {
  let env: TestEnv;
  let reqId: string;
  let lineLocation: string;

  beforeAll(async () => {
    env = await createTestEnv();
    lineLocation = await env.location(LINE);
  });

  async function newProductionOrder(number: string, components: [string, number][]) {
    const c = await env.id(`select id from erp.companies limit 1`);
    const op = await env.id(
      `insert into erp.production_orders (company_id, number, product_id, quantity) values ($1, $2, $3, 1) returning id`,
      [c, number, await env.product("SUP-006")],
    );
    let n = 1;
    for (const [sku, q] of components) {
      await env.db.query(`insert into erp.production_order_components (production_order_id, line_no, product_id, quantity) values ($1,$2,$3,$4)`, [
        op,
        n++,
        await env.product(sku),
        q,
      ]);
    }
    return op;
  }

  it("recusa linha fora de zona de produção e ordem duplicada; operador não cria", async () => {
    const opId = await env.id(`select id from erp.production_orders where number = 'OP-2026-001'`);
    const sup = env.as("supervisor");
    await expect(production.createRequisition(env.as("operator"), { productionOrderId: opId, lineLocationId: lineLocation })).rejects.toThrow(
      /permissão/,
    );
    await expect(
      production.createRequisition(sup, { productionOrderId: opId, lineLocationId: await env.location("DEP-01/RUA-01/MOD-01/NIV-01/POS-00") }),
    ).rejects.toThrow(/zona de produção/);
    const r = await production.createRequisition(sup, { productionOrderId: opId, lineLocationId: lineLocation, allOrNothing: "on" });
    reqId = r.id;
    await expect(production.createRequisition(sup, { productionOrderId: opId, lineLocationId: lineLocation })).rejects.toThrow(/já possui/);
  });

  it("tudo ou nada: falta de um componente não deixa reserva alguma", async () => {
    const sup = env.as("supervisor");
    const op = await newProductionOrder("OP-T-ALL", [
      ["CHP-004", 5],
      ["CIA-001", 3],
    ]);
    const r = await production.createRequisition(sup, { productionOrderId: op, lineLocationId: lineLocation, allOrNothing: "on" });
    const before = await balanceOf(env, "CHP-004");
    await expect(production.reserveRequisition(sup, r.id)).rejects.toThrow(/tudo ou nada/);
    expect(await balanceOf(env, "CHP-004")).toEqual(before);
    const n = await env.one<{ n: number }>(`select count(*) as n from wms.production_reservations`);
    expect(n.n).toBe(0);
    await production.cancelRequisition(sup, r.id, { reason: "teste de tudo ou nada" });
  });

  it("sem tudo ou nada, a reserva para no disponível e nunca o ultrapassa", async () => {
    const sup = env.as("supervisor");
    const op = await newProductionOrder("OP-T-PART", [["CHP-004", 1000]]);
    const r = await production.createRequisition(sup, { productionOrderId: op, lineLocationId: lineLocation });
    const res = await production.reserveRequisition(sup, r.id);
    expect(res.shortages[0]).toMatch(/faltam 960 de 1000/);
    const line = await env.one<{ reserved_qty: number }>(
      `select reserved_qty from wms.production_requisition_lines where requisition_id = $1`,
      [r.id],
    );
    expect(line.reserved_qty).toBe(40);
    const b = await balanceOf(env, "CHP-004");
    expect(b.reserved).toBe(40);
    expect(b.reserved).toBeLessThanOrEqual(b.quantity);
    await expect(production.reserveRequisition(sup, r.id)).rejects.toThrow(/Nenhum saldo disponível/);
    await production.cancelRequisition(sup, r.id, { reason: "libera para o próximo teste" });
    expect((await balanceOf(env, "CHP-004")).reserved).toBe(0);
  });

  it("reserva FEFO, separa para a linha e confirma a entrega (production.materials_delivered)", async () => {
    const sup = env.as("supervisor");
    const op = env.as("operator");
    const res = await production.reserveRequisition(sup, reqId, { idempotencyKey: key() });
    expect(res.shortages).toHaveLength(0);
    const rel = await production.releaseRequisition(sup, reqId);
    expect(rel.tasks).toHaveLength(2);
    await expect(production.deliverToLine(op, reqId, { receivedBy: "Líder da linha" })).rejects.toThrow(/Conclua/);
    const picks = await env.db.query<{ id: string }>(`select id from wms.tasks where production_requisition_id = $1 and task_type = 'production_pick'`, [
      reqId,
    ]);
    await expect(tasks.cancelTask(sup, picks[0].id, { reason: "não pode cancelar" })).rejects.toThrow(/não podem ser canceladas/);
    for (const t of picks) await tasks.completeTask(op, t.id, {});
    const lineBal = await env.one<{ q: number; r: number }>(
      `select coalesce(sum(quantity),0) as q, coalesce(sum(reserved_qty),0) as r from wms.stock_balances where location_id = $1`,
      [lineLocation],
    );
    expect(lineBal).toEqual({ q: 7, r: 7 });
    const delivered = await production.deliverToLine(op, reqId, { receivedBy: "Líder da linha" });
    expect(delivered.items).toHaveLength(2);
    expect((await balanceOf(env, "CHP-004")).quantity).toBe(35);
    const ev = await env.one<{ n: number }>(
      `select count(*) as n from wms.integration_events where event_type = 'production.materials_delivered' and aggregate_id = $1`,
      [reqId],
    );
    expect(ev.n).toBe(1);
    const po = await env.one<{ status: string }>(`select status from erp.production_orders where number = 'OP-2026-001'`);
    expect(po.status).toBe("in_progress");
  });

  it("devolve sobras ao estoque sem ultrapassar o entregue", async () => {
    const op = env.as("operator");
    const req = await production.getRequisition(op, reqId);
    const chp = req!.lines.find((l) => l.sku === "CHP-004")!;
    const dest = await env.location("DEP-01/RUA-04/MOD-02/NIV-00/POS-00");
    await expect(production.returnLeftovers(op, reqId, { lineId: chp.id, quantity: 6, locationId: dest })).rejects.toThrow(/máximo 5/);
    await expect(production.returnLeftovers(op, reqId, { lineId: chp.id, lotCode: "X", quantity: 1, locationId: dest })).rejects.toThrow(
      /não foi entregue/,
    );
    await production.returnLeftovers(op, reqId, { lineId: chp.id, quantity: 2, locationId: dest });
    expect((await balanceOf(env, "CHP-004")).quantity).toBe(37);
    const line = await env.one<{ returned_qty: number }>(`select returned_qty from wms.production_requisition_lines where id = $1`, [chp.id]);
    expect(line.returned_qty).toBe(2);
    await expect(production.returnLeftovers(op, reqId, { lineId: chp.id, quantity: 4, locationId: dest })).rejects.toThrow(/máximo 3/);
    const ev = await env.one<{ n: number }>(`select count(*) as n from wms.integration_events where event_type = 'production.leftovers_returned'`);
    expect(ev.n).toBe(1);
  });

  it("produto acabado entra com o lote da ordem e vira armazenagem normal", async () => {
    const op = env.as("operator");
    await expect(production.receiveOutput(op, reqId, { quantity: 6 })).rejects.toThrow(/acima do saldo da ordem/);
    const out = await production.receiveOutput(op, reqId, { quantity: 5 });
    expect(out.lot).toBe("OP2026001");
    const putaway = await env.one<{ id: string; task_type: string; lot_code: string; suggested_location_id: string | null }>(
      `select id, task_type, lot_code, suggested_location_id from wms.tasks where production_requisition_id = $1 and task_type = 'putaway'`,
      [reqId],
    );
    expect(putaway).toMatchObject({ task_type: "putaway", lot_code: "OP2026001" });
    expect(putaway.suggested_location_id).not.toBeNull();
    await expect(production.completeRequisition(env.as("supervisor"), reqId)).rejects.toThrow(/tarefa\(s\) abertas/);
    await tasks.completeTask(op, putaway.id, {});
    expect((await balanceOf(env, "SUP-006")).quantity).toBe(5);
    const mv = await env.one<{ reference_type: string; movement_type: string }>(
      `select reference_type, movement_type from wms.stock_movements where task_id = $1`,
      [putaway.id],
    );
    expect(mv).toEqual({ reference_type: "production_requisition", movement_type: "putaway" });
    const ev = await env.one<{ n: number }>(`select count(*) as n from wms.integration_events where event_type = 'production.output_received'`);
    expect(ev.n).toBe(1);
    await production.completeRequisition(env.as("supervisor"), reqId);
    const po = await env.one<{ status: string }>(`select status from erp.production_orders where number = 'OP-2026-001'`);
    expect(po.status).toBe("completed");
  });

  it("o banco impede devolver mais do que foi entregue", async () => {
    await expect(
      env.db.query(`update wms.production_requisition_lines set returned_qty = delivered_qty + 1 where requisition_id = $1`, [reqId]),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
