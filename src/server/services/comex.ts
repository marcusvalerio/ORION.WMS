import "server-only";
import { z } from "zod";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { assertWarehouseAccess, hasWarehouseAccess } from "../access";
import { DomainError, NotFoundError } from "../errors";
import { parse, uuid, optionalDate, checkbox, qty } from "../validation";
import { INCOTERM_CODES, isCountryCode, isNcm, isValidContainer, normalizeContainer, normalizeNcm } from "@/lib/comex";
import { audit, enqueueIntegrationEvent, round3, runOperation, type OpOptions } from "./common";

// -----------------------------------------------------------------------------
// Validadores Zod reutilizáveis
// -----------------------------------------------------------------------------

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const incoterm = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => INCOTERM_CODES.includes(v), "Incoterm inválido: use um dos Incoterms 2020 (EXW, FCA, CPT, CIP, DAP, DPU, DDP, FAS, FOB, CFR, CIF).")
    .nullish(),
);

const country = (label: string) =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .trim()
      .toUpperCase()
      .refine(isCountryCode, `${label}: informe o código ISO 3166 alfa-2 (ex.: CN, DE, US).`)
      .nullish(),
  );

export const containerField = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? null : normalizeContainer(v)) : v),
  z
    .string()
    .refine(isValidContainer, "Contêiner inválido: use o padrão ISO 6346 (4 letras + 7 dígitos) com dígito verificador correto.")
    .nullish(),
);

const ncmField = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? null : normalizeNcm(v)) : v),
  z.string().refine(isNcm, "NCM inválido: informe 8 dígitos.").nullish(),
);

const shortText = (label: string, max: number) =>
  z.preprocess(blankToNull, z.string().trim().max(max, `${label}: no máximo ${max} caracteres.`).nullish());

// -----------------------------------------------------------------------------
// Importação (recebimento)
// -----------------------------------------------------------------------------

const importSchema = z.object({
  importDocType: z.preprocess(blankToNull, z.enum(["DI", "DUIMP"], { error: "Tipo de declaração inválido (DI ou DUIMP)." }).nullish()),
  importDocNumber: z.preprocess(
    blankToNull,
    z.string().trim().min(5, "Número da declaração deve ter ao menos 5 caracteres.").max(30).nullish(),
  ),
  incoterm,
  originCountry: country("País de origem"),
  containerNumber: containerField,
  sealNumber: shortText("Lacre", 30),
  holdForClearance: checkbox,
  items: z.array(z.object({ id: uuid("Item"), ncm: ncmField })).optional(),
});

interface ReceiptImportHeader {
  id: string;
  code: string;
  status: string;
  warehouse_id: string;
  customs_status: string;
  import_doc_type: string | null;
  import_doc_number: string | null;
  origin_country: string | null;
}

async function lockReceiptImport(tx: Queryable, ctx: Ctx, id: string): Promise<ReceiptImportHeader> {
  const [r] = await tx.query<ReceiptImportHeader>(
    `select id, code, status, warehouse_id, customs_status, import_doc_type, import_doc_number, origin_country
     from wms.receipts where id = $1 and company_id = $2 for update`,
    [id, ctx.user.companyId],
  );
  if (!r) throw new NotFoundError("Recebimento");
  assertWarehouseAccess(ctx, r.warehouse_id);
  return r;
}

/**
 * Registra os dados de importação do recebimento (todos opcionais). Com
 * "reter até o desembaraço", o recebimento fica "aguardando desembaraço" e não
 * pode ser liberado para armazenagem até o registro do desembaraço.
 */
