import "server-only";
import { z } from "zod";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError } from "../errors";
import { parse, uuid } from "../validation";
import { audit, round3, runOperation, type OpOptions } from "./common";
import { createTransfer } from "./tasks";

/**
 * Curva ABC por giro e sugestão de reendereçamento (slotting).
 *
 * Giro = unidades separadas (soma das movimentações "pick") ou linhas separadas
 * (quantidade de movimentações "pick") nos últimos N dias. Os produtos são
 * ordenados do maior para o menor giro; a participação acumulada define a
 * classe: A até a_pct, B até a_pct + b_pct, C no restante (incluindo produtos
 * com estoque e sem giro no período).
 */

export interface SlottingSettings {
  days: number;
  basis: "units" | "lines";
  a_pct: number;
  b_pct: number;
}

export const DEFAULT_SLOTTING: SlottingSettings = { days: 90, basis: "units", a_pct: 80, b_pct: 15 };

export async function getSlottingSettings(ctx: Ctx): Promise<SlottingSettings> {
  const [row] = await ctx.db.query<SlottingSettings>(
    `select days, basis, a_pct, b_pct from wms.slotting_settings where company_id = $1`,
    [ctx.user.companyId],
  );
  return row ?? DEFAULT_SLOTTING;
}

const settingsSchema = z
  .object({
    days: z.coerce.number().int().min(7, "Período mínimo de 7 dias.").max(730, "Período máximo de 730 dias."),
    basis: z.enum(["units", "lines"]),
    aPct: z.coerce.number().positive("Percentual A inválido."),
    bPct: z.coerce.number().positive("Percentual B inválido."),
  })
  .refine((v) => v.aPct + v.bPct < 100, { message: "A + B deve ser menor que 100% (o restante é C).", path: ["bPct"] });

export async function saveSlottingSettings(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "slotting.manage");
  const d = parse(settingsSchema, input);
  return runOperation(ctx, "slotting.settings", opts, async (tx) => {
    await tx.query(
      `insert into wms.slotting_settings (company_id, days, basis, a_pct, b_pct, updated_by) values ($1,$2,$3,$4,$5,$6)
       on conflict (company_id) do update set days = excluded.days, basis = excluded.basis, a_pct = excluded.a_pct,
         b_pct = excluded.b_pct, updated_by = excluded.updated_by, updated_at = now()`,
      [ctx.user.companyId, d.days, d.basis, d.aPct, d.bPct, ctx.user.id],
    );
    await audit(tx, ctx, "slotting.settings_updated", "slotting_settings", null, null, d);
    return { ok: true };
  });
}

export interface AbcRow {
  product_id: string;
  sku: string;
  description: string;
  units: number;
  lines: number;
  metric: number;
  share: number;
  cumulative: number;
  abc: "A" | "B" | "C";
  stock: number;
}

/** Classificação pura (testável): ordena por métrica e aplica os cortes acumulados. */
export function classifyAbc<T extends { metric: number; sku: string }>(rows: T[], aPct: number, bPct: number) {
  const total = rows.reduce((s, r) => s + r.metric, 0);
  const sorted = [...rows].sort((x, y) => y.metric - x.metric || x.sku.localeCompare(y.sku));
  let before = 0;
  return sorted.map((r) => {
    const share = total > 0 ? (r.metric / total) * 100 : 0;
    // A classe é decidida pela participação acumulada ANTES do item: o item que cruza o corte ainda pertence à classe.
    const abc: "A" | "B" | "C" = r.metric <= 0 ? "C" : before < aPct ? "A" : before < aPct + bPct ? "B" : "C";
    before += share;
    return { ...r, share: round3(share), cumulative: round3(before), abc };
  });
}

