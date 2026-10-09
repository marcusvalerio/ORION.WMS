import "server-only";
import { z } from "zod";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError, NotFoundError } from "../errors";
import { parse, uuid, optionalText, optionalDate, qty, nonNegQty } from "../validation";
import * as erp from "../integrations/erp/gateway";
import { audit, enqueueIntegrationEvent, nextCode, recordTaskEvent, round3, runOperation, type OpOptions } from "./common";
import { getProductRules, suggestLocations } from "./stock-core";

export const RECEIPT_STATUSES = ["expected", "checking", "checked", "released", "completed", "cancelled"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

interface ReceiptHeader {
  id: string;
  code: string;
  status: ReceiptStatus;
  warehouse_id: string;
  purchase_order_id: string | null;
  supplier_id: string;
  is_demo: boolean;
}

async function lockReceipt(tx: Queryable, ctx: Ctx, id: string): Promise<ReceiptHeader> {
  const [r] = await tx.query<ReceiptHeader>(
    `select id, code, status, warehouse_id, purchase_order_id, supplier_id, is_demo
     from wms.receipts where id = $1 and company_id = $2 for update`,
    [id, ctx.user.companyId],
  );
  if (!r) throw new NotFoundError("Recebimento");
  return r;
}

function requireStatus(r: ReceiptHeader, allowed: ReceiptStatus[], action: string) {
  if (!allowed.includes(r.status)) {
    throw new DomainError(`Não é possível ${action}: o recebimento ${r.code} está com status "${r.status}".`, "INVALID_STATUS");
  }
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export interface ReceiptListRow {
  id: string;
  code: string;
  status: ReceiptStatus;
  supplier_name: string;
  po_number: string | null;
  invoice_number: string | null;
  warehouse_code: string;
  arrived_at: string | null;
  created_at: string;
  expected_total: number;
  counted_total: number | null;
  open_divergences: number;
  pending_putaway: number;
  is_demo: boolean;
}

export async function listReceipts(ctx: Ctx, f: { status?: string | null; q?: string | null } = {}) {
  const statuses = f.status ? f.status.split(",") : null;
  return ctx.db.query<ReceiptListRow>(
    `select r.id, r.code, r.status, s.name as supplier_name, po.number as po_number, r.invoice_number,
            w.code as warehouse_code, r.arrived_at::text as arrived_at, r.created_at::text as created_at, r.is_demo,
            coalesce((select sum(expected_qty) from wms.receipt_items i where i.receipt_id = r.id), 0) as expected_total,
            (select sum(counted_qty) from wms.receipt_items i where i.receipt_id = r.id) as counted_total,
            (select count(*) from wms.divergences d where d.receipt_id = r.id and d.status = 'open') as open_divergences,
            coalesce((select sum(released_qty - putaway_qty) from wms.receipt_items i where i.receipt_id = r.id), 0) as pending_putaway
     from wms.receipts r
     join erp.suppliers s on s.id = r.supplier_id
     join wms.warehouses w on w.id = r.warehouse_id
     left join erp.purchase_orders po on po.id = r.purchase_order_id
     where r.company_id = $1
       and ($2::text[] is null or r.status = any($2::text[]))
       and ($3::text is null or r.code ilike '%' || $3 || '%' or s.name ilike '%' || $3 || '%'
            or po.number ilike '%' || $3 || '%' or r.invoice_number ilike '%' || $3 || '%')
     order by r.created_at desc`,
    [ctx.user.companyId, statuses, f.q || null],
  );
}

export interface ReceiptItemRow {
  id: string;
  line_no: number;
  product_id: string;
  sku: string;
  description: string;
  uom: string;
  lot_controlled: boolean;
  expiry_controlled: boolean;
  expected_qty: number;
  counted_qty: number | null;
  damaged_qty: number;
  quality_hold_qty: number;
  lot_code: string;
  expiry_date: string | null;
  released_qty: number;
  putaway_qty: number;
  notes: string | null;
  counted_by_name: string | null;
}

export async function getReceipt(ctx: Ctx, id: string) {
  const [header] = await ctx.db.query<{
    id: string;
    code: string;
    status: ReceiptStatus;
    warehouse_id: string;
    warehouse_code: string;
    warehouse_name: string;
    purchase_order_id: string | null;
    po_number: string | null;
    supplier_name: string;
    supplier_document: string | null;
    invoice_number: string | null;
    invoice_key: string | null;
    arrived_at: string | null;
    check_started_at: string | null;
    checked_at: string | null;
    released_at: string | null;
    completed_at: string | null;
    checker_name: string | null;
    created_by_name: string;
    created_at: string;
    notes: string | null;
    is_demo: boolean;
  }>(
    `select r.id, r.code, r.status, r.warehouse_id, w.code as warehouse_code, w.name as warehouse_name, r.purchase_order_id,
            po.number as po_number, s.name as supplier_name, s.document as supplier_document, r.invoice_number, r.invoice_key,
            r.arrived_at::text as arrived_at, r.check_started_at::text as check_started_at, r.checked_at::text as checked_at,
            r.released_at::text as released_at, r.completed_at::text as completed_at, cu.name as checker_name,
            u.name as created_by_name, r.created_at::text as created_at, r.notes, r.is_demo
     from wms.receipts r
     join wms.warehouses w on w.id = r.warehouse_id
     join erp.suppliers s on s.id = r.supplier_id
     join wms.users u on u.id = r.created_by
     left join wms.users cu on cu.id = r.checker_id
     left join erp.purchase_orders po on po.id = r.purchase_order_id
     where r.id = $1 and r.company_id = $2`,
    [id, ctx.user.companyId],
  );
  if (!header) return null;
  const items = await ctx.db.query<ReceiptItemRow>(
    `select i.id, i.line_no, i.product_id, p.sku, p.description, p.uom,
            coalesce(s.lot_controlled, false) as lot_controlled, coalesce(s.expiry_controlled, false) as expiry_controlled,
            i.expected_qty, i.counted_qty, i.damaged_qty, i.quality_hold_qty, i.lot_code, i.expiry_date::text as expiry_date,
            i.released_qty, i.putaway_qty, i.notes, u.name as counted_by_name
     from wms.receipt_items i
     join erp.products p on p.id = i.product_id
     left join wms.product_settings s on s.product_id = p.id
     left join wms.users u on u.id = i.counted_by
     where i.receipt_id = $1 order by i.line_no`,
    [id],
  );
  return { ...header, items };
}

// -----------------------------------------------------------------------------
// Criação / importação
// -----------------------------------------------------------------------------

const fromPoSchema = z.object({
  purchaseOrderId: uuid("Pedido de compra"),
  warehouseId: uuid("Depósito de destino"),
  invoiceNumber: optionalText,
  invoiceKey: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v.replace(/\s/g, "") : null))
    .refine((v) => v === null || /^\d{44}$/.test(v), "Chave de acesso da NF-e deve ter 44 dígitos."),
  notes: optionalText,
});