export async function saveReceiptImport(ctx: Ctx, receiptId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "comex.manage");
  const d = parse(importSchema, input ?? {});
  if ((d.importDocType == null) !== (d.importDocNumber == null)) {
    throw new DomainError("Informe o tipo e o número da declaração de importação (DI ou DUIMP) juntos.", "VALIDATION", "importDocNumber");
  }
  if (d.holdForClearance && !d.importDocType) {
    throw new DomainError("A retenção aduaneira exige a declaração de importação (DI ou DUIMP).", "VALIDATION", "importDocType");
  }
  return runOperation(ctx, "receipt.import_save", opts, async (tx) => {
    const r = await lockReceiptImport(tx, ctx, receiptId);
    if (!["expected", "checking", "checked"].includes(r.status)) {
      throw new DomainError(`Dados de importação só podem ser alterados antes da liberação (recebimento ${r.code}).`, "INVALID_STATUS");
    }
    if (r.customs_status === "cleared") {
      throw new DomainError(`O recebimento ${r.code} já foi desembaraçado; os dados de importação estão fechados.`, "INVALID_STATUS");
    }
    const customs = d.holdForClearance ? "awaiting" : "none";
    await tx.query(
      `update wms.receipts set import_doc_type = $2, import_doc_number = $3, incoterm = $4, origin_country = $5,
              container_number = $6, seal_number = $7, customs_status = $8, updated_at = now(), version = version + 1
       where id = $1`,
      [receiptId, d.importDocType ?? null, d.importDocNumber ?? null, d.incoterm ?? null, d.originCountry ?? null,
        d.containerNumber ?? null, d.sealNumber ?? null, customs],
    );
    for (const item of d.items ?? []) {
      const updated = await tx.query(`update wms.receipt_items set ncm = $3 where id = $1 and receipt_id = $2 returning id`, [
        item.id,
        receiptId,
        item.ncm ?? null,
      ]);
      if (updated.length === 0) throw new DomainError("Item não pertence ao recebimento.", "VALIDATION");
    }
    const details = { ...d, customsStatus: customs };
    await audit(tx, ctx, "receipt.import_saved", "receipt", receiptId, r.code, details);
    return { id: receiptId, customsStatus: customs };
  });
}

const clearSchema = z.object({
  clearedOn: optionalDate.refine((v) => v !== null, "Informe a data do desembaraço."),
});

/** Registra o desembaraço aduaneiro (supervisor), liberando o recebimento para armazenagem. */
export async function clearCustoms(ctx: Ctx, receiptId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "customs.clear");
  const d = parse(clearSchema, input ?? {});
  const today = new Date().toISOString().slice(0, 10);
  if (d.clearedOn! > today) throw new DomainError("A data do desembaraço não pode estar no futuro.", "VALIDATION", "clearedOn");
  return runOperation(ctx, "receipt.customs_clear", opts, async (tx) => {
    const r = await lockReceiptImport(tx, ctx, receiptId);
    if (r.customs_status !== "awaiting") {
      throw new DomainError(`O recebimento ${r.code} não está aguardando desembaraço.`, "INVALID_STATUS");
    }
    await tx.query(
      `update wms.receipts set customs_status = 'cleared', customs_cleared_on = $2, customs_cleared_by = $3, customs_cleared_at = now(),
              updated_at = now(), version = version + 1 where id = $1`,
      [receiptId, d.clearedOn, ctx.user.id],
    );
    const items = await tx.query<{ sku: string; ncm: string | null; lot_code: string; expected_qty: number; counted_qty: number | null }>(
      `select p.sku, i.ncm, i.lot_code, i.expected_qty, i.counted_qty
       from wms.receipt_items i join erp.products p on p.id = i.product_id where i.receipt_id = $1 order by i.line_no`,
      [receiptId],
    );
    await enqueueIntegrationEvent(tx, ctx, "import.cleared", "receipt", receiptId, {
      code: r.code,
      declaration: { type: r.import_doc_type, number: r.import_doc_number },
      clearedOn: d.clearedOn,
      originCountry: r.origin_country,
      items,
    });
    await audit(tx, ctx, "receipt.customs_cleared", "receipt", receiptId, r.code, { clearedOn: d.clearedOn });
    return { id: receiptId };
  });
}

/** Barreira usada na liberação do recebimento: recusa enquanto aguarda desembaraço. */
export async function assertCustomsCleared(tx: Queryable, receiptId: string): Promise<void> {
  const [r] = await tx.query<{ code: string; customs_status: string }>(`select code, customs_status from wms.receipts where id = $1`, [receiptId]);
  if (r?.customs_status === "awaiting") {
    throw new DomainError(
      `O recebimento ${r.code} está aguardando desembaraço aduaneiro: registre o desembaraço antes de liberar a armazenagem.`,
      "CUSTOMS_HOLD",
    );
  }
}

