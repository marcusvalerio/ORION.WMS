import "server-only";
import { z } from "zod";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError, NotFoundError } from "../errors";
import { parse, uuid, optionalUuid } from "../validation";
import { parseNfeXml, type NfeLot } from "../integrations/nfe/parser";
import { audit, nextCode, round3, runOperation, type OpOptions } from "./common";
import { createPoReceiptInTx, purchaseOrderBalance, type PoReceiptLine } from "./receiving";

/**
 * Importação de NF-e (XML) para criação de recebimentos.
 * Casamento: emitente → fornecedor por CNPJ; item → produto por EAN (produto ou
 * embalagem), depois pelo de-para fornecedor × código (wms.supplier_product_codes),
 * que o usuário confirma e fica salvo para as próximas notas.
 */

interface ImportHeader {
  id: string;
  status: "pending" | "received" | "discarded";
  supplier_id: string | null;
  emitter_cnpj: string;
  number: string;
  access_key: string;
  receipt_id: string | null;
  purchase_order_id: string | null;
}

async function lockImport(tx: Queryable, ctx: Ctx, id: string): Promise<ImportHeader> {
  const [row] = await tx.query<ImportHeader>(
    `select id, status, supplier_id, emitter_cnpj, number, access_key, receipt_id, purchase_order_id
     from wms.nfe_imports where id = $1 and company_id = $2 for update`,
    [id, ctx.user.companyId],
  );
  if (!row) throw new NotFoundError("Importação de NF-e");
  return row;
}

function requirePending(h: ImportHeader) {
  if (h.status !== "pending") throw new DomainError(`A NF-e ${h.number} não está mais pendente.`, "INVALID_STATUS");
}

/** Fator de conversão da unidade comercial da NF para a unidade base do produto. */
async function unitFactor(tx: Queryable, productId: string, unit: string): Promise<number> {
  const [row] = await tx.query<{ uom: string; factor: number | null }>(
    `select p.uom, (select units_per_package from wms.packaging_units u where u.product_id = p.id and upper(u.code) = $2 and u.active limit 1) as factor
     from erp.products p where p.id = $1`,
    [productId, unit.toUpperCase()],
  );
  if (!row || row.uom.toUpperCase() === unit.toUpperCase()) return 1;
  return row.factor ?? 1;
}

async function matchProduct(
  tx: Queryable,
  companyId: string,
  supplierId: string | null,
  item: { ean: string | null; supplierCode: string },
): Promise<{ productId: string; source: "ean" | "supplier_code"; factor?: number } | null> {
  if (item.ean) {
    const [p] = await tx.query<{ id: string }>(
      `select id from erp.products where company_id = $1 and barcode = $2 and status = 'active'`,
      [companyId, item.ean],
    );
    if (p) return { productId: p.id, source: "ean" };
    const [pk] = await tx.query<{ product_id: string; units_per_package: number }>(
      `select product_id, units_per_package from wms.packaging_units where company_id = $1 and barcode = $2 and active limit 1`,
      [companyId, item.ean],
    );
    if (pk) return { productId: pk.product_id, source: "ean", factor: pk.units_per_package };
  }
  if (supplierId) {
    const [m] = await tx.query<{ product_id: string }>(
      `select product_id from wms.supplier_product_codes where company_id = $1 and supplier_id = $2 and supplier_code = $3`,
      [companyId, supplierId, item.supplierCode],
    );
    if (m) return { productId: m.product_id, source: "supplier_code" };
  }
  return null;
}

