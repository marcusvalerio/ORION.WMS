import "server-only";
import type { Db } from "../db/types";
import type { Ctx, SessionUser } from "../context";
import { loadSessionUser } from "../auth/users";
import { formatLocationCode } from "../services/warehouse";
import { adjustStock } from "../services/stock";
import { approveInventory, createInventory, recordCounts, submitInventory } from "../services/inventory";

/**
 * VITRINE DO INVENTÁRIO (somente modo demonstração / `npm run db:seed`): um segundo depósito,
 * "CD-02", com porta-paletes de 4 ruas × 8 módulos × 4 níveis e uma rua de picking, saldo
 * carregado por ajuste auditado, 5 inventários rotativos já aprovados (ciclos anteriores, com
 * datas retroativas mensais) e um inventário geral em contagem (~60% dos endereços contados).
 *
 * Tudo passa pelos serviços reais (ajuste de saldo e aprovação via stock-core). Fica fora de
 * `seedDemo` para não mudar os números do roteiro de testes.
 */
export async function seedInventoryShowcase(db: Db): Promise<void> {
  const [company] = await db.query<{ id: string }>(`select id from erp.companies where is_demo order by created_at limit 1`);
  if (!company) return;
  const c = company.id;
  const [exists] = await db.query(`select 1 from wms.warehouses where company_id = $1 and code = 'CD-02'`, [c]);
  if (exists) return;
  const userId = async (email: string) => (await db.query<{ id: string }>(`select id from wms.users where email = $1`, [email]))[0].id;
  const ctxOf = async (email: string): Promise<Ctx> => ({ db, user: (await loadSessionUser(db, await userId(email))) as SessionUser });
  const admin = await ctxOf("admin@metalsupply.demo");
  const supervisor = await ctxOf("supervisor@metalsupply.demo");

  const { wh, zA, products } = await db.transaction(async (tx) => {
    const [w] = await tx.query<{ id: string }>(
      `insert into wms.warehouses (company_id, code, name, address, created_by)
       values ($1, 'CD-02', 'Centro de Distribuição Leste', 'Endereço de demonstração', $2) returning id`,
      [c, admin.user.id],
    );
    const zone = async (code: string, name: string, type: string) =>
      (
        await tx.query<{ id: string }>(
          `insert into wms.zones (company_id, warehouse_id, code, name, zone_type) values ($1,$2,$3,$4,$5) returning id`,
          [c, w.id, code, name, type],
        )
      )[0].id;
    const zoneA = await zone("A", "Porta-paletes", "storage");
    const zoneB = await zone("B", "Picking", "picking");
    const loc = (zoneId: string, aisle: string, bay: string, level: string, type: string, cap: number, maxKg: number | null) =>
      tx.query(
        `insert into wms.locations (company_id, warehouse_id, zone_id, aisle, bay, level, position, code, location_type,
                                    storage_class, capacity_units, max_weight_kg, created_by)
         values ($1,$2,$3,$4,$5,$6,'00',$7,$8,'general',$9,$10,$11)`,
        [c, w.id, zoneId, aisle, bay, level, formatLocationCode("CD-02", { aisle, bay, level, position: "00" }), type, cap, maxKg, admin.user.id],
      );
    for (const aisle of ["01", "02", "03", "04"])
      for (let b = 1; b <= 8; b++) for (let l = 1; l <= 4; l++) await loc(zoneA, aisle, String(b).padStart(2, "0"), String(l).padStart(2, "0"), "rack", 48, 1000);
    for (let b = 1; b <= 8; b++) for (let l = 1; l <= 2; l++) await loc(zoneB, "05", String(b).padStart(2, "0"), String(l).padStart(2, "0"), "shelf", 60, null);

    const prods: string[] = [];
    for (const [sku, desc, kg, price] of [
      ["CXI-101", "Caixa isotérmica 12L", 1.2, 48.9],
      ["ROL-102", "Rolamento 6204 ZZ", 0.11, 18.5],
      ["FIL-103", "Filtro de ar industrial", 2.4, 96],
      ["PAR-104", "Parafuso sextavado M8 (cx 100)", 1.6, 32.4],
    ] as const) {
      const [p] = await tx.query<{ id: string }>(
        `insert into erp.products (company_id, sku, description, uom, category, weight_kg) values ($1,$2,$3,'UN','Distribuição',$4) returning id`,
        [c, sku, desc, kg],
      );
      await tx.query(`insert into wms.product_settings (product_id, company_id, storage_class) values ($1,$2,'general')`, [p.id, c]);
      prods.push(p.id);
      void price;
    }
    // preço de compra (base do ajuste em valor): pedido já recebido, só como referência de custo
    const [supplier] = await tx.query<{ id: string }>(`select id from erp.suppliers where company_id = $1 order by code limit 1`, [c]);
    const [po] = await tx.query<{ id: string }>(
      `insert into erp.purchase_orders (company_id, number, supplier_id, expected_date, status, created_at)
       values ($1, 'PC-4700', $2, current_date - 200, 'received', now() - interval '200 days') returning id`,
      [c, supplier.id],
    );
    const prices = [48.9, 18.5, 96, 32.4];
    for (let i = 0; i < prods.length; i++)
      await tx.query(`insert into erp.purchase_order_items (purchase_order_id, line_no, product_id, quantity, unit_price) values ($1,$2,$3,100,$4)`, [
        po.id,
        i + 1,
        prods[i],
        prices[i],
      ]);
    return { wh: w.id, zA: zoneA, products: prods };
  });

  // saldo inicial: ~80% das posições ocupadas, com ocupações variadas (determinístico)
  const locs = await db.query<{ id: string; aisle: string; bay: string; level: string; capacity_units: number }>(
    `select id, aisle, bay, level, capacity_units from wms.locations where warehouse_id = $1 order by code`,
    [wh],
  );
  for (const [k, l] of locs.entries()) {
    const h = (Number(l.aisle) * 31 + Number(l.bay) * 17 + Number(l.level) * 7) % 23;
    if (h >= 19) continue;
    const pct = [0.35, 0.9, 0.6, 0.15, 0.8, 0.5, 0.94, 0.45, 0.7, 0.25, 0.92][h % 11];
    await adjustStock(admin, {
      locationId: l.id,
      productId: products[k % products.length],
      direction: "in",
      quantity: Math.max(1, Math.round(Number(l.capacity_units) * pct)),
      reason: "Carga inicial de saldo — vitrine do inventário (demonstração)",
    });
  }

  // ciclos anteriores: inventários rotativos da zona A, aprovados mês a mês
  const misses = [5, 4, 4, 3, 2];
  for (const [cycle, miss] of misses.entries()) {
    const { id } = await createInventory(supervisor, { warehouseId: wh, countType: "cyclic", zoneId: zA, notes: `Ciclo rotativo ${cycle + 1} (demonstração)` });
    const items = await db.query<{ id: string; expected_qty: number }>(`select id, expected_qty from wms.inventory_count_items where inventory_id = $1 order by id`, [id]);
    await recordCounts(supervisor, id, {
      items: items.map((i, k) => ({
        itemId: i.id,
        countedQty: k < miss * 7 && k % 7 === cycle % 7 ? Math.max(0, Number(i.expected_qty) + (k % 2 ? 1 : -2)) : Number(i.expected_qty),
      })),
    });
    await submitInventory(supervisor, id);
    await approveInventory(admin, id, { notes: "Ciclo aprovado (demonstração)" });
    const monthsAgo = misses.length - cycle;
    await db.query(
      `update wms.inventory_counts set created_at = now() - ($2 * interval '30 days') - interval '6 hours',
              submitted_at = now() - ($2 * interval '30 days') - interval '1 hour', approved_at = now() - ($2 * interval '30 days')
       where id = $1`,
      [id, monthsAgo],
    );
    await db.query(`update wms.inventory_count_items set counted_at = now() - ($2 * interval '30 days') - interval '2 hours' where inventory_id = $1`, [
      id,
      monthsAgo,
    ]);
  }

  // inventário atual: geral do CD-02, em contagem, ~60% dos endereços contados nas últimas 2 horas
  const { id } = await createInventory(supervisor, { warehouseId: wh, countType: "general", notes: "Inventário geral do CD Leste (demonstração)" });
  const items = await db.query<{ id: string; expected_qty: number; aisle: string; bay: string }>(
    `select i.id, i.expected_qty, l.aisle, l.bay from wms.inventory_count_items i join wms.locations l on l.id = i.location_id
     where i.inventory_id = $1 order by l.code`,
    [id],
  );
  const counted = items.filter((i) => Number(i.aisle) <= 2 || (Number(i.aisle) === 3 && Number(i.bay) <= 4) || (Number(i.aisle) === 5 && Number(i.bay) <= 3));
  await recordCounts(supervisor, id, {
    items: counted.map((i, k) => ({ itemId: i.id, countedQty: k % 61 === 11 ? Number(i.expected_qty) - 1 : Number(i.expected_qty) })),
  });
  for (const [k, i] of counted.entries()) {
    await db.query(`update wms.inventory_count_items set counted_at = now() - ($2 * interval '1 minute') where id = $1`, [
      i.id,
      Math.round((counted.length - k) * 1.6),
    ]);
  }
}