/** Importa um pedido de compra do ERP como recebimento previsto. */
export async function createReceiptFromPurchaseOrder(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "receipt.create");
  const d = parse(fromPoSchema, input);
  return runOperation(ctx, "receipt.create_from_po", opts, async (tx) => {
    const po = await erp.getPurchaseOrder(tx, ctx.user.companyId, d.purchaseOrderId);
    if (!po) throw new NotFoundError("Pedido de compra");
    if (po.status === "cancelled" || po.status === "received") {
      throw new DomainError(`O pedido ${po.number} está ${po.status === "cancelled" ? "cancelado" : "totalmente recebido"}.`);
    }
    if (po.receipt_code) {
      throw new DomainError(`O pedido ${po.number} já possui o recebimento ${po.receipt_code}.`, "DUPLICATE");
    }
    await assertWarehouseActive(tx, ctx, d.warehouseId);
    const code = await nextCode(tx, ctx.user.companyId, "REC");
    const [isDemo] = await tx.query<{ is_demo: boolean }>(`select is_demo from erp.companies where id = $1`, [ctx.user.companyId]);
    const [r] = await tx.query<{ id: string }>(
      `insert into wms.receipts (company_id, warehouse_id, code, purchase_order_id, supplier_id, invoice_number, invoice_key,
                                 notes, is_demo, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [
        ctx.user.companyId,
        d.warehouseId,
        code,
        po.id,
        po.supplier_id,
        d.invoiceNumber ?? po.invoice_number,
        d.invoiceKey,
        d.notes,
        isDemo?.is_demo ?? false,
        ctx.user.id,
      ],
    );
    for (const item of po.items) {
      await tx.query(
        `insert into wms.receipt_items (receipt_id, line_no, product_id, purchase_order_item_id, expected_qty)
         values ($1,$2,$3,$4,$5)`,
        [r.id, item.line_no, item.product_id, item.id, item.quantity],
      );
    }
    await audit(tx, ctx, "receipt.created", "receipt", r.id, code, { purchaseOrder: po.number, items: po.items.length });
    return { id: r.id, code };
  });
}

const manualSchema = z.object({
  warehouseId: uuid("Depósito de destino"),
  supplierId: uuid("Fornecedor"),
  invoiceNumber: optionalText,
  notes: optionalText,
  items: z
    .array(z.object({ productId: uuid("Produto"), expectedQty: qty("Quantidade prevista") }))
    .min(1, "Informe ao menos um item."),
});

/** Recebimento sem pedido de compra (ex.: devolução ou entrada avulsa). */
export async function createManualReceipt(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "receipt.create");
  const d = parse(manualSchema, input);
  return runOperation(ctx, "receipt.create_manual", opts, async (tx) => {
    await assertWarehouseActive(tx, ctx, d.warehouseId);
    const [sup] = await tx.query(`select id from erp.suppliers where id = $1 and company_id = $2`, [d.supplierId, ctx.user.companyId]);
    if (!sup) throw new NotFoundError("Fornecedor");
    const code = await nextCode(tx, ctx.user.companyId, "REC");
    const [r] = await tx.query<{ id: string }>(
      `insert into wms.receipts (company_id, warehouse_id, code, supplier_id, invoice_number, notes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [ctx.user.companyId, d.warehouseId, code, d.supplierId, d.invoiceNumber, d.notes, ctx.user.id],
    );
    let line = 1;
    for (const item of d.items) {
      await getProductRules(tx, ctx.user.companyId, item.productId);
      await tx.query(`insert into wms.receipt_items (receipt_id, line_no, product_id, expected_qty) values ($1,$2,$3,$4)`, [
        r.id,
        line++,
        item.productId,
        item.expectedQty,
      ]);
    }
    await audit(tx, ctx, "receipt.created", "receipt", r.id, code, { manual: true, items: d.items.length });
    return { id: r.id, code };
  });
}

