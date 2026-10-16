import "server-only";
import { z } from "zod";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { NotFoundError } from "../errors";
import { parse, optionalText, optionalUuid, checkbox } from "../validation";
import { audit, runOperation, type OpOptions } from "./common";
import { STORAGE_CLASSES } from "./warehouse";

/**
 * Produtos: o cadastro mestre (SKU, descrição, código de barras, unidade,
 * categoria, status, peso e dimensões) pertence ao ERP (erp.products) e é
 * somente leitura aqui. O WMS mantém apenas os parâmetros logísticos em
 * wms.product_settings e as unidades logísticas em wms.packaging_units.
 */

export interface ProductRow {
  id: string;
  sku: string;
  description: string;
  barcode: string | null;
  uom: string;
  category: string | null;
  status: string;
  weight_kg: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  lot_controlled: boolean;
  expiry_controlled: boolean;
  serial_controlled: boolean;
  storage_class: string;
  max_units_per_location: number | null;
  preferred_zone_id: string | null;
  preferred_zone_code: string | null;
  physical: number;
  reserved: number;
  blocked: number;
}

const PRODUCT_SELECT = `
  select p.id, p.sku, p.description, p.barcode, p.uom, p.category, p.status, p.weight_kg, p.length_cm, p.width_cm, p.height_cm,
         coalesce(s.lot_controlled, false) as lot_controlled,
         coalesce(s.expiry_controlled, false) as expiry_controlled,
         coalesce(s.serial_controlled, false) as serial_controlled,
         coalesce(s.storage_class, 'general') as storage_class,
         s.max_units_per_location, s.preferred_zone_id, z.code as preferred_zone_code,
         coalesce((select sum(b.quantity) from wms.stock_balances b where b.product_id = p.id), 0) as physical,
         coalesce((select sum(b.reserved_qty) from wms.stock_balances b where b.product_id = p.id), 0) as reserved,
         coalesce((select sum(b.blocked_qty) from wms.stock_balances b where b.product_id = p.id), 0) as blocked
  from erp.products p
  left join wms.product_settings s on s.product_id = p.id
  left join wms.zones z on z.id = s.preferred_zone_id`;

export async function listProducts(ctx: Ctx, f: { q?: string | null; status?: string | null; category?: string | null } = {}) {
  return ctx.db.query<ProductRow>(
    `${PRODUCT_SELECT}
     where p.company_id = $1
       and ($2::text is null or p.sku ilike '%' || $2 || '%' or p.description ilike '%' || $2 || '%' or p.barcode = $2)
       and ($3::text is null or p.status = $3)
       and ($4::text is null or p.category = $4)
     order by p.sku`,
    [ctx.user.companyId, f.q || null, f.status || null, f.category || null],
  );
}

export async function getProduct(ctx: Ctx, id: string) {
  const [row] = await ctx.db.query<ProductRow>(`${PRODUCT_SELECT} where p.company_id = $1 and p.id = $2`, [
    ctx.user.companyId,
    id,
  ]);
  return row ?? null;
}

export async function listProductOptions(ctx: Ctx) {
  return ctx.db.query<{ id: string; sku: string; description: string; uom: string; lot_controlled: boolean; expiry_controlled: boolean }>(
    `select p.id, p.sku, p.description, p.uom, coalesce(s.lot_controlled, false) as lot_controlled,
            coalesce(s.expiry_controlled, false) as expiry_controlled
     from erp.products p left join wms.product_settings s on s.product_id = p.id
     where p.company_id = $1 and p.status = 'active' order by p.sku`,
    [ctx.user.companyId],
  );
}

const settingsSchema = z.object({
  lotControlled: checkbox,
  expiryControlled: checkbox,
  serialControlled: checkbox,
  storageClass: z.enum(STORAGE_CLASSES, { error: "Classe de armazenagem inválida." }),
  maxUnitsPerLocation: z
    .union([z.literal("").transform(() => null), z.coerce.number().positive("Máximo por endereço deve ser maior que zero.")])
    .nullish(),
  preferredZoneId: optionalUuid,
});