/** Grava o país de origem dos lotes do recebimento (segue o lote no saldo e na rastreabilidade). */
export async function recordLotOrigins(tx: Queryable, ctx: Ctx, receiptId: string): Promise<void> {
  await tx.query(
    `insert into wms.lot_origins (company_id, product_id, lot_code, origin_country, receipt_id)
     select r.company_id, i.product_id, i.lot_code, r.origin_country, r.id
     from wms.receipt_items i join wms.receipts r on r.id = i.receipt_id
     where r.id = $1 and r.company_id = $2 and r.origin_country is not null and i.lot_code <> ''
     on conflict (company_id, product_id, lot_code) do nothing`,
    [receiptId, ctx.user.companyId],
  );
}

export interface ReceiptImportInfo {
  import_doc_type: string | null;
  import_doc_number: string | null;
  incoterm: string | null;
  origin_country: string | null;
  container_number: string | null;
  seal_number: string | null;
  customs_status: string;
  customs_cleared_on: string | null;
  customs_cleared_by_name: string | null;
  items: { id: string; line_no: number; sku: string; description: string; ncm: string | null; product_ncm: string | null }[];
}

export async function getReceiptImport(ctx: Ctx, receiptId: string): Promise<ReceiptImportInfo | null> {
  const [r] = await ctx.db.query<Omit<ReceiptImportInfo, "items"> & { warehouse_id: string }>(
    `select r.warehouse_id, r.import_doc_type, r.import_doc_number, r.incoterm, r.origin_country, r.container_number, r.seal_number,
            r.customs_status, r.customs_cleared_on::text as customs_cleared_on, u.name as customs_cleared_by_name
     from wms.receipts r left join wms.users u on u.id = r.customs_cleared_by
     where r.id = $1 and r.company_id = $2`,
    [receiptId, ctx.user.companyId],
  );
  if (!r || !hasWarehouseAccess(ctx, r.warehouse_id)) return null;
  const items = await ctx.db.query<ReceiptImportInfo["items"][number]>(
    `select i.id, i.line_no, p.sku, p.description, i.ncm, p.ncm as product_ncm
     from wms.receipt_items i join erp.products p on p.id = i.product_id where i.receipt_id = $1 order by i.line_no`,
    [receiptId],
  );
  return { ...r, items };
}

/** País de origem conhecido de um lote (ou null). */
export async function lotOrigin(q: Queryable, companyId: string, productId: string, lotCode: string): Promise<string | null> {
  if (!lotCode) return null;
  const [row] = await q.query<{ origin_country: string }>(
    `select origin_country from wms.lot_origins where company_id = $1 and product_id = $2 and lot_code = $3`,
    [companyId, productId, lotCode],
  );
  return row?.origin_country ?? null;
}

// -----------------------------------------------------------------------------
// Exportação (pedido de saída)
// -----------------------------------------------------------------------------

interface ExportOrder {
  id: string;
  code: string;
  status: string;
  warehouse_id: string;
  is_export: boolean;
  packed_at: string | null;
  stuffed_at: string | null;
  container_number: string | null;
  seal_number: string | null;
}

async function lockExportOrder(tx: Queryable, ctx: Ctx, id: string): Promise<ExportOrder> {
  const [o] = await tx.query<ExportOrder>(
    `select id, code, status, warehouse_id, is_export, packed_at::text as packed_at, stuffed_at::text as stuffed_at,
            container_number, seal_number
     from wms.outbound_orders where id = $1 and company_id = $2 for update`,
    [id, ctx.user.companyId],
  );
  if (!o) throw new NotFoundError("Pedido de saída");
  assertWarehouseAccess(ctx, o.warehouse_id);
  return o;
}

const exportSchema = z.object({
  isExport: checkbox,
  incoterm,
  destinationCountry: country("País de destino"),
  commercialInvoice: shortText("Fatura comercial (invoice)", 40),
  exportDeclaration: shortText("RE/DU-E", 40),
});