async function assertWarehouseActive(tx: Queryable, ctx: Ctx, warehouseId: string) {
  const [wh] = await tx.query<{ active: boolean }>(`select active from wms.warehouses where id = $1 and company_id = $2`, [
    warehouseId,
    ctx.user.companyId,
  ]);
  if (!wh) throw new NotFoundError("Depósito");
  if (!wh.active) throw new DomainError("Depósito inativo.");
}

// -----------------------------------------------------------------------------
// Conferência
// -----------------------------------------------------------------------------

export async function startCheck(ctx: Ctx, receiptId: string, opts?: OpOptions) {
  assertCan(ctx, "receipt.check");
  return runOperation(ctx, "receipt.start_check", opts, async (tx) => {
    const r = await lockReceipt(tx, ctx, receiptId);
    requireStatus(r, ["expected"], "iniciar a conferência");
    await tx.query(
      `update wms.receipts set status = 'checking', arrived_at = coalesce(arrived_at, now()), check_started_at = now(),
              checker_id = $2, updated_at = now(), version = version + 1 where id = $1`,
      [receiptId, ctx.user.id],
    );
    await audit(tx, ctx, "receipt.check_started", "receipt", receiptId, r.code);
    return { id: receiptId };
  });
}

const countSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: uuid("Item"),
        countedQty: z
          .union([z.literal("").transform(() => null), nonNegQty("Quantidade conferida")])
          .nullish()
          .transform((v) => (v === undefined ? null : v)),
        damagedQty: z.union([z.literal("").transform(() => 0), nonNegQty("Quantidade avariada")]).default(0),
        qualityHoldQty: z.union([z.literal("").transform(() => 0), nonNegQty("Quantidade retida")]).default(0),
        lotCode: z
          .string()
          .trim()
          .max(40)
          .nullish()
          .transform((v) => (v ?? "").toUpperCase()),
        expiryDate: optionalDate,
        notes: optionalText,
      }),
    )
    .min(1, "Nenhum item informado."),
});

