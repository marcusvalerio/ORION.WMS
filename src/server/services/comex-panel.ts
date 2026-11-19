import "server-only";
import type { Ctx } from "../context";
import { warehouseScope } from "../access";
import { EXPORT_SITUATIONS, IMPORT_SITUATIONS, type ExportSituation, type ImportSituation } from "@/lib/comex-panel";
import { SERIES_DAYS } from "./dashboard";

/**
 * Aba Comex: consulta consolidada dos processos de importação (recebimentos com
 * dados de comércio exterior) e dos pedidos de exportação. Somente leitura;
 * sempre filtrada pela empresa da sessão e pelos depósitos do usuário.
 */

/** Recebimento é processo de importação quando tem qualquer dado de comércio exterior. */
const IS_IMPORT = `(r.import_doc_type is not null or r.incoterm is not null or r.origin_country is not null or r.container_number is not null
  or r.transport_doc is not null or r.commercial_invoice is not null or r.transport_mode is not null or r.customs_status <> 'none')`;

const IMPORT_SITUATION_SQL = `case
  when r.status = 'completed' then 'stored'
  when r.customs_status = 'awaiting' then 'awaiting'
  when r.import_doc_type is null then 'no_data'
  else 'cleared' end`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dateOrNull = (v?: string | null) => (v && DATE.test(v) ? v : null);

export interface ImportFilters {
  situation?: string | null;
  supplierId?: string | null;
  country?: string | null;
  from?: string | null;
  to?: string | null;
  q?: string | null;
}

/**
 * Carga estimada de um recebimento (alias r): quantidade prevista × dimensões e
 * peso do produto. Itens sem medidas entram em `missing` e não somam.
 */
const RECEIPT_CARGO_SQL = `
  select coalesce(sum(i.expected_qty * p.length_cm * p.width_cm * p.height_cm / 1000000), 0)::float8 as m3,
         coalesce(sum(i.expected_qty * p.weight_kg), 0)::float8 as kg,
         count(*) filter (where coalesce(p.length_cm, 0) * coalesce(p.width_cm, 0) * coalesce(p.height_cm, 0) = 0
                             or coalesce(p.weight_kg, 0) = 0)::int as missing
  from wms.receipt_items i join erp.products p on p.id = i.product_id
  where i.receipt_id = r.id`;

export interface CargoSummary {
  container_type: string | null;
  m3: number;
  kg: number;
  missing: number;
}

/** Carga de um recebimento de importação (para o painel do contêiner). */
export async function receiptCargo(ctx: Ctx, receiptId: string): Promise<CargoSummary | null> {
  const [row] = await ctx.db.query<CargoSummary>(
    `select r.container_type, cg.m3, cg.kg, cg.missing
     from wms.receipts r cross join lateral (${RECEIPT_CARGO_SQL}) cg
     where r.id = $1 and r.company_id = $2`,
    [receiptId, ctx.user.companyId],
  );
  return row ?? null;
}

export interface ImportProcessRow {
  id: string;
  code: string;
  status: string;
  situation: ImportSituation;
  warehouse_code: string;
  supplier_name: string;
  po_number: string | null;
  invoice_number: string | null;
  commercial_invoice: string | null;
  import_doc_type: string | null;
  import_doc_number: string | null;
  incoterm: string | null;
  origin_country: string | null;
  transport_mode: string | null;
  transport_doc: string | null;
  container_number: string | null;
  customs_channel: string | null;
  customs_status: string;
  shipped_on: string | null;
  eta_on: string | null;
  arrived_at: string | null;
  import_registered_on: string | null;
  customs_cleared_on: string | null;
  checked_at: string | null;
  completed_at: string | null;
  created_at: string;
  expected_total: number;
  container_type: string | null;
  cargo_m3: number;
  cargo_kg: number;
  /** itens sem dimensões ou peso no cadastro do produto */
  cargo_missing: number;
  is_demo: boolean;
}

