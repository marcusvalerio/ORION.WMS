import type { Queryable } from "../../db/types";

/**
 * Payloads ORION → ATLAS no formato do contrato (3.6, fixtures o2a.*.json).
 *
 * Para empresas vinculadas ao ATLAS, `enqueueIntegrationEvent` passa o payload
 * do serviço por `buildAtlasPayload`, que acrescenta os ids do ATLAS
 * (`atlas_*_id`), códigos e linhas por lote lendo o estado da própria
 * transação. Os campos legados continuam no payload (o ATLAS os ignora), então
 * empresas sem vínculo e o transporte local não mudam.
 */

type Payload = Record<string, unknown>;
const nul = (lot: string | null | undefined) => (lot ? lot : null);
const n = (v: unknown) => Number(v ?? 0);

async function productExt(tx: Queryable, companyId: string, skus: string[]) {
  const rows = skus.length
    ? await tx.query<{ sku: string; external_id: string | null }>(
        `select sku, external_id from erp.products where company_id = $1 and sku = any($2::text[])`,
        [companyId, [...new Set(skus)]],
      )
    : [];
  return new Map(rows.map((r) => [r.sku, r.external_id]));
}

async function outboundHeader(tx: Queryable, orderId: string) {
  const [o] = await tx.query<{
    code: string;
    atlas_sales_order_id: string | null;
    invoice_access_key: string | null;
    shipped_at: string | null;
    carrier: string | null;
    vehicle_plate: string | null;
    shipment: string | null;
  }>(
    `select o.code, so.external_id as atlas_sales_order_id, o.invoice_access_key, o.shipped_at, s.carrier, s.vehicle_plate,
            s.code as shipment
     from wms.outbound_orders o left join erp.sales_orders so on so.id = o.sales_order_id
     left join wms.shipments s on s.order_id = o.id where o.id = $1`,
    [orderId],
  );
  return o;
}

/** Lotes por linha (reservas separadas/consumidas). */
async function lotsByLine(tx: Queryable, orderId: string, statuses: string[]) {
  const rows = await tx.query<{ order_line_id: string; lot_code: string; expiry_date: string | null; quantity: number }>(
    `select r.order_line_id, r.lot_code, b.expiry_date::text as expiry_date, sum(r.picked_qty)::float8 as quantity
     from wms.stock_reservations r join wms.outbound_order_lines l on l.id = r.order_line_id
     join wms.stock_balances b on b.id = r.balance_id
     where l.order_id = $1 and r.status = any($2::text[]) and r.picked_qty > 0
     group by r.order_line_id, r.lot_code, b.expiry_date order by r.lot_code`,
    [orderId, statuses],
  );
  const map = new Map<string, { lot_code: string | null; expiration_date: string | null; quantity: number }[]>();
  for (const r of rows) {
    const list = map.get(r.order_line_id) ?? [];
    list.push({ lot_code: nul(r.lot_code), expiration_date: r.expiry_date, quantity: n(r.quantity) });
    map.set(r.order_line_id, list);
  }
  return map;
}

async function outboundLines(tx: Queryable, orderId: string) {
  return tx.query<{
    id: string;
    atlas_line_id: string | null;
    atlas_product_id: string | null;
    sku: string;
    requested_qty: number;
    picked_qty: number;
    checked_qty: number;
    shipped_qty: number;
    weight_kg: number | null;
    cancelled: boolean;
  }>(
    `select l.id, si.external_id as atlas_line_id, p.external_id as atlas_product_id, p.sku, l.requested_qty::float8 as requested_qty,
            l.picked_qty::float8 as picked_qty, l.checked_qty::float8 as checked_qty, l.shipped_qty::float8 as shipped_qty,
            p.weight_kg::float8 as weight_kg, l.cancelled_at is not null as cancelled
     from wms.outbound_order_lines l join erp.products p on p.id = l.product_id
     left join erp.sales_order_items si on si.id = l.sales_order_item_id
     where l.order_id = $1 order by l.line_no`,
    [orderId],
  );
}