/** Marca/desmarca o pedido como exportação e grava Incoterm, destino, invoice e RE/DU-E. */
export async function saveOrderExport(ctx: Ctx, orderId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "comex.manage");
  const d = parse(exportSchema, input ?? {});
  if (d.isExport && !d.destinationCountry) {
    throw new DomainError("Informe o país de destino da exportação.", "VALIDATION", "destinationCountry");
  }
  return runOperation(ctx, "outbound.export_save", opts, async (tx) => {
    const o = await lockExportOrder(tx, ctx, orderId);
    if (["shipped", "cancelled"].includes(o.status)) throw new DomainError(`O pedido ${o.code} está encerrado.`, "INVALID_STATUS");
    if (o.packed_at) throw new DomainError(`O packing list do pedido ${o.code} já foi fechado.`, "INVALID_STATUS");
    if (!d.isExport) {
      const [pk] = await tx.query<{ n: number }>(`select count(*) as n from wms.export_packages where order_id = $1`, [orderId]);
      if (pk.n > 0) throw new DomainError("Remova os volumes antes de desmarcar a exportação.", "VALIDATION");
    }
    await tx.query(
      `update wms.outbound_orders set is_export = $2, export_incoterm = $3, destination_country = $4, commercial_invoice = $5,
              export_declaration = $6, updated_at = now(), version = version + 1 where id = $1`,
      d.isExport
        ? [orderId, true, d.incoterm ?? null, d.destinationCountry ?? null, d.commercialInvoice ?? null, d.exportDeclaration ?? null]
        : [orderId, false, null, null, d.commercialInvoice ?? null, d.exportDeclaration ?? null],
    );
    await audit(tx, ctx, "outbound.export_saved", "outbound_order", orderId, o.code, d);
    return { id: orderId };
  });
}

const packageSchema = z.object({
  packageType: z.enum(["box", "pallet", "crate", "drum", "other"]).default("box"),
  grossWeightKg: qty("Peso bruto"),
  netWeightKg: qty("Peso líquido"),
  lengthCm: qty("Comprimento"),
  widthCm: qty("Largura"),
  heightCm: qty("Altura"),
  items: z
    .array(
      z.object({
        orderLineId: uuid("Linha do pedido"),
        lotCode: z
          .string()
          .trim()
          .nullish()
          .transform((v) => (v ?? "").toUpperCase()),
        quantity: qty(),
      }),
    )
    .min(1, "Informe ao menos um item no volume."),
});

const PACKABLE_STATUSES = ["picked", "checked"];

/** Quantidade separada por linha/lote e quanto já foi embalado. */
async function packingBalance(q: Queryable, orderId: string) {
  return q.query<{ order_line_id: string; line_no: number; product_id: string; sku: string; lot_code: string; picked: number; packed: number }>(
    `with picked as (
       select r.order_line_id, r.lot_code, sum(r.picked_qty) as picked
       from wms.stock_reservations r join wms.outbound_order_lines l on l.id = r.order_line_id
       where l.order_id = $1 and r.status in ('picked', 'consumed') and r.picked_qty > 0
       group by r.order_line_id, r.lot_code
     ), packed as (
       select i.order_line_id, i.lot_code, sum(i.quantity) as packed
       from wms.export_package_items i join wms.export_packages p on p.id = i.package_id
       where p.order_id = $1 group by i.order_line_id, i.lot_code
     )
     select l.id as order_line_id, l.line_no, l.product_id, pr.sku, pk.lot_code,
            pk.picked, coalesce(pd.packed, 0) as packed
     from wms.outbound_order_lines l join erp.products pr on pr.id = l.product_id
     join picked pk on pk.order_line_id = l.id
     left join packed pd on pd.order_line_id = pk.order_line_id and pd.lot_code = pk.lot_code
     where l.order_id = $1
     order by l.line_no, lot_code`,
    [orderId],
  );
}

/**
 * Inclui um volume (caixa/palete) no packing list com pesos, dimensões e itens.
 * Nunca embala mais do que foi separado de cada linha/lote.
 */