export async function computeAbc(ctx: Ctx, override?: Partial<SlottingSettings>): Promise<{ settings: SlottingSettings; rows: AbcRow[] }> {
  const settings = { ...(await getSlottingSettings(ctx)), ...override };
  const raw = await ctx.db.query<{ product_id: string; sku: string; description: string; units: number; lines: number; stock: number }>(
    `select p.id as product_id, p.sku, p.description,
            coalesce(m.units, 0) as units, coalesce(m.lines, 0) as lines,
            coalesce((select sum(b.quantity) from wms.stock_balances b where b.product_id = p.id), 0) as stock
     from erp.products p
     left join (select product_id, sum(quantity) as units, count(*) as lines from wms.stock_movements
                where company_id = $1 and movement_type = 'pick' and created_at >= now() - make_interval(days => $2::int)
                group by product_id) m on m.product_id = p.id
     where p.company_id = $1 and (m.product_id is not null or exists (select 1 from wms.stock_balances b where b.product_id = p.id and b.quantity > 0))`,
    [ctx.user.companyId, settings.days],
  );
  const rows = classifyAbc(
    raw.map((r) => ({ ...r, metric: settings.basis === "units" ? r.units : r.lines })),
    settings.a_pct,
    settings.b_pct,
  );
  return { settings, rows: rows as AbcRow[] };
}

// -----------------------------------------------------------------------------
// Slotting
// -----------------------------------------------------------------------------

interface LocRow {
  id: string;
  code: string;
  warehouse_id: string;
  zone_type: string;
  aisle: string;
  bay: string;
  level: string;
  position: string;
  storage_class: string | null;
  capacity_units: number;
  occupied: number;
  incoming: number;
}

const natural = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true });

/**
 * Custo de acesso estimado de um endereço (menor = melhor). Sem planta do
 * armazém, a distância à expedição é estimada pela ordem das ruas e módulos
 * (rua de menor número = mais próxima da expedição), com peso maior para o
 * nível (níveis altos exigem equipamento) e bônus para a zona de picking.
 */
export function accessCost(loc: { zone_type: string; aisleRank: number; bayRank: number; levelRank: number }) {
  return loc.aisleRank * 10 + loc.bayRank + loc.levelRank * 25 + (loc.zone_type === "picking" ? 0 : 50);
}

export interface SlottingSuggestion {
  balance_id: string;
  product_id: string;
  sku: string;
  abc: "A" | "B" | "C";
  lot_code: string;
  available: number;
  from_location_id: string;
  from_code: string;
  from_cost: number;
  to_location_id: string;
  to_code: string;
  to_cost: number;
  reason: string;
}

/**
 * Sugere mover itens A que estão em endereços de custo alto (longe da expedição,
 * fora do picking ou em níveis altos) para endereços ativos, compatíveis e com
 * espaço, de custo menor — preferindo zona de picking e níveis baixos.
 */