export async function updateProductSettings(ctx: Ctx, productId: string, input: unknown) {
  assertCan(ctx, "products.manage");
  const d = parse(settingsSchema, input);
  return runOperation(ctx, "product.settings", undefined, async (tx) => {
    const [p] = await tx.query<{ sku: string }>(`select sku from erp.products where id = $1 and company_id = $2`, [
      productId,
      ctx.user.companyId,
    ]);
    if (!p) throw new NotFoundError("Produto");
    await tx.query(
      `insert into wms.product_settings (product_id, company_id, lot_controlled, expiry_controlled, serial_controlled,
                                         storage_class, max_units_per_location, preferred_zone_id, updated_by, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       on conflict (product_id) do update set lot_controlled = excluded.lot_controlled,
         expiry_controlled = excluded.expiry_controlled, serial_controlled = excluded.serial_controlled,
         storage_class = excluded.storage_class, max_units_per_location = excluded.max_units_per_location,
         preferred_zone_id = excluded.preferred_zone_id, updated_by = excluded.updated_by, updated_at = now()`,
      [
        productId,
        ctx.user.companyId,
        d.lotControlled,
        d.expiryControlled,
        d.serialControlled,
        d.storageClass,
        d.maxUnitsPerLocation ?? null,
        d.preferredZoneId ?? null,
        ctx.user.id,
      ],
    );
    await audit(tx, ctx, "product.settings_updated", "product", productId, p.sku, d);
    return { id: productId };
  });
}

export async function listPackaging(ctx: Ctx, productId: string) {
  return ctx.db.query<{ id: string; code: string; description: string | null; units_per_package: number; barcode: string | null; active: boolean }>(
    `select id, code, description, units_per_package, barcode, active from wms.packaging_units
     where company_id = $1 and product_id = $2 order by units_per_package`,
    [ctx.user.companyId, productId],
  );
}

const packagingSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Código da embalagem é obrigatório.")
    .max(20)
    .transform((v) => v.toUpperCase()),
  description: optionalText,
  unitsPerPackage: z.coerce.number({ error: "Fator inválido." }).positive("Unidades por embalagem deve ser maior que zero."),
  barcode: optionalText,
});

/** Cadastra uma unidade logística. Não altera saldos: o estoque é sempre na unidade base. */
export async function addPackaging(ctx: Ctx, productId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "products.manage");
  const d = parse(packagingSchema, input);
  return runOperation(ctx, "product.packaging", opts, async (tx) => {
    const [p] = await tx.query<{ sku: string }>(`select sku from erp.products where id = $1 and company_id = $2`, [
      productId,
      ctx.user.companyId,
    ]);
    if (!p) throw new NotFoundError("Produto");
    const [row] = await tx.query<{ id: string }>(
      `insert into wms.packaging_units (company_id, product_id, code, description, units_per_package, barcode)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [ctx.user.companyId, productId, d.code, d.description, d.unitsPerPackage, d.barcode],
    );
    await audit(tx, ctx, "product.packaging_added", "product", productId, p.sku, d);
    return { id: row.id };
  });
}

export async function setPackagingActive(ctx: Ctx, packagingId: string, active: boolean) {
  assertCan(ctx, "products.manage");
  return runOperation(ctx, "product.packaging_status", undefined, async (tx) => {
    const rows = await tx.query<{ product_id: string; code: string }>(
      `update wms.packaging_units set active = $3 where id = $1 and company_id = $2 returning product_id, code`,
      [packagingId, ctx.user.companyId, active],
    );
    if (!rows[0]) throw new NotFoundError("Embalagem");
    await audit(tx, ctx, active ? "product.packaging_activated" : "product.packaging_deactivated", "product", rows[0].product_id, rows[0].code);
    return { id: packagingId };
  });
}