async function rematchItems(tx: Queryable, ctx: Ctx, importId: string, supplierId: string | null) {
  const items = await tx.query<{ id: string; ean: string | null; supplier_code: string; unit: string }>(
    `select id, ean, supplier_code, unit from wms.nfe_import_items where import_id = $1 and product_id is null`,
    [importId],
  );
  for (const i of items) {
    const m = await matchProduct(tx, ctx.user.companyId, supplierId, { ean: i.ean, supplierCode: i.supplier_code });
    if (!m) continue;
    const factor = m.factor ?? (await unitFactor(tx, m.productId, i.unit));
    await tx.query(`update wms.nfe_import_items set product_id = $2, match_source = $3, units_factor = $4 where id = $1`, [
      i.id,
      m.productId,
      m.source,
      factor,
    ]);
  }
}

const importSchema = z.object({ xml: z.string({ error: "Selecione o arquivo XML da NF-e." }).min(1, "Selecione o arquivo XML da NF-e.") });

/** Lê o XML, valida e grava a NF-e com o casamento automático de fornecedor, pedido e itens. */
export async function importNfe(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "receipt.create");
  const d = parse(importSchema, input);
  const nfe = parseNfeXml(d.xml);
  return runOperation(ctx, "nfe.import", opts, async (tx) => {
    const [existing] = await tx.query<{ id: string; status: string; receipt_code: string | null }>(
      `select i.id, i.status, r.code as receipt_code from wms.nfe_imports i left join wms.receipts r on r.id = i.receipt_id
       where i.company_id = $1 and i.access_key = $2 and i.status <> 'discarded' for update of i`,
      [ctx.user.companyId, nfe.accessKey],
    );
    if (existing?.status === "pending") return { id: existing.id, duplicate: true };
    if (existing) throw new DomainError(`Esta NF-e já foi recebida no ${existing.receipt_code}.`, "DUPLICATE");

    const [supplier] = await tx.query<{ id: string }>(`select id from erp.suppliers where company_id = $1 and cnpj = $2`, [
      ctx.user.companyId,
      nfe.emitter.cnpj,
    ]);
    let purchaseOrderId: string | null = null;
    if (supplier) {
      const refs = [...new Set(nfe.items.map((i) => i.poNumberRef).filter(Boolean))] as string[];
      const open = await tx.query<{ id: string; number: string }>(
        `select id, number from erp.purchase_orders where company_id = $1 and supplier_id = $2 and status in ('open', 'partially_received')
         order by issue_date, number`,
        [ctx.user.companyId, supplier.id],
      );
      purchaseOrderId = open.find((p) => refs.includes(p.number))?.id ?? (open.length === 1 ? open[0].id : null);
    }
    const [row] = await tx.query<{ id: string }>(
      `insert into wms.nfe_imports (company_id, access_key, number, series, issued_at, emitter_cnpj, emitter_name, supplier_id,
                                    purchase_order_id, xml, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [
        ctx.user.companyId,
        nfe.accessKey,
        nfe.number,
        nfe.series,
        nfe.issuedAt,
        nfe.emitter.cnpj,
        nfe.emitter.name,
        supplier?.id ?? null,
        purchaseOrderId,
        d.xml,
        ctx.user.id,
      ],
    );
    for (const item of nfe.items) {
      await tx.query(
        `insert into wms.nfe_import_items (import_id, item_no, supplier_code, ean, description, quantity, unit, lots, po_number_ref)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [row.id, item.itemNo, item.supplierCode, item.ean, item.description, item.quantity, item.unit, JSON.stringify(item.lots), item.poNumberRef],
      );
    }
    await rematchItems(tx, ctx, row.id, supplier?.id ?? null);
    await audit(tx, ctx, "nfe.imported", "nfe_import", row.id, `NF ${nfe.number}/${nfe.series}`, {
      accessKey: nfe.accessKey,
      emitter: nfe.emitter,
      items: nfe.items.length,
      supplierMatched: !!supplier,
    });
    return { id: row.id, duplicate: false };
  });
}