export async function slottingSuggestions(ctx: Ctx): Promise<SlottingSuggestion[]> {
  const { rows } = await computeAbc(ctx);
  const aItems = new Map(rows.filter((r) => r.abc === "A").map((r) => [r.product_id, r]));
  if (!aItems.size) return [];
  const locs = await ctx.db.query<LocRow>(
    `select l.id, l.code, l.warehouse_id, z.zone_type, l.aisle, l.bay, l.level, l.position, l.storage_class, l.capacity_units,
            coalesce((select sum(b.quantity) from wms.stock_balances b where b.location_id = l.id), 0) as occupied,
            coalesce((select sum(t.quantity) from wms.tasks t where coalesce(t.to_location_id, t.suggested_location_id) = l.id
                        and t.status in ('pending', 'in_progress') and t.task_type in ('putaway', 'transfer', 'replenishment', 'return')), 0) as incoming
     from wms.locations l join wms.zones z on z.id = l.zone_id
     where l.company_id = $1 and l.status = 'active' and z.active and z.zone_type in ('storage', 'picking')`,
    [ctx.user.companyId],
  );
  const rank = (values: string[]) => {
    const sorted = [...new Set(values)].sort(natural);
    return new Map(sorted.map((v, i) => [v, i]));
  };
  const aisleRank = rank(locs.map((l) => l.aisle));
  const bayRank = rank(locs.map((l) => l.bay));
  const levelRank = rank(locs.map((l) => l.level));
  const cost = new Map(
    locs.map((l) => [
      l.id,
      accessCost({ zone_type: l.zone_type, aisleRank: aisleRank.get(l.aisle)!, bayRank: bayRank.get(l.bay)!, levelRank: levelRank.get(l.level)! }),
    ]),
  );
  const balances = await ctx.db.query<{
    id: string;
    product_id: string;
    location_id: string;
    lot_code: string;
    available: number;
    storage_class: string;
    max_units: number | null;
  }>(
    `select b.id, b.product_id, b.location_id, b.lot_code, b.quantity - b.reserved_qty - b.blocked_qty as available,
            coalesce(s.storage_class, 'general') as storage_class, s.max_units_per_location as max_units
     from wms.stock_balances b left join wms.product_settings s on s.product_id = b.product_id
     where b.company_id = $1 and b.product_id = any($2::uuid[]) and b.quantity - b.reserved_qty - b.blocked_qty > 0`,
    [ctx.user.companyId, [...aItems.keys()]],
  );
  // Endereços que já contêm outro produto não são sugeridos (evita misturar SKUs no picking).
  const occupiedBy = await ctx.db.query<{ location_id: string; product_id: string }>(
    `select distinct location_id, product_id from wms.stock_balances where company_id = $1 and quantity > 0`,
    [ctx.user.companyId],
  );
  const products = new Map<string, Set<string>>();
  for (const r of occupiedBy) {
    if (!products.has(r.location_id)) products.set(r.location_id, new Set());
    products.get(r.location_id)!.add(r.product_id);
  }
  const locById = new Map(locs.map((l) => [l.id, l]));
  const reserved = new Map<string, number>();
  const out: SlottingSuggestion[] = [];
  const sortedBalances = [...balances].sort((x, y) => (cost.get(y.location_id) ?? 0) - (cost.get(x.location_id) ?? 0));
  for (const b of sortedBalances) {
    const from = locById.get(b.location_id);
    if (!from) continue;
    const fromCost = cost.get(from.id)!;
    const best = locs
      .filter((l) => {
        if (l.id === from.id || l.warehouse_id === undefined || l.warehouse_id !== from.warehouse_id) return false;
        if ((l.storage_class ?? "general") !== b.storage_class) return false;
        const others = products.get(l.id);
        if (others && [...others].some((p) => p !== b.product_id)) return false;
        const free = l.capacity_units - l.occupied - l.incoming - (reserved.get(l.id) ?? 0);
        if (free < b.available) return false;
        if (b.max_units && b.available > b.max_units) return false;
        return cost.get(l.id)! < fromCost - 5;
      })
      .sort((x, y) => cost.get(x.id)! - cost.get(y.id)! || natural(x.code, y.code))[0];
    if (!best) continue;
    reserved.set(best.id, (reserved.get(best.id) ?? 0) + b.available);
    const item = aItems.get(b.product_id)!;
    const reasons: string[] = [];
    if (from.zone_type !== "picking" && best.zone_type === "picking") reasons.push("leva o item A para a zona de picking");
    if (natural(best.level, from.level) < 0) reasons.push(`nível ${from.level} → ${best.level}`);
    if (natural(best.aisle, from.aisle) < 0) reasons.push(`rua ${from.aisle} → ${best.aisle} (mais perto da expedição)`);
    out.push({
      balance_id: b.id,
      product_id: b.product_id,
      sku: item.sku,
      abc: item.abc,
      lot_code: b.lot_code,
      available: b.available,
      from_location_id: from.id,
      from_code: from.code,
      from_cost: fromCost,
      to_location_id: best.id,
      to_code: best.code,
      to_cost: cost.get(best.id)!,
      reason: reasons.length ? reasons.join("; ") : "endereço de menor custo de acesso",
    });
  }
  return out;
}

const suggestionSchema = z.object({
  fromLocationId: uuid("Endereço de origem"),
  toLocationId: uuid("Endereço de destino"),
  productId: uuid("Produto"),
  lotCode: z.string().trim().nullish(),
  quantity: z.coerce.number().positive("Quantidade inválida."),
});

/** Gera uma tarefa de transferência a partir de uma sugestão de slotting (validações da transferência). */
export async function createSlottingTransfer(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "slotting.manage");
  const d = parse(suggestionSchema, input);
  if (d.fromLocationId === d.toLocationId) throw new DomainError("Origem e destino não podem ser o mesmo endereço.");
  // A tarefa é criada (e auditada como "transfer.created") pela própria transferência, na mesma transação.
  return createTransfer(
    ctx,
    { fromLocationId: d.fromLocationId, toLocationId: d.toLocationId, productId: d.productId, lotCode: d.lotCode ?? "", quantity: d.quantity, priority: 3 },
    opts,
  );
}