/** Registra as quantidades físicas conferidas (pode ser salvo parcialmente). */
export async function saveCounts(ctx: Ctx, receiptId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "receipt.check");
  const d = parse(countSchema, input);
  return runOperation(ctx, "receipt.save_counts", opts, async (tx) => {
    const r = await lockReceipt(tx, ctx, receiptId);
    requireStatus(r, ["checking"], "registrar a contagem");
    for (const item of d.items) {
      if (item.countedQty !== null && item.damagedQty + item.qualityHoldQty > item.countedQty) {
        throw new DomainError("Avaria + retenção não podem superar a quantidade conferida.", "VALIDATION");
      }
      if (item.countedQty === null && (item.damagedQty > 0 || item.qualityHoldQty > 0)) {
        throw new DomainError("Informe a quantidade conferida antes de avarias ou retenções.", "VALIDATION");
      }
      const rows = await tx.query(
        `update wms.receipt_items set counted_qty = $3, damaged_qty = $4, quality_hold_qty = $5, lot_code = $6,
                expiry_date = $7, notes = $8, counted_by = $9, counted_at = now()
         where id = $1 and receipt_id = $2 returning id`,
        [
          item.itemId,
          receiptId,
          item.countedQty,
          item.damagedQty,
          item.qualityHoldQty,
          item.lotCode,
          item.expiryDate,
          item.notes,
          ctx.user.id,
        ],
      );
      if (!rows.length) throw new NotFoundError("Item do recebimento");
    }
    await audit(tx, ctx, "receipt.counts_saved", "receipt", receiptId, r.code, { items: d.items });
    return { id: receiptId };
  });
}

const divergenceSchema = z.object({
  itemId: optionalUuid(),
  divergenceType: z.enum(["shortage", "overage", "damage", "quality_hold", "other"], { error: "Tipo de divergência inválido." }),
  quantity: z.union([z.literal("").transform(() => null), nonNegQty()]).nullish(),
  description: z.string().trim().min(5, "Descreva a divergência (mínimo 5 caracteres).").max(1000),
});

function optionalUuid() {
  return z
    .string()
    .uuid()
    .nullish()
    .or(z.literal("").transform(() => null));
}

/** Registro manual de divergência/observação (ex.: embalagem violada, nota divergente). */
export async function addReceiptDivergence(ctx: Ctx, receiptId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "divergence.create");
  const d = parse(divergenceSchema, input);
  return runOperation(ctx, "receipt.add_divergence", opts, async (tx) => {
    const r = await lockReceipt(tx, ctx, receiptId);
    requireStatus(r, ["expected", "checking", "checked", "released"], "registrar divergência");
    let productId: string | null = null;
    if (d.itemId) {
      const [item] = await tx.query<{ product_id: string }>(
        `select product_id from wms.receipt_items where id = $1 and receipt_id = $2`,
        [d.itemId, receiptId],
      );
      if (!item) throw new NotFoundError("Item do recebimento");
      productId = item.product_id;
    }
    const [row] = await tx.query<{ id: string }>(
      `insert into wms.divergences (company_id, source, divergence_type, product_id, quantity, description, receipt_id,
                                    receipt_item_id, created_by)
       values ($1, 'receipt', $2, $3, $4, $5, $6, $7, $8) returning id`,
      [ctx.user.companyId, d.divergenceType, productId, d.quantity ?? null, d.description, receiptId, d.itemId ?? null, ctx.user.id],
    );
    await audit(tx, ctx, "receipt.divergence_added", "receipt", receiptId, r.code, d);
    return { id: row.id };
  });
}

/**
 * Finaliza a conferência: exige todas as quantidades e os dados de lote/validade
 * obrigatórios, e registra automaticamente faltas, sobras, avarias e retenções.
 */