/** Vincula o emitente a um fornecedor; grava o CNPJ no fornecedor do ERP local se ele ainda não tiver. */
export async function linkNfeSupplier(ctx: Ctx, importId: string, input: unknown) {
  assertCan(ctx, "receipt.create");
  const d = parse(z.object({ supplierId: uuid("Fornecedor") }), input);
  return runOperation(ctx, "nfe.link_supplier", undefined, async (tx) => {
    const h = await lockImport(tx, ctx, importId);
    requirePending(h);
    const [s] = await tx.query<{ id: string; cnpj: string | null; name: string }>(
      `select id, cnpj, name from erp.suppliers where id = $1 and company_id = $2 for update`,
      [d.supplierId, ctx.user.companyId],
    );
    if (!s) throw new NotFoundError("Fornecedor");
    if (s.cnpj && s.cnpj !== h.emitter_cnpj) {
      throw new DomainError(`O fornecedor ${s.name} já possui outro CNPJ (${s.cnpj}).`, "VALIDATION");
    }
    if (!s.cnpj) await tx.query(`update erp.suppliers set cnpj = $2 where id = $1`, [s.id, h.emitter_cnpj]);
    await tx.query(`update wms.nfe_imports set supplier_id = $2 where id = $1`, [importId, s.id]);
    await rematchItems(tx, ctx, importId, s.id);
    await audit(tx, ctx, "nfe.supplier_linked", "nfe_import", importId, `NF ${h.number}`, { supplier: s.name, cnpj: h.emitter_cnpj });
    return { id: importId };
  });
}

/** Confirma o produto de um item da NF; o de-para fornecedor × código fica salvo. */
export async function linkNfeItem(ctx: Ctx, itemId: string, input: unknown) {
  assertCan(ctx, "receipt.create");
  const d = parse(z.object({ productId: uuid("Produto") }), input);
  return runOperation(ctx, "nfe.link_item", undefined, async (tx) => {
    const [item] = await tx.query<{ id: string; import_id: string; supplier_code: string; unit: string }>(
      `select i.id, i.import_id, i.supplier_code, i.unit from wms.nfe_import_items i join wms.nfe_imports n on n.id = i.import_id
       where i.id = $1 and n.company_id = $2`,
      [itemId, ctx.user.companyId],
    );
    if (!item) throw new NotFoundError("Item da NF-e");
    const h = await lockImport(tx, ctx, item.import_id);
    requirePending(h);
    if (!h.supplier_id) throw new DomainError("Vincule primeiro o emitente a um fornecedor.", "VALIDATION");
    const [p] = await tx.query<{ sku: string }>(`select sku from erp.products where id = $1 and company_id = $2 and status = 'active'`, [
      d.productId,
      ctx.user.companyId,
    ]);
    if (!p) throw new NotFoundError("Produto");
    await tx.query(
      `insert into wms.supplier_product_codes (company_id, supplier_id, supplier_code, product_id, confirmed_by)
       values ($1,$2,$3,$4,$5)
       on conflict (company_id, supplier_id, supplier_code)
       do update set product_id = excluded.product_id, confirmed_by = excluded.confirmed_by, updated_at = now()`,
      [ctx.user.companyId, h.supplier_id, item.supplier_code, d.productId, ctx.user.id],
    );
    const factor = await unitFactor(tx, d.productId, item.unit);
    // Aplica a todos os itens desta NF com o mesmo código do fornecedor.
    await tx.query(
      `update wms.nfe_import_items set product_id = $3, match_source = 'manual', units_factor = $4
       where import_id = $1 and supplier_code = $2`,
      [h.id, item.supplier_code, d.productId, factor],
    );
    await audit(tx, ctx, "nfe.item_linked", "nfe_import", h.id, `NF ${h.number}`, { supplierCode: item.supplier_code, sku: p.sku });
    return { id: h.id };
  });
}