export async function buildAtlasPayload(
  tx: Queryable,
  companyId: string,
  eventType: string,
  aggregateId: string,
  legacy: Payload,
): Promise<Payload> {
  switch (eventType) {
    case "outbound.accepted":
    case "outbound.picking_started": {
      const o = await outboundHeader(tx, aggregateId);
      return { ...legacy, code: o.code, atlas_sales_order_id: o.atlas_sales_order_id };
    }
    case "outbound.ready_to_invoice": {
      const o = await outboundHeader(tx, aggregateId);
      const lines = (await outboundLines(tx, aggregateId)).filter((l) => !l.cancelled && l.checked_qty > 0);
      const lots = await lotsByLine(tx, aggregateId, ["picked"]);
      const weight = Math.round(lines.reduce((s, l) => s + (l.weight_kg ?? 0) * l.checked_qty, 0) * 1000) / 1000;
      const [packages] = await tx.query<{ n: number }>(`select count(*)::int as n from wms.export_packages where order_id = $1`, [aggregateId]);
      return {
        ...legacy,
        code: o.code,
        atlas_sales_order_id: o.atlas_sales_order_id,
        gross_weight_kg: weight,
        net_weight_kg: weight,
        volumes: packages?.n ? Number(packages.n) : null,
        lines: lines.map((l) => ({
          atlas_line_id: l.atlas_line_id,
          atlas_product_id: l.atlas_product_id,
          sku: l.sku,
          quantity: l.checked_qty,
          lots: lots.get(l.id) ?? [],
          serials: [],
        })),
      };
    }
    case "outbound.shipped": {
      const o = await outboundHeader(tx, aggregateId);
      const lines = await outboundLines(tx, aggregateId);
      const lots = await lotsByLine(tx, aggregateId, ["consumed"]);
      return {
        ...legacy,
        code: o.code,
        shipment: o.shipment ?? legacy.shipment,
        atlas_sales_order_id: o.atlas_sales_order_id,
        access_key: o.invoice_access_key,
        carrier: o.carrier,
        vehicle_plate: o.vehicle_plate,
        shipped_at: new Date(o.shipped_at ?? Date.now()).toISOString(),
        lines: lines.map((l) => ({
          atlas_line_id: l.atlas_line_id,
          atlas_product_id: l.atlas_product_id,
          sku: l.sku,
          requested_qty: l.requested_qty,
          shipped_qty: l.shipped_qty,
          lots: (lots.get(l.id) ?? []).map(({ lot_code, quantity }) => ({ lot_code, quantity })),
        })),
      };
    }
    case "outbound.cancelled": {
      const o = await outboundHeader(tx, aggregateId);
      return { ...legacy, code: o.code, atlas_sales_order_id: o.atlas_sales_order_id, released_reservations: true };
    }
    case "outbound.line_cancelled": {
      const o = await outboundHeader(tx, aggregateId);
      const [line] = legacy.line_id
        ? await tx.query<{ atlas_line_id: string | null }>(
            `select si.external_id as atlas_line_id from wms.outbound_order_lines l
             left join erp.sales_order_items si on si.id = l.sales_order_item_id where l.id = $1`,
            [legacy.line_id],
          )
        : [];
      return {
        ...legacy,
        code: o.code,
        atlas_sales_order_id: o.atlas_sales_order_id,
        atlas_line_id: line?.atlas_line_id ?? null,
        cancelled_qty: n(legacy.cancelled_qty),
      };
    }
    case "receipt.completed": {
      const [r] = await tx.query<{ code: string; atlas_purchase_order_id: string | null; invoice_number: string | null; invoice_key: string | null }>(
        `select r.code, po.external_id as atlas_purchase_order_id, r.invoice_number, r.invoice_key
         from wms.receipts r left join erp.purchase_orders po on po.id = r.purchase_order_id where r.id = $1`,
        [aggregateId],
      );
      const items = await tx.query<{
        atlas_line_id: string | null;
        atlas_product_id: string | null;
        sku: string;
        expected_qty: number;
        counted_qty: number | null;
        damaged_qty: number;
        lot_code: string;
        expiry_date: string | null;
      }>(
        `select pi.external_id as atlas_line_id, p.external_id as atlas_product_id, p.sku, i.expected_qty::float8 as expected_qty,
                i.counted_qty::float8 as counted_qty, i.damaged_qty::float8 as damaged_qty, i.lot_code, i.expiry_date::text as expiry_date
         from wms.receipt_items i join erp.products p on p.id = i.product_id
         left join erp.purchase_order_items pi on pi.id = i.purchase_order_item_id
         where i.receipt_id = $1 order by i.line_no`,
        [aggregateId],
      );
      return {
        ...legacy,
        code: r.code,
        atlas_purchase_order_id: r.atlas_purchase_order_id,
        invoice_number: r.invoice_number,
        invoice_access_key: r.invoice_key,
        completed_at: new Date().toISOString(),
        items: items.map((i) => {
          const received = n(i.counted_qty);
          const accepted = Math.max(0, Math.round((received - n(i.damaged_qty)) * 1000) / 1000);
          return {
            atlas_line_id: i.atlas_line_id,
            atlas_product_id: i.atlas_product_id,
            sku: i.sku,
            expected_qty: n(i.expected_qty),
            received_qty: received,
            accepted_qty: accepted,
            rejected_qty: n(i.damaged_qty),
            lots: accepted > 0 ? [{ lot_code: nul(i.lot_code), expiration_date: i.expiry_date, quantity: accepted }] : [],
          };
        }),
      };
    }
    case "divergence.registered": {
      const [d] = await tx.query<{
        divergence_type: string;
        quantity: number | null;
        receipt_code: string | null;
        atlas_purchase_order_id: string | null;
        atlas_product_id: string | null;
        sku: string | null;
        expected_qty: number | null;
        counted_qty: number | null;
      }>(
        `select d.divergence_type, d.quantity::float8 as quantity, r.code as receipt_code, po.external_id as atlas_purchase_order_id,
                p.external_id as atlas_product_id, p.sku, ri.expected_qty::float8 as expected_qty, ri.counted_qty::float8 as counted_qty
         from wms.divergences d left join wms.receipts r on r.id = d.receipt_id
         left join erp.purchase_orders po on po.id = r.purchase_order_id
         left join erp.products p on p.id = d.product_id left join wms.receipt_items ri on ri.id = d.receipt_item_id
         where d.id = $1`,
        [aggregateId],
      );
      if (!d) return legacy;
      const kind =
        d.divergence_type === "shortage" ? "quantity_short" : d.divergence_type === "overage" ? "quantity_over" : d.divergence_type;
      return {
        ...legacy,
        code: String(legacy.code ?? `DIV-${aggregateId.slice(0, 8)}`),
        receipt: d.receipt_code,
        atlas_purchase_order_id: d.atlas_purchase_order_id,
        kind,
        atlas_product_id: d.atlas_product_id,
        sku: d.sku,
        expected_qty: d.expected_qty ?? (legacy.expected as number | undefined) ?? null,
        found_qty: d.counted_qty ?? (legacy.counted as number | undefined) ?? null,
      };
    }
    case "customer_return.completed": {
      const [r] = await tx.query<{ code: string; atlas_sales_order_id: string | null; atlas_customer_id: string | null }>(
        `select cr.code, so.external_id as atlas_sales_order_id, c.external_id as atlas_customer_id
         from wms.customer_returns cr join wms.outbound_orders o on o.id = cr.outbound_order_id
         left join erp.sales_orders so on so.id = o.sales_order_id left join erp.customers c on c.id = so.customer_id
         where cr.id = $1`,
        [aggregateId],
      );
      const items = await tx.query<{
        atlas_product_id: string | null;
        sku: string;
        lot_code: string;
        quantity: number;
        approved_qty: number;
        damaged_qty: number;
        discarded_qty: number;
      }>(
        `select p.external_id as atlas_product_id, p.sku, i.lot_code, i.quantity::float8 as quantity, i.approved_qty::float8 as approved_qty,
                i.damaged_qty::float8 as damaged_qty, i.discarded_qty::float8 as discarded_qty
         from wms.customer_return_items i join erp.products p on p.id = i.product_id where i.return_id = $1 order by i.line_no`,
        [aggregateId],
      );
      return {
        ...legacy,
        code: r.code,
        atlas_sales_order_id: r.atlas_sales_order_id,
        atlas_customer_id: r.atlas_customer_id,
        invoice_access_key: null,
        items: items.map((i) => {
          const scrapped = n(i.damaged_qty) + n(i.discarded_qty);
          return {
            atlas_product_id: i.atlas_product_id,
            sku: i.sku,
            lot_code: nul(i.lot_code),
            returned_qty: n(i.quantity),
            restocked_qty: n(i.approved_qty),
            scrapped_qty: scrapped,
            disposition: scrapped === 0 ? "restock" : n(i.approved_qty) === 0 ? "scrap" : "partial_restock",
          };
        }),
      };
    }
    case "inventory.approved": {
      const rows = await tx.query<{
        atlas_product_id: string | null;
        sku: string;
        lot_code: string;
        warehouse_code: string;
        expected_qty: number;
        counted_qty: number;
      }>(
        `select p.external_id as atlas_product_id, p.sku, i.lot_code, w.code as warehouse_code,
                sum(i.expected_qty)::float8 as expected_qty, sum(i.counted_qty)::float8 as counted_qty
         from wms.inventory_count_items i join wms.inventory_counts c on c.id = i.inventory_id
         join wms.warehouses w on w.id = c.warehouse_id join erp.products p on p.id = i.product_id
         where i.inventory_id = $1 and i.adjusted group by p.external_id, p.sku, i.lot_code, w.code order by p.sku, i.lot_code`,
        [aggregateId],
      );
      return {
        ...legacy,
        scope: "cyclic",
        adjustments: rows.map((r) => ({
          atlas_product_id: r.atlas_product_id,
          sku: r.sku,
          lot_code: nul(r.lot_code),
          orion_warehouse_code: r.warehouse_code,
          expected_qty: n(r.expected_qty),
          counted_qty: n(r.counted_qty),
          delta: Math.round((n(r.counted_qty) - n(r.expected_qty)) * 1000) / 1000,
          reason: "inventory_count",
        })),
      };
    }
    case "production.materials_delivered":
    case "production.leftovers_returned":
    case "production.output_received": {
      const [r] = await tx.query<{ atlas_production_order_id: string | null; number: string }>(
        `select po.external_id as atlas_production_order_id, po.number
         from wms.production_requisitions r join erp.production_orders po on po.id = r.production_order_id where r.id = $1`,
        [aggregateId],
      );
      const materials = await tx.query<{ sku: string; atlas_material_id: string | null; atlas_product_id: string | null }>(
        `select p.sku, c.external_id as atlas_material_id, p.external_id as atlas_product_id
         from wms.production_requisition_lines x join erp.products p on p.id = x.product_id
         left join erp.production_order_components c on c.id = x.component_id where x.requisition_id = $1`,
        [aggregateId],
      );
      const bySku = new Map(materials.map((m) => [m.sku, m]));
      const base = { ...legacy, atlas_production_order_id: r?.atlas_production_order_id ?? null, order: r?.number ?? legacy.productionOrder };
      if (eventType === "production.materials_delivered") {
        const items = (legacy.items as { sku: string; lot: string; quantity: number }[]) ?? [];
        return {
          ...base,
          received_by: legacy.receivedBy ?? null,
          items: items.map((i) => ({
            atlas_material_id: bySku.get(i.sku)?.atlas_material_id ?? null,
            atlas_product_id: bySku.get(i.sku)?.atlas_product_id ?? null,
            sku: i.sku,
            lot_code: nul(i.lot),
            quantity: n(i.quantity),
          })),
        };
      }
      const sku = String(legacy.sku);
      const ext = bySku.get(sku) ?? { atlas_material_id: null, atlas_product_id: (await productExt(tx, companyId, [sku])).get(sku) ?? null };
      if (eventType === "production.leftovers_returned") {
        return { ...base, atlas_material_id: ext.atlas_material_id, atlas_product_id: ext.atlas_product_id, lot_code: nul(legacy.lot as string) };
      }
      return {
        ...base,
        atlas_product_id: (await productExt(tx, companyId, [sku])).get(sku) ?? null,
        lot_code: nul(legacy.lot as string),
        expiration_date: (legacy.expiryDate as string | null) ?? null,
        total_received: n(legacy.totalReceived),
      };
    }
    case "import.cleared": {
      const [r] = await tx.query<{ atlas_purchase_order_id: string | null }>(
        `select po.external_id as atlas_purchase_order_id from wms.receipts r left join erp.purchase_orders po on po.id = r.purchase_order_id
         where r.id = $1`,
        [aggregateId],
      );
      const items = (legacy.items as { sku: string; ncm: string | null; lot_code: string; expected_qty: number; counted_qty: number | null }[]) ?? [];
      const ext = await productExt(tx, companyId, items.map((i) => i.sku));
      const decl = (legacy.declaration as { type?: string; number?: string }) ?? {};
      return {
        ...legacy,
        atlas_purchase_order_id: r?.atlas_purchase_order_id ?? null,
        declaration: { type: decl.type ?? "DI", number: decl.number ?? "", cleared_at: legacy.clearedOn },
        origin_country: legacy.originCountry ?? null,
        items: items.map((i) => ({
          atlas_product_id: ext.get(i.sku) ?? null,
          sku: i.sku,
          ncm: i.ncm,
          lot_code: nul(i.lot_code),
          quantity: n(i.counted_qty ?? i.expected_qty),
        })),
      };
    }
    case "export.packed": {
      const o = await outboundHeader(tx, aggregateId);
      const packages = (legacy.packages as { no: number; grossWeightKg: number; items: { sku: string; lot: string; quantity: number; ncm: string | null; originCountry: string | null }[] }[]) ?? [];
      const ext = await productExt(tx, companyId, packages.flatMap((p) => p.items.map((i) => i.sku)));
      const totals = (legacy.totals as { grossWeightKg?: number; netWeightKg?: number; volumeM3?: number }) ?? {};
      return {
        ...legacy,
        atlas_sales_order_id: o.atlas_sales_order_id,
        incoterm: legacy.incoterm ?? null,
        destination_country: legacy.destinationCountry ?? null,
        invoice: legacy.commercialInvoice ?? null,
        due_number: legacy.exportDeclaration ?? null,
        gross_weight_kg: totals.grossWeightKg ?? null,
        net_weight_kg: totals.netWeightKg ?? null,
        volume_m3: totals.volumeM3 ?? null,
        packages: packages.map((p) => ({
          number: p.no,
          type: "package",
          gross_weight_kg: p.grossWeightKg,
          items: p.items.map((i) => ({
            atlas_product_id: ext.get(i.sku) ?? null,
            sku: i.sku,
            lot_code: nul(i.lot),
            quantity: i.quantity,
            ncm: i.ncm,
            origin_country: i.originCountry,
          })),
        })),
      };
    }
    default:
      return legacy;
  }
}