export async function finishCheck(ctx: Ctx, receiptId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "receipt.check");
  const d = parse(z.object({ notes: optionalText }), input ?? {});
  return runOperation(ctx, "receipt.finish_check", opts, async (tx) => {
    const r = await lockReceipt(tx, ctx, receiptId);
    requireStatus(r, ["checking"], "finalizar a conferência");
    const items = await tx.query<{
      id: string;
      line_no: number;
      product_id: string;
      sku: string;
      expected_qty: number;
      counted_qty: number | null;
      damaged_qty: number;
      quality_hold_qty: number;
      lot_code: string;
      expiry_date: string | null;
      lot_controlled: boolean;
      expiry_controlled: boolean;
    }>(
      `select i.id, i.line_no, i.product_id, p.sku, i.expected_qty, i.counted_qty, i.damaged_qty, i.quality_hold_qty,
              i.lot_code, i.expiry_date::text as expiry_date,
              coalesce(s.lot_controlled, false) as lot_controlled, coalesce(s.expiry_controlled, false) as expiry_controlled
       from wms.receipt_items i join erp.products p on p.id = i.product_id
       left join wms.product_settings s on s.product_id = p.id
       where i.receipt_id = $1 order by i.line_no for update of i`,
      [receiptId],
    );
    const problems: string[] = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const i of items) {
      if (i.counted_qty === null) {
        problems.push(`linha ${i.line_no} (${i.sku}) sem quantidade conferida`);
        continue;
      }
      const accepted = i.counted_qty - i.damaged_qty - i.quality_hold_qty;
      if (accepted > 0 && i.lot_controlled && !i.lot_code) problems.push(`linha ${i.line_no} (${i.sku}) exige lote`);
      if (accepted > 0 && i.expiry_controlled && !i.expiry_date) problems.push(`linha ${i.line_no} (${i.sku}) exige validade`);
      if (accepted > 0 && i.expiry_date && i.expiry_date < today) {
        problems.push(`linha ${i.line_no} (${i.sku}) está vencida — registre como retida ou avariada`);
      }
    }
    if (problems.length) throw new DomainError(`Conferência incompleta: ${problems.join("; ")}.`, "INCOMPLETE_CHECK");

    let divergences = 0;
    const insertDiv = async (itemId: string, productId: string, type: string, q: number, text: string) => {
      divergences++;
      await tx.query(
        `insert into wms.divergences (company_id, source, divergence_type, product_id, quantity, description, receipt_id,
                                      receipt_item_id, created_by)
         values ($1, 'receipt', $2, $3, $4, $5, $6, $7, $8)`,
        [ctx.user.companyId, type, productId, q, text, receiptId, itemId, ctx.user.id],
      );
    };
    for (const i of items) {
      const counted = i.counted_qty ?? 0;
      const diff = round3(counted - i.expected_qty);
      if (diff < 0) await insertDiv(i.id, i.product_id, "shortage", -diff, `Falta de ${-diff} un em ${i.sku} (previsto ${i.expected_qty}, conferido ${counted}).`);
      if (diff > 0) await insertDiv(i.id, i.product_id, "overage", diff, `Sobra de ${diff} un em ${i.sku} (previsto ${i.expected_qty}, conferido ${counted}).`);
      if (i.damaged_qty > 0) await insertDiv(i.id, i.product_id, "damage", i.damaged_qty, `${i.damaged_qty} un de ${i.sku} avariadas na conferência.`);
      if (i.quality_hold_qty > 0)
        await insertDiv(i.id, i.product_id, "quality_hold", i.quality_hold_qty, `${i.quality_hold_qty} un de ${i.sku} retidas para inspeção de qualidade.`);
    }
    await tx.query(
      `update wms.receipts set status = 'checked', checked_at = now(), notes = coalesce($2, notes), updated_at = now(),
              version = version + 1 where id = $1`,
      [receiptId, d.notes],
    );
    await audit(tx, ctx, "receipt.check_finished", "receipt", receiptId, r.code, { divergences });
    return { id: receiptId, divergences };
  });
}

// -----------------------------------------------------------------------------
// Liberação e geração de tarefas de armazenagem
// -----------------------------------------------------------------------------