export async function setNfePurchaseOrder(ctx: Ctx, importId: string, input: unknown) {
  assertCan(ctx, "receipt.create");
  const d = parse(z.object({ purchaseOrderId: optionalUuid }), input);
  return runOperation(ctx, "nfe.set_po", undefined, async (tx) => {
    const h = await lockImport(tx, ctx, importId);
    requirePending(h);
    if (d.purchaseOrderId) {
      const [po] = await tx.query<{ supplier_id: string; status: string }>(
        `select supplier_id, status from erp.purchase_orders where id = $1 and company_id = $2`,
        [d.purchaseOrderId, ctx.user.companyId],
      );
      if (!po) throw new NotFoundError("Pedido de compra");
      if (po.supplier_id !== h.supplier_id) throw new DomainError("O pedido de compra é de outro fornecedor.", "VALIDATION");
      if (!["open", "partially_received"].includes(po.status)) throw new DomainError("O pedido de compra não está aberto.");
    }
    await tx.query(`update wms.nfe_imports set purchase_order_id = $2 where id = $1`, [importId, d.purchaseOrderId ?? null]);
    return { id: importId };
  });
}

export async function discardNfe(ctx: Ctx, importId: string) {
  assertCan(ctx, "receipt.create");
  return runOperation(ctx, "nfe.discard", undefined, async (tx) => {
    const h = await lockImport(tx, ctx, importId);
    requirePending(h);
    await tx.query(`update wms.nfe_imports set status = 'discarded' where id = $1`, [importId]);
    await audit(tx, ctx, "nfe.discarded", "nfe_import", importId, `NF ${h.number}`);
    return { id: importId };
  });
}

interface ImportItemRow {
  id: string;
  item_no: number;
  supplier_code: string;
  ean: string | null;
  description: string;
  quantity: number;
  unit: string;
  units_factor: number;
  lots: NfeLot[];
  po_number_ref: string | null;
  product_id: string | null;
  match_source: string | null;
  sku: string | null;
  product_description: string | null;
  uom: string | null;
}

const createSchema = z.object({
  warehouseId: uuid("Depósito de destino"),
  appointmentId: optionalUuid,
});

/**
 * Cria o recebimento a partir da NF-e: uma linha por lote (rastro), com lote e
 * validade pré-preenchidos. Com pedido de compra, cada linha consome o saldo
 * pendente do item correspondente; o que a NF traz além do pedido entra com
 * previsto limitado ao saldo (e vira sobra se for conferido).
 */