export async function listImportProcesses(ctx: Ctx, f: ImportFilters = {}): Promise<ImportProcessRow[]> {
  const situation = f.situation && (IMPORT_SITUATIONS as readonly string[]).includes(f.situation) ? f.situation : null;
  const country = f.country && /^[A-Za-z]{2}$/.test(f.country) ? f.country.toUpperCase() : null;
  const supplier = f.supplierId && /^[0-9a-f-]{36}$/i.test(f.supplierId) ? f.supplierId : null;
  const params: unknown[] = [ctx.user.companyId, situation, supplier, country, dateOrNull(f.from), dateOrNull(f.to), f.q?.trim() || null];
  const scope = warehouseScope(ctx, "r.warehouse_id", params);
  return ctx.db.query<ImportProcessRow>(
    `select * from (
       select r.id, r.code, r.status, ${IMPORT_SITUATION_SQL} as situation, w.code as warehouse_code, s.name as supplier_name,
              po.number as po_number, r.invoice_number, r.commercial_invoice, r.import_doc_type, r.import_doc_number, r.incoterm,
              r.origin_country, r.transport_mode, r.transport_doc, r.container_number, r.customs_channel, r.customs_status,
              r.shipped_on::text as shipped_on, r.eta_on::text as eta_on, r.arrived_at::text as arrived_at,
              r.import_registered_on::text as import_registered_on, r.customs_cleared_on::text as customs_cleared_on,
              r.checked_at::text as checked_at, r.completed_at::text as completed_at, r.created_at::text as created_at, r.is_demo,
              coalesce((select sum(i.expected_qty) from wms.receipt_items i where i.receipt_id = r.id), 0)::float8 as expected_total,
              r.container_type, cg.m3 as cargo_m3, cg.kg as cargo_kg, cg.missing as cargo_missing,
              r.supplier_id
       from wms.receipts r
       join erp.suppliers s on s.id = r.supplier_id
       join wms.warehouses w on w.id = r.warehouse_id
       left join erp.purchase_orders po on po.id = r.purchase_order_id
       cross join lateral (${RECEIPT_CARGO_SQL}) cg
       where r.company_id = $1 and r.status <> 'cancelled' and ${IS_IMPORT}
         and ($4::text is null or r.origin_country = $4)
         and ($5::date is null or r.created_at >= $5::date)
         and ($6::date is null or r.created_at < $6::date + 1)
         and ($7::text is null or r.code ilike '%' || $7 || '%' or r.import_doc_number ilike '%' || $7 || '%'
              or r.commercial_invoice ilike '%' || $7 || '%' or r.container_number ilike '%' || $7 || '%'
              or r.transport_doc ilike '%' || $7 || '%' or r.invoice_number ilike '%' || $7 || '%'
              or po.number ilike '%' || $7 || '%')${scope}
     ) x
     where ($2::text is null or x.situation = $2) and ($3::uuid is null or x.supplier_id = $3)
     order by (x.situation = 'stored'), x.created_at desc
     limit 500`,
    params,
  );
}

export interface ImportIndicators {
  open: number;
  awaiting: number;
  clearedThisMonth: number;
  inTransit: { processes: number; quantity: number; value: number };
  clearedSeries: { day: string; value: number }[];
}

export async function importIndicators(ctx: Ctx): Promise<ImportIndicators> {
  const params: unknown[] = [ctx.user.companyId];
  const scope = warehouseScope(ctx, "r.warehouse_id", params);
  const [k] = await ctx.db.query<{ open: number; awaiting: number; cleared_month: number; transit: number; transit_qty: number; transit_value: number }>(
    `with imp as (
       select r.* from wms.receipts r where r.company_id = $1 and r.status <> 'cancelled' and ${IS_IMPORT}${scope}
     ), transit as (
       select imp.id from imp where imp.status = 'expected' and imp.arrived_at is null
     )
     select (select count(*) from imp where status <> 'completed')::int as open,
            (select count(*) from imp where customs_status = 'awaiting')::int as awaiting,
            (select count(*) from imp where customs_cleared_on >= date_trunc('month', current_date))::int as cleared_month,
            (select count(*) from transit)::int as transit,
            coalesce((select sum(i.expected_qty) from wms.receipt_items i where i.receipt_id in (select id from transit)), 0)::float8 as transit_qty,
            coalesce((select sum(i.expected_qty * coalesce(pi.unit_price, 0)) from wms.receipt_items i
                        left join erp.purchase_order_items pi on pi.id = i.purchase_order_item_id
                       where i.receipt_id in (select id from transit)), 0)::float8 as transit_value`,
    params,
  );
  const series = await ctx.db.query<{ day: string; value: number }>(
    `select d::date::text as day,
            (select count(*) from wms.receipts r where r.company_id = $1 and r.customs_cleared_on = d::date${scope})::int as value
     from generate_series(current_date - ${SERIES_DAYS - 1}, current_date, interval '1 day') d
     order by d`,
    params,
  );
  return {
    open: k.open,
    awaiting: k.awaiting,
    clearedThisMonth: k.cleared_month,
    inTransit: { processes: k.transit, quantity: Number(k.transit_qty), value: Number(k.transit_value) },
    clearedSeries: series,
  };
}

/** Fornecedores e países presentes nos processos de importação (opções dos filtros). */
export async function importFilterOptions(ctx: Ctx) {
  const params: unknown[] = [ctx.user.companyId];
  const scope = warehouseScope(ctx, "r.warehouse_id", params);
  const suppliers = await ctx.db.query<{ id: string; name: string }>(
    `select distinct s.id, s.name from wms.receipts r join erp.suppliers s on s.id = r.supplier_id
     where r.company_id = $1 and ${IS_IMPORT}${scope} order by s.name`,
    params,
  );
  const countries = await ctx.db.query<{ code: string }>(
    `select distinct r.origin_country as code from wms.receipts r
     where r.company_id = $1 and r.origin_country is not null${scope} order by 1`,
    params,
  );
  return { suppliers, countries: countries.map((c) => c.code) };
}