async function createPutawayTasks(
  tx: Queryable,
  ctx: Ctx,
  r: ReceiptHeader,
  item: { id: string; product_id: string; lot_code: string; expiry_date: string | null },
  quantity: number,
): Promise<string[]> {
  const rules = await getProductRules(tx, ctx.user.companyId, item.product_id);
  const chunk = rules.max_units_per_location ?? quantity;
  const created: string[] = [];
  let remaining = quantity;
  while (remaining > 0) {
    const q = round3(Math.min(chunk, remaining));
    remaining = round3(remaining - q);
    const suggestion = await suggestLocations(tx, ctx, {
      warehouseId: r.warehouse_id,
      productId: item.product_id,
      lotCode: item.lot_code,
      quantity: q,
    });
    const code = await nextCode(tx, ctx.user.companyId, "TAR");
    const [task] = await tx.query<{ id: string }>(
      `insert into wms.tasks (company_id, warehouse_id, code, task_type, priority, product_id, lot_code, expiry_date, quantity,
                              suggested_location_id, receipt_id, receipt_item_id, notes, created_by)
       values ($1,$2,$3,'putaway',2,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [
        ctx.user.companyId,
        r.warehouse_id,
        code,
        item.product_id,
        item.lot_code,
        item.expiry_date,
        q,
        suggestion.best?.id ?? null,
        r.id,
        item.id,
        suggestion.best ? null : `Sem sugestão automática: ${suggestion.reason}`,
        ctx.user.id,
      ],
    );
    await recordTaskEvent(tx, task.id, ctx.user.id, "created", null, "pending", {
      receipt: r.code,
      suggested: suggestion.best?.code ?? null,
      reason: suggestion.reason,
    });
    created.push(code);
  }
  return created;
}

/**
 * Libera os itens elegíveis (conferido − avariado − retido) e gera as tarefas de
 * armazenagem. Itens retidos por qualidade NÃO são liberados automaticamente.
 * O saldo de estoque só é criado quando a armazenagem é confirmada fisicamente.
 */
export async function releaseReceipt(ctx: Ctx, receiptId: string, opts?: OpOptions) {
  assertCan(ctx, "receipt.release");
  return runOperation(ctx, "receipt.release", opts, async (tx) => {
    const r = await lockReceipt(tx, ctx, receiptId);
    requireStatus(r, ["checked"], "liberar o recebimento");
    const items = await tx.query<{
      id: string;
      product_id: string;
      lot_code: string;
      expiry_date: string | null;
      counted_qty: number;
      damaged_qty: number;
      quality_hold_qty: number;
    }>(
      `select id, product_id, lot_code, expiry_date::text as expiry_date, counted_qty, damaged_qty, quality_hold_qty
       from wms.receipt_items where receipt_id = $1 order by line_no for update`,
      [receiptId],
    );
    const tasks: string[] = [];
    for (const item of items) {
      const eligible = round3(item.counted_qty - item.damaged_qty - item.quality_hold_qty);
      if (eligible <= 0) continue;
      tasks.push(...(await createPutawayTasks(tx, ctx, r, item, eligible)));
      await tx.query(`update wms.receipt_items set released_qty = released_qty + $2 where id = $1`, [item.id, eligible]);
    }
    const nextStatus = tasks.length ? "released" : "completed";
    await tx.query(
      `update wms.receipts set status = $2, released_at = now(), completed_at = case when $2 = 'completed' then now() end,
              updated_at = now(), version = version + 1 where id = $1`,
      [receiptId, nextStatus],
    );
    await audit(tx, ctx, "receipt.released", "receipt", receiptId, r.code, { tasks });
    if (nextStatus === "completed") await onReceiptCompleted(tx, ctx, receiptId);
    return { id: receiptId, tasks };
  });
}

const qualitySchema = z.object({
  quantity: qty(),
  justification: z.string().trim().min(10, "Justificativa deve ter ao menos 10 caracteres.").max(1000),
});

/** Liberação de quantidade retida por qualidade (somente supervisores), gerando armazenagem. */
export async function releaseQualityHold(ctx: Ctx, receiptItemId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "quality.release");
  const d = parse(qualitySchema, input);
  return runOperation(ctx, "receipt.quality_release", opts, async (tx) => {
    const [item] = await tx.query<{
      id: string;
      receipt_id: string;
      product_id: string;
      lot_code: string;
      expiry_date: string | null;
      quality_hold_qty: number;
    }>(
      `select i.id, i.receipt_id, i.product_id, i.lot_code, i.expiry_date::text as expiry_date, i.quality_hold_qty
       from wms.receipt_items i join wms.receipts r on r.id = i.receipt_id
       where i.id = $1 and r.company_id = $2`,
      [receiptItemId, ctx.user.companyId],
    );
    if (!item) throw new NotFoundError("Item do recebimento");
    const r = await lockReceipt(tx, ctx, item.receipt_id);
    requireStatus(r, ["released", "completed"], "liberar retenção de qualidade");
    if (d.quantity > item.quality_hold_qty) {
      throw new DomainError(`Quantidade acima do retido (${item.quality_hold_qty} un).`, "VALIDATION");
    }
    const tasks = await createPutawayTasks(tx, ctx, r, item, d.quantity);
    await tx.query(
      `update wms.receipt_items set quality_hold_qty = quality_hold_qty - $2, released_qty = released_qty + $2 where id = $1`,
      [item.id, d.quantity],
    );
    if (r.status === "completed") {
      await tx.query(`update wms.receipts set status = 'released', completed_at = null, updated_at = now() where id = $1`, [r.id]);
    }
    await audit(tx, ctx, "receipt.quality_released", "receipt", r.id, r.code, { ...d, item: item.id, tasks });
    return { id: r.id, tasks };
  });
}

export async function cancelReceipt(ctx: Ctx, receiptId: string, input: unknown) {
  assertCan(ctx, "receipt.release");
  const d = parse(z.object({ reason: z.string().trim().min(5, "Informe o motivo do cancelamento.") }), input);
  return runOperation(ctx, "receipt.cancel", undefined, async (tx) => {
    const r = await lockReceipt(tx, ctx, receiptId);
    requireStatus(r, ["expected", "checking"], "cancelar");
    await tx.query(`update wms.receipts set status = 'cancelled', updated_at = now(), version = version + 1 where id = $1`, [receiptId]);
    await audit(tx, ctx, "receipt.cancelled", "receipt", receiptId, r.code, d);
    return { id: receiptId };
  });
}

/** Chamado quando todo o volume liberado foi armazenado. */
export async function refreshReceiptCompletion(tx: Queryable, ctx: Ctx, receiptId: string): Promise<void> {
  const [state] = await tx.query<{ status: string; pending: number }>(
    `select r.status, coalesce((select sum(released_qty - putaway_qty) from wms.receipt_items i where i.receipt_id = r.id), 0) as pending
     from wms.receipts r where r.id = $1 for update`,
    [receiptId],
  );
  if (state?.status === "released" && state.pending === 0) {
    await tx.query(`update wms.receipts set status = 'completed', completed_at = now(), updated_at = now() where id = $1`, [receiptId]);
    await onReceiptCompleted(tx, ctx, receiptId);
  }
}

async function onReceiptCompleted(tx: Queryable, ctx: Ctx, receiptId: string) {
  const [r] = await tx.query<{ code: string; purchase_order_id: string | null; short: boolean }>(
    `select r.code, r.purchase_order_id,
            exists(select 1 from wms.receipt_items i where i.receipt_id = r.id and coalesce(i.counted_qty, 0) - i.damaged_qty < i.expected_qty) as short
     from wms.receipts r where r.id = $1`,
    [receiptId],
  );
  const items = await tx.query(
    `select p.sku, i.expected_qty, i.counted_qty, i.damaged_qty, i.quality_hold_qty, i.putaway_qty, i.lot_code
     from wms.receipt_items i join erp.products p on p.id = i.product_id where i.receipt_id = $1 order by i.line_no`,
    [receiptId],
  );
  if (r.purchase_order_id) await erp.setPurchaseOrderStatus(tx, r.purchase_order_id, r.short ? "partially_received" : "received");
  await enqueueIntegrationEvent(tx, ctx, "receipt.completed", "receipt", receiptId, { code: r.code, items });
  await audit(tx, ctx, "receipt.completed", "receipt", receiptId, r.code);
}