export async function createReceiptFromNfe(ctx: Ctx, importId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "receipt.create");
  const d = parse(createSchema, input);
  return runOperation(ctx, "nfe.create_receipt", opts, async (tx) => {
    const h = await lockImport(tx, ctx, importId);
    requirePending(h);
    if (!h.supplier_id) throw new DomainError("Vincule o emitente da NF-e a um fornecedor antes de receber.", "NFE_UNLINKED");
    const items = await tx.query<ImportItemRow>(
      `select id, item_no, supplier_code, ean, description, quantity, unit, units_factor, lots, po_number_ref, product_id, match_source,
              null as sku, null as product_description, null as uom
       from wms.nfe_import_items where import_id = $1 order by item_no`,
      [importId],
    );
    const unlinked = items.filter((i) => !i.product_id);
    if (unlinked.length) {
      throw new DomainError(
        `Itens pendentes de vínculo: ${unlinked.map((i) => `${i.item_no} (${i.supplier_code})`).join(", ")}.`,
        "NFE_UNLINKED",
      );
    }
    // Uma linha por lote (ou uma linha sem lote).
    const raw = items.flatMap((i) =>
      (i.lots.length ? i.lots : [{ lot: "", quantity: i.quantity, expiryDate: null, manufacturedAt: null }]).map((l) => ({
        productId: i.product_id!,
        quantity: round3(l.quantity * i.units_factor),
        lotCode: l.lot,
        expiryDate: l.expiryDate,
      })),
    );
    const invoiceNumber = `NF ${h.number}`;
    let receipt: { id: string; code: string };
    if (h.purchase_order_id) {
      // Bloqueia o pedido antes de ler o saldo (mesmo lock usado por createPoReceiptInTx).
      await tx.query(`select id from erp.purchase_orders where id = $1 for update`, [h.purchase_order_id]);
      const balance = await purchaseOrderBalance(tx, h.purchase_order_id);
      const remaining = new Map(balance.map((b) => [b.purchase_order_item_id, b.pending]));
      const lines: PoReceiptLine[] = raw.map((l) => {
        const candidate = balance.find((b) => b.product_id === l.productId && (remaining.get(b.purchase_order_item_id) ?? 0) > 0)
          ?? balance.find((b) => b.product_id === l.productId);
        if (!candidate) return { ...l, purchaseOrderItemId: null, quantity: 0 };
        const left = remaining.get(candidate.purchase_order_item_id) ?? 0;
        const take = round3(Math.min(left, l.quantity));
        remaining.set(candidate.purchase_order_item_id, round3(left - take));
        return take > 0 ? { ...l, purchaseOrderItemId: candidate.purchase_order_item_id, quantity: take } : { ...l, purchaseOrderItemId: null, quantity: 0 };
      });
      receipt = await createPoReceiptInTx(tx, ctx, {
        purchaseOrderId: h.purchase_order_id,
        warehouseId: d.warehouseId,
        invoiceNumber,
        invoiceKey: h.access_key,
        notes: `Criado a partir do XML da NF-e ${h.number}.`,
        appointmentId: d.appointmentId ?? null,
        nfeImportId: h.id,
        lines,
      });
    } else {
      const [wh] = await tx.query<{ active: boolean }>(`select active from wms.warehouses where id = $1 and company_id = $2`, [
        d.warehouseId,
        ctx.user.companyId,
      ]);
      if (!wh) throw new NotFoundError("Depósito");
      if (!wh.active) throw new DomainError("Depósito inativo.");
      if (d.appointmentId) throw new DomainError("Agendamento só pode ser vinculado a recebimento de pedido de compra.");
      const code = await nextCode(tx, ctx.user.companyId, "REC");
      const [company] = await tx.query<{ is_demo: boolean }>(`select is_demo from erp.companies where id = $1`, [ctx.user.companyId]);
      const [r] = await tx.query<{ id: string }>(
        `insert into wms.receipts (company_id, warehouse_id, code, supplier_id, invoice_number, invoice_key, notes, is_demo, created_by, nfe_import_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [ctx.user.companyId, d.warehouseId, code, h.supplier_id, invoiceNumber, h.access_key, `Criado a partir do XML da NF-e ${h.number} (sem pedido).`, company?.is_demo ?? false, ctx.user.id, h.id],
      );
      let lineNo = 1;
      for (const l of raw) {
        await tx.query(
          `insert into wms.receipt_items (receipt_id, line_no, product_id, expected_qty, lot_code, expiry_date) values ($1,$2,$3,$4,$5,$6)`,
          [r.id, lineNo++, l.productId, l.quantity, l.lotCode, l.expiryDate],
        );
      }
      await audit(tx, ctx, "receipt.created", "receipt", r.id, code, { nfe: h.access_key, items: raw.length });
      receipt = { id: r.id, code };
    }
    await tx.query(`update wms.nfe_imports set status = 'received', receipt_id = $2 where id = $1`, [importId, receipt.id]);
    await audit(tx, ctx, "nfe.received", "nfe_import", importId, `NF ${h.number}`, { receipt: receipt.code });
    return receipt;
  });
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export async function listNfeImports(ctx: Ctx) {
  return ctx.db.query<{
    id: string;
    number: string;
    series: string;
    emitter_name: string;
    status: string;
    created_at: string;
    receipt_code: string | null;
    pending_links: number;
  }>(
    `select n.id, n.number, n.series, n.emitter_name, n.status, n.created_at::text as created_at, r.code as receipt_code,
            (select count(*) from wms.nfe_import_items i where i.import_id = n.id and i.product_id is null) as pending_links
     from wms.nfe_imports n left join wms.receipts r on r.id = n.receipt_id
     where n.company_id = $1 order by n.created_at desc limit 50`,
    [ctx.user.companyId],
  );
}

export interface NfeComparisonRow {
  product_id: string;
  sku: string;
  description: string;
  ordered: number | null;
  pending: number | null;
  nfe_qty: number;
  /** NF − saldo pendente (positivo: NF traz além do pedido). */
  difference: number | null;
}

export async function getNfe(ctx: Ctx, id: string) {
  const [h] = await ctx.db.query<{
    id: string;
    access_key: string;
    number: string;
    series: string;
    issued_at: string | null;
    emitter_cnpj: string;
    emitter_name: string;
    supplier_id: string | null;
    supplier_name: string | null;
    purchase_order_id: string | null;
    po_number: string | null;
    receipt_id: string | null;
    receipt_code: string | null;
    status: "pending" | "received" | "discarded";
    created_at: string;
  }>(
    `select n.id, n.access_key, n.number, n.series, n.issued_at::text as issued_at, n.emitter_cnpj, n.emitter_name, n.supplier_id,
            s.name as supplier_name, n.purchase_order_id, po.number as po_number, n.receipt_id, r.code as receipt_code, n.status,
            n.created_at::text as created_at
     from wms.nfe_imports n left join erp.suppliers s on s.id = n.supplier_id
     left join erp.purchase_orders po on po.id = n.purchase_order_id left join wms.receipts r on r.id = n.receipt_id
     where n.id = $1 and n.company_id = $2`,
    [id, ctx.user.companyId],
  );
  if (!h) return null;
  const items = await ctx.db.query<ImportItemRow>(
    `select i.id, i.item_no, i.supplier_code, i.ean, i.description, i.quantity, i.unit, i.units_factor, i.lots, i.po_number_ref,
            i.product_id, i.match_source, p.sku, p.description as product_description, p.uom
     from wms.nfe_import_items i left join erp.products p on p.id = i.product_id where i.import_id = $1 order by i.item_no`,
    [id],
  );
  const comparison: NfeComparisonRow[] = [];
  const nfeByProduct = new Map<string, number>();
  for (const i of items) if (i.product_id) nfeByProduct.set(i.product_id, round3((nfeByProduct.get(i.product_id) ?? 0) + i.quantity * i.units_factor));
  if (h.purchase_order_id) {
    const balance = await purchaseOrderBalance(ctx.db, h.purchase_order_id);
    const seen = new Set<string>();
    for (const b of balance) {
      if (seen.has(b.product_id)) continue;
      seen.add(b.product_id);
      const same = balance.filter((x) => x.product_id === b.product_id);
      const pending = round3(same.reduce((a, x) => a + x.pending, 0));
      const nfeQty = nfeByProduct.get(b.product_id) ?? 0;
      comparison.push({
        product_id: b.product_id,
        sku: b.sku,
        description: b.description,
        ordered: round3(same.reduce((a, x) => a + x.ordered, 0)),
        pending,
        nfe_qty: nfeQty,
        difference: round3(nfeQty - pending),
      });
    }
  }
  for (const i of items) {
    if (!i.product_id || comparison.some((c) => c.product_id === i.product_id)) continue;
    comparison.push({
      product_id: i.product_id,
      sku: i.sku!,
      description: i.product_description!,
      ordered: null,
      pending: null,
      nfe_qty: nfeByProduct.get(i.product_id) ?? 0,
      difference: null,
    });
  }
  const purchaseOrders = h.supplier_id
    ? await ctx.db.query<{ id: string; number: string; status: string }>(
        `select id, number, status from erp.purchase_orders where company_id = $1 and supplier_id = $2 and status in ('open', 'partially_received')
         order by number`,
        [ctx.user.companyId, h.supplier_id],
      )
    : [];
  return { ...h, items, comparison, purchaseOrders };
}