// -----------------------------------------------------------------------------
// Exportação
// -----------------------------------------------------------------------------

const EXPORT_SITUATION_SQL = `case
  when o.status = 'shipped' then 'shipped'
  when o.stuffed_at is not null then 'stuffed'
  when o.packed_at is not null then 'packed'
  when o.status in ('picked', 'checked') then 'packing'
  else 'picking' end`;

export interface ExportFilters {
  situation?: string | null;
  country?: string | null;
  due?: string | null;
  from?: string | null;
  to?: string | null;
  q?: string | null;
}

export interface ExportOrderRow {
  id: string;
  code: string;
  status: string;
  situation: ExportSituation;
  warehouse_code: string;
  customer_name: string;
  export_incoterm: string | null;
  destination_country: string | null;
  commercial_invoice: string | null;
  export_declaration: string | null;
  container_number: string | null;
  seal_number: string | null;
  packages: number;
  gross_weight_kg: number;
  container_type: string | null;
  cargo_m3: number;
  packed_at: string | null;
  stuffed_at: string | null;
  shipped_at: string | null;
  created_at: string;
  is_demo: boolean;
}

export async function listExportOrders(ctx: Ctx, f: ExportFilters = {}): Promise<ExportOrderRow[]> {
  const situation = f.situation && (EXPORT_SITUATIONS as readonly string[]).includes(f.situation) ? f.situation : null;
  const country = f.country && /^[A-Za-z]{2}$/.test(f.country) ? f.country.toUpperCase() : null;
  const due = f.due === "with" || f.due === "without" ? f.due : null;
  const params: unknown[] = [ctx.user.companyId, situation, country, due, dateOrNull(f.from), dateOrNull(f.to), f.q?.trim() || null];
  const scope = warehouseScope(ctx, "o.warehouse_id", params);
  return ctx.db.query<ExportOrderRow>(
    `select * from (
       select o.id, o.code, o.status, ${EXPORT_SITUATION_SQL} as situation, w.code as warehouse_code, o.customer_name,
              o.export_incoterm, o.destination_country, o.commercial_invoice, o.export_declaration, o.container_number, o.seal_number,
              (select count(*) from wms.export_packages p where p.order_id = o.id)::int as packages,
              coalesce((select sum(p.gross_weight_kg) from wms.export_packages p where p.order_id = o.id), 0)::float8 as gross_weight_kg,
              o.container_type,
              coalesce((select sum(p.length_cm * p.width_cm * p.height_cm) / 1000000 from wms.export_packages p where p.order_id = o.id), 0)::float8 as cargo_m3,
              o.packed_at::text as packed_at, o.stuffed_at::text as stuffed_at, o.shipped_at::text as shipped_at,
              o.created_at::text as created_at, o.is_demo
       from wms.outbound_orders o
       join wms.warehouses w on w.id = o.warehouse_id
       where o.company_id = $1 and o.is_export and o.status <> 'cancelled'
         and ($3::text is null or o.destination_country = $3)
         and ($4::text is null or ($4 = 'with') = (o.export_declaration is not null))
         and ($5::date is null or o.created_at >= $5::date)
         and ($6::date is null or o.created_at < $6::date + 1)
         and ($7::text is null or o.code ilike '%' || $7 || '%' or o.customer_name ilike '%' || $7 || '%'
              or o.commercial_invoice ilike '%' || $7 || '%' or o.export_declaration ilike '%' || $7 || '%'
              or o.container_number ilike '%' || $7 || '%')${scope}
     ) x
     where ($2::text is null or x.situation = $2)
     order by (x.situation = 'shipped'), x.created_at desc
     limit 500`,
    params,
  );
}

export async function exportIndicators(ctx: Ctx) {
  const params: unknown[] = [ctx.user.companyId];
  const scope = warehouseScope(ctx, "o.warehouse_id", params);
  const [k] = await ctx.db.query<{ open: number; packing: number; without_due: number; shipped_month: number }>(
    `select count(*) filter (where o.status <> 'shipped')::int as open,
            count(*) filter (where o.status in ('picked', 'checked') and o.packed_at is null)::int as packing,
            count(*) filter (where o.status <> 'shipped' and o.export_declaration is null)::int as without_due,
            count(*) filter (where o.status = 'shipped' and o.shipped_at >= date_trunc('month', now()))::int as shipped_month
     from wms.outbound_orders o where o.company_id = $1 and o.is_export and o.status <> 'cancelled'${scope}`,
    params,
  );
  return { open: k.open, packing: k.packing, withoutDue: k.without_due, shippedThisMonth: k.shipped_month };
}