export async function addExportPackage(ctx: Ctx, orderId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "export.pack");
  const d = parse(packageSchema, input);
  if (d.netWeightKg > d.grossWeightKg) throw new DomainError("O peso líquido não pode ser maior que o peso bruto.", "VALIDATION", "netWeightKg");
  return runOperation(ctx, "export.package_add", opts, async (tx) => {
    const o = await lockExportOrder(tx, ctx, orderId);
    if (!o.is_export) throw new DomainError(`O pedido ${o.code} não está marcado como exportação.`, "VALIDATION");
    if (!PACKABLE_STATUSES.includes(o.status)) {
      throw new DomainError(`Volumes só podem ser montados após a separação (pedido ${o.code} está "${o.status}").`, "INVALID_STATUS");
    }
    if (o.packed_at) throw new DomainError(`O packing list do pedido ${o.code} já foi fechado.`, "INVALID_STATUS");
    const balance = await packingBalance(tx, orderId);
    const requested = new Map<string, number>();
    for (const item of d.items) {
      const k = `${item.orderLineId}|${item.lotCode}`;
      requested.set(k, round3((requested.get(k) ?? 0) + item.quantity));
    }
    for (const [k, q] of requested) {
      const [lineId, lot] = k.split("|");
      const b = balance.find((x) => x.order_line_id === lineId && x.lot_code === lot);
      if (!b) throw new DomainError(`Linha/lote ${lot || "(sem lote)"} não foi separado neste pedido.`, "VALIDATION");
      const free = round3(b.picked - b.packed);
      if (q > free) {
        throw new DomainError(
          `Volume excede o separado de ${b.sku}${lot ? ` lote ${lot}` : ""}: disponível para embalar ${free}, informado ${q}.`,
          "OVER_PACK",
        );
      }
    }
    const [{ n }] = await tx.query<{ n: number }>(`select coalesce(max(package_no), 0) + 1 as n from wms.export_packages where order_id = $1`, [orderId]);
    const [pkg] = await tx.query<{ id: string }>(
      `insert into wms.export_packages (company_id, order_id, package_no, package_type, gross_weight_kg, net_weight_kg,
                                        length_cm, width_cm, height_cm, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [ctx.user.companyId, orderId, n, d.packageType, d.grossWeightKg, d.netWeightKg, d.lengthCm, d.widthCm, d.heightCm, ctx.user.id],
    );
    for (const [k, q] of requested) {
      const [lineId, lot] = k.split("|");
      const b = balance.find((x) => x.order_line_id === lineId && x.lot_code === lot)!;
      await tx.query(
        `insert into wms.export_package_items (package_id, order_line_id, product_id, lot_code, quantity) values ($1,$2,$3,$4,$5)`,
        [pkg.id, lineId, b.product_id, lot, q],
      );
    }
    await audit(tx, ctx, "export.package_added", "outbound_order", orderId, o.code, { packageNo: n, ...d });
    return { id: pkg.id, packageNo: n };
  });
}

export async function removeExportPackage(ctx: Ctx, packageId: string, opts?: OpOptions) {
  assertCan(ctx, "export.pack");
  return runOperation(ctx, "export.package_remove", opts, async (tx) => {
    const [p] = await tx.query<{ order_id: string; package_no: number }>(
      `select order_id, package_no from wms.export_packages where id = $1 and company_id = $2`,
      [packageId, ctx.user.companyId],
    );
    if (!p) throw new NotFoundError("Volume");
    const o = await lockExportOrder(tx, ctx, p.order_id);
    if (o.packed_at) throw new DomainError(`O packing list do pedido ${o.code} já foi fechado.`, "INVALID_STATUS");
    await tx.query(`delete from wms.export_packages where id = $1`, [packageId]);
    await audit(tx, ctx, "export.package_removed", "outbound_order", o.id, o.code, { packageNo: p.package_no });
    return { id: packageId };
  });
}

/** Fecha o packing list: todo o separado precisa estar embalado. Gera o evento export.packed. */
export async function finishPacking(ctx: Ctx, orderId: string, opts?: OpOptions) {
  assertCan(ctx, "export.pack");
  return runOperation(ctx, "export.pack_finish", opts, async (tx) => {
    const o = await lockExportOrder(tx, ctx, orderId);
    if (!o.is_export) throw new DomainError(`O pedido ${o.code} não está marcado como exportação.`, "VALIDATION");
    if (!PACKABLE_STATUSES.includes(o.status)) throw new DomainError(`O pedido ${o.code} ainda não foi separado.`, "INVALID_STATUS");
    if (o.packed_at) throw new DomainError(`O packing list do pedido ${o.code} já foi fechado.`, "INVALID_STATUS");
    const balance = await packingBalance(tx, orderId);
    const pending = balance.filter((b) => round3(b.picked - b.packed) !== 0);
    if (balance.length === 0) throw new DomainError("Nada foi separado neste pedido.", "VALIDATION");
    if (pending.length) {
      throw new DomainError(
        `Há itens separados fora dos volumes: ${pending.map((b) => `${b.sku}${b.lot_code ? ` lote ${b.lot_code}` : ""} (${round3(b.picked - b.packed)})`).join("; ")}.`,
        "PACKING_INCOMPLETE",
      );
    }
    await tx.query(`update wms.outbound_orders set packed_at = now(), updated_at = now(), version = version + 1 where id = $1`, [orderId]);
    const list = await packingListTx(tx, ctx, orderId);
    await enqueueIntegrationEvent(tx, ctx, "export.packed", "outbound_order", orderId, {
      code: o.code,
      incoterm: list.order.export_incoterm,
      destinationCountry: list.order.destination_country,
      commercialInvoice: list.order.commercial_invoice,
      exportDeclaration: list.order.export_declaration,
      totals: list.totals,
      packages: list.packages.map((p) => ({
        no: p.package_no,
        grossWeightKg: p.gross_weight_kg,
        netWeightKg: p.net_weight_kg,
        dimensionsCm: [p.length_cm, p.width_cm, p.height_cm],
        items: p.items.map((i) => ({ sku: i.sku, lot: i.lot_code, quantity: i.quantity, ncm: i.ncm, originCountry: i.origin_country })),
      })),
    });
    await audit(tx, ctx, "export.packed", "outbound_order", orderId, o.code, { packages: list.packages.length, totals: list.totals });
    return { id: orderId, totals: list.totals };
  });
}

const stuffSchema = z.object({
  containerNumber: containerField.refine((v) => v != null, "Informe o número do contêiner."),
  sealNumber: z.string({ error: "Informe o lacre." }).trim().min(1, "Informe o lacre.").max(30),
});

/** Registra a estufagem do contêiner (número ISO 6346 + lacre) após o fechamento do packing list. */
export async function stuffContainer(ctx: Ctx, orderId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "export.pack");
  const d = parse(stuffSchema, input);
  return runOperation(ctx, "export.stuff", opts, async (tx) => {
    const o = await lockExportOrder(tx, ctx, orderId);
    if (!o.is_export) throw new DomainError(`O pedido ${o.code} não está marcado como exportação.`, "VALIDATION");
    if (!o.packed_at) throw new DomainError("Feche o packing list antes de estufar o contêiner.", "INVALID_STATUS");
    if (o.status === "shipped" || o.status === "cancelled") throw new DomainError(`O pedido ${o.code} está encerrado.`, "INVALID_STATUS");
    await tx.query(
      `update wms.outbound_orders set container_number = $2, seal_number = $3, stuffed_at = now(), updated_at = now(),
              version = version + 1 where id = $1`,
      [orderId, d.containerNumber, d.sealNumber],
    );
    await audit(tx, ctx, "export.stuffed", "outbound_order", orderId, o.code, d);
    return { id: orderId };
  });
}

/** Barreira usada na expedição: pedido de exportação só sai com o packing list fechado. */
export async function assertExportReady(tx: Queryable, orderId: string): Promise<void> {
  const [o] = await tx.query<{ code: string; is_export: boolean; packed_at: string | null }>(
    `select code, is_export, packed_at from wms.outbound_orders where id = $1`,
    [orderId],
  );
  if (o?.is_export && !o.packed_at) {
    throw new DomainError(`O pedido ${o.code} é de exportação: feche o packing list antes de expedir.`, "PACKING_INCOMPLETE");
  }
}

// -----------------------------------------------------------------------------
// Packing list (consulta / impressão)
// -----------------------------------------------------------------------------

export interface PackingListItem {
  order_line_id: string;
  line_no: number;
  sku: string;
  description: string;
  uom: string;
  ncm: string | null;
  lot_code: string;
  quantity: number;
  origin_country: string | null;
}

export interface PackingListPackage {
  id: string;
  package_no: number;
  package_type: string;
  gross_weight_kg: number;
  net_weight_kg: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  volume_m3: number;
  items: PackingListItem[];
}

export interface PackingList {
  order: {
    id: string;
    code: string;
    status: string;
    warehouse_id: string;
    customer_name: string;
    is_export: boolean;
    export_incoterm: string | null;
    destination_country: string | null;
    commercial_invoice: string | null;
    export_declaration: string | null;
    container_number: string | null;
    seal_number: string | null;
    packed_at: string | null;
    stuffed_at: string | null;
  };
  company: { name: string; legal_name: string | null; document: string | null; address: string | null; city: string | null; state: string | null };
  packages: PackingListPackage[];
  totals: { packages: number; grossWeightKg: number; netWeightKg: number; volumeM3: number; quantity: number };
  /** Separado ainda não embalado, por linha/lote. */
  pending: { order_line_id: string; line_no: number; sku: string; lot_code: string; pending: number }[];
}

async function packingListTx(q: Queryable, ctx: Ctx, orderId: string): Promise<PackingList> {
  const [order] = await q.query<PackingList["order"]>(
    `select id, code, status, warehouse_id, customer_name, is_export, export_incoterm, destination_country, commercial_invoice,
            export_declaration, container_number, seal_number, packed_at::text as packed_at, stuffed_at::text as stuffed_at
     from wms.outbound_orders where id = $1 and company_id = $2`,
    [orderId, ctx.user.companyId],
  );
  if (!order) throw new NotFoundError("Pedido de saída");
  const [company] = await q.query<PackingList["company"]>(
    `select name, legal_name, document, address, city, state from erp.companies where id = $1`,
    [ctx.user.companyId],
  );
  const pkgs = await q.query<Omit<PackingListPackage, "items" | "volume_m3">>(
    `select id, package_no, package_type, gross_weight_kg, net_weight_kg, length_cm, width_cm, height_cm
     from wms.export_packages where order_id = $1 order by package_no`,
    [orderId],
  );
  const items = await q.query<PackingListItem & { package_id: string }>(
    `select i.package_id, i.order_line_id, l.line_no, p.sku, p.description, p.uom, p.ncm, i.lot_code, i.quantity, lo.origin_country
     from wms.export_package_items i
     join wms.outbound_order_lines l on l.id = i.order_line_id
     join erp.products p on p.id = i.product_id
     left join wms.lot_origins lo on lo.company_id = $2 and lo.product_id = i.product_id and lo.lot_code = i.lot_code
     where i.package_id in (select id from wms.export_packages where order_id = $1)
     order by l.line_no, i.lot_code`,
    [orderId, ctx.user.companyId],
  );
  const packages: PackingListPackage[] = pkgs.map((p) => ({
    ...p,
    volume_m3: Math.round(((p.length_cm * p.width_cm * p.height_cm) / 1_000_000) * 10000) / 10000,
    items: items.filter((i) => i.package_id === p.id),
  }));
  const sum = (f: (p: PackingListPackage) => number) => round3(packages.reduce((acc, p) => acc + f(p), 0));
  const totals = {
    packages: packages.length,
    grossWeightKg: sum((p) => p.gross_weight_kg),
    netWeightKg: sum((p) => p.net_weight_kg),
    volumeM3: Math.round(packages.reduce((acc, p) => acc + p.volume_m3, 0) * 10000) / 10000,
    quantity: sum((p) => p.items.reduce((a, i) => a + i.quantity, 0)),
  };
  const pending = (await packingBalance(q, orderId))
    .filter((b) => round3(b.picked - b.packed) > 0)
    .map((b) => ({ order_line_id: b.order_line_id, line_no: b.line_no, sku: b.sku, lot_code: b.lot_code, pending: round3(b.picked - b.packed) }));
  return { order, company, packages, totals, pending };
}

export async function getPackingList(ctx: Ctx, orderId: string): Promise<PackingList | null> {
  try {
    const list = await packingListTx(ctx.db, ctx, orderId);
    return hasWarehouseAccess(ctx, list.order.warehouse_id) ? list : null;
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

