import "server-only";
import type { Db } from "../db/types";
import type { Ctx, SessionUser } from "../context";
import { loadSessionUser } from "../auth/users";
import { createLocation, createZone, formatLocationCode } from "../services/warehouse";
import { createDock } from "../services/docks";
import { adjustStock } from "../services/stock";
import { approveInventory, createInventory, recordCounts, submitInventory } from "../services/inventory";
import * as receiving from "../services/receiving";
import * as outbound from "../services/outbound";
import * as tasks from "../services/tasks";
import { withMovementClock } from "../services/stock-core";
import { processOutbox } from "../integrations/outbox/processor";
import { localTransport } from "../integrations/outbox/transports";
import { logEmailTransport } from "../integrations/outbox/email";

/**
 * VITRINE DO INVENTÁRIO (somente modo demonstração / `npm run db:seed`): um segundo depósito,
 * "CD-02", com porta-paletes de 4 ruas × 8 módulos × 4 níveis e uma rua de picking (mais docas
 * e câmara refrigerada em `seedCdOperations`), saldo
 * carregado por ajuste auditado, 5 inventários rotativos já aprovados (ciclos anteriores, com
 * datas retroativas mensais) e um inventário geral em contagem (~60% dos endereços contados).
 *
 * Tudo passa pelos serviços reais (ajuste de saldo e aprovação via stock-core). Fica fora de
 * `seedDemo` para não mudar os números do roteiro de testes.
 */
export async function seedInventoryShowcase(db: Db): Promise<void> {
  await seedCdMapShowcase(db);
  await seedCdOperations(db);
  await seedFlowShowcase(db);
}

/**
 * CD-02 operável (é o primeiro depósito nos formulários): recebimento, expedição e uma pequena
 * câmara refrigerada, para que pedidos/ondas e a NF-e de exemplo (com ADE-003 refrigerado)
 * funcionem também neste depósito. Criado pelos serviços reais (zona, endereço e doca, com
 * auditoria). Idempotente item a item — completa também bancos de demonstração já existentes.
 */
export async function seedCdOperations(db: Db): Promise<void> {
  const [company] = await db.query<{ id: string }>(`select id from erp.companies where is_demo order by created_at limit 1`);
  if (!company) return;
  const [wh] = await db.query<{ id: string }>(`select id from wms.warehouses where company_id = $1 and code = 'CD-02'`, [company.id]);
  const [u] = await db.query<{ id: string }>(`select id from wms.users where email = 'admin@metalsupply.demo'`);
  if (!wh || !u) return;
  const admin: Ctx = { db, user: (await loadSessionUser(db, u.id)) as SessionUser };

  const zone = async (code: string, name: string, zoneType: string) => {
    const [z] = await db.query<{ id: string }>(`select id from wms.zones where warehouse_id = $1 and code = $2`, [wh.id, code]);
    return z ? z.id : (await createZone(admin, { warehouseId: wh.id, code, name, zoneType })).id;
  };
  const loc = async (zoneId: string, aisle: string, bay: string, level: string, locationType: string, storageClass: string | null, capacityUnits: number) => {
    const code = formatLocationCode("CD-02", { aisle, bay, level, position: "00" });
    const [l] = await db.query(`select 1 from wms.locations where warehouse_id = $1 and code = $2`, [wh.id, code]);
    if (!l) await createLocation(admin, { zoneId, aisle, bay, level, position: "00", locationType, storageClass, capacityUnits });
  };
  const dock = async (code: string, name: string, dockType: string) => {
    const [d] = await db.query(`select 1 from wms.docks where warehouse_id = $1 and code = $2`, [wh.id, code]);
    if (!d) await createDock(admin, { warehouseId: wh.id, code, name, dockType });
  };

  const zRec = await zone("REC", "Docas de recebimento", "receiving");
  await loc(zRec, "RC", "01", "00", "dock", null, 5000);
  const zExp = await zone("EXP", "Docas de expedição", "shipping");
  await loc(zExp, "EX", "01", "00", "dock", null, 5000);
  const zFri = await zone("FRI", "Câmara refrigerada", "storage");
  for (const bay of ["01", "02"]) await loc(zFri, "06", bay, "01", "rack", "refrigerated", 50);
  await dock("DOC-01", "Doca 1 — recebimento", "inbound");
  await dock("DOC-02", "Doca 2 — expedição", "outbound");
}

async function seedCdMapShowcase(db: Db): Promise<void> {
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

export const FLOW_DAYS = 14;
const FLOW_MARKER = "PC-4900";

/**
 * VITRINE DO FLUXO (gráfico "Recebimentos × expedições" do painel): nos últimos 14 dias, no
 * DEP-01, um recebimento por dia (pedido de compra → recebimento → conferência → liberação →
 * armazenagem) e, na maioria dos dias, uma expedição (pedido de venda → reserva → separação →
 * conferência → expedição) — tudo pelos serviços reais.
 *
 * O histórico de movimentações é imutável e grava `now()`; para cair no dia certo, cada dia é
 * executado dentro de `withMovementClock` (stock-core), que só define o `created_at` no INSERT.
 * Datas dos cabeçalhos (recebimento, pedido, expedição) são recuadas depois, por UPDATE, para
 * ficarem coerentes. Ao final processa a outbox (ERP local + avisos por e-mail registrados).
 * Idempotente: não roda de novo se o pedido marcador PC-4900 já existe.
 */
export async function seedFlowShowcase(db: Db): Promise<void> {
  const [company] = await db.query<{ id: string }>(`select id from erp.companies where is_demo order by created_at limit 1`);
  if (!company) return;
  const c = company.id;
  const [done] = await db.query(`select 1 from erp.purchase_orders where company_id = $1 and number = $2`, [c, FLOW_MARKER]);
  if (done) return;
  const [wh] = await db.query<{ id: string }>(`select id from wms.warehouses where company_id = $1 and code = 'DEP-01'`, [c]);
  const [product] = await db.query<{ id: string }>(`select id from erp.products where company_id = $1 and sku = 'CIA-001'`, [c]);
  const [supplier] = await db.query<{ id: string }>(`select id from erp.suppliers where company_id = $1 order by code limit 1`, [c]);
  const [customer] = await db.query<{ id: string }>(`select id from erp.customers where company_id = $1 order by code limit 1`, [c]);
  if (!wh || !product || !supplier || !customer) return;
  const ctxOf = async (email: string): Promise<Ctx> => {
    const [u] = await db.query<{ id: string }>(`select id from wms.users where email = $1`, [email]);
    return { db, user: (await loadSessionUser(db, u.id)) as SessionUser };
  };
  const sup = await ctxOf("supervisor@metalsupply.demo");
  const op = await ctxOf("operador@metalsupply.demo");
  const admin = await ctxOf("admin@metalsupply.demo");

  // destinatário de demonstração dos avisos por e-mail (transporte de registro: nada é enviado)
  await db.query(
    `insert into wms.company_settings (company_id, key, value, updated_by) values ($1, 'notifications.email_recipients', $2, $3)
     on conflict (company_id, key) do nothing`,
    [c, JSON.stringify(["estoque@metalsupply.demo", "supervisao@metalsupply.demo"]), admin.user.id],
  );

  for (let ago = FLOW_DAYS - 1; ago >= 0; ago--) {
    const n = FLOW_DAYS - 1 - ago; // 0..13
    const received = 40 + ((n * 37) % 55);
    const shipped = n % 5 === 3 ? 0 : 18 + ((n * 23) % 40);
    // horário de trabalho (≈ 9h–16h em São Paulo), nunca no futuro
    const day = new Date(Date.now() - ago * 86_400_000);
    const at = (h: number) => {
      const d = new Date(day);
      d.setUTCHours(h + 3, (n * 7) % 50, 0, 0);
      return d.getTime() > Date.now() ? new Date(Date.now() - (16 - h) * 60_000) : d;
    };

    const poNumber = n === 0 ? FLOW_MARKER : `PC-${4900 + n}`;
    const [po] = await db.query<{ id: string }>(
      `insert into erp.purchase_orders (company_id, number, supplier_id, expected_date, invoice_number, created_at)
       values ($1, $2, $3, $4::date, $5, $6) returning id`,
      [c, poNumber, supplier.id, at(9).toISOString().slice(0, 10), `NF 001.${String(200 + n).padStart(3, "0")}`, at(8).toISOString()],
    );
    await db.query(`insert into erp.purchase_order_items (purchase_order_id, line_no, product_id, quantity, unit_price) values ($1, 1, $2, $3, 10)`, [
      po.id,
      product.id,
      received,
    ]);
    const receiptId = await withMovementClock(at(10), async () => {
      const r = await receiving.createReceiptFromPurchaseOrder(sup, { purchaseOrderId: po.id, warehouseId: wh.id });
      await receiving.startCheck(op, r.id);
      const [item] = await db.query<{ id: string }>(`select id from wms.receipt_items where receipt_id = $1`, [r.id]);
      await receiving.saveCounts(op, r.id, { items: [{ itemId: item.id, countedQty: received }] });
      await receiving.finishCheck(op, r.id, {});
      await receiving.releaseReceipt(sup, r.id);
      const putaways = await db.query<{ id: string }>(`select id from wms.tasks where receipt_id = $1 and status = 'pending'`, [r.id]);
      for (const t of putaways) {
        await tasks.startTask(op, t.id);
        await tasks.completeTask(op, t.id, {});
      }
      return r.id;
    });
    const ts = at(10).toISOString();
    await db.query(
      `update wms.receipts set created_at = $2, arrived_at = $2, check_started_at = $2, checked_at = $2, released_at = $2,
              completed_at = $2::timestamptz + interval '40 minutes', updated_at = $2::timestamptz + interval '40 minutes' where id = $1`,
      [receiptId, ts],
    );
    await db.query(`update wms.tasks set created_at = $2, started_at = $2, completed_at = $2::timestamptz + interval '40 minutes' where receipt_id = $1`, [
      receiptId,
      ts,
    ]);

    if (!shipped) continue;
    const [so] = await db.query<{ id: string }>(
      `insert into erp.sales_orders (company_id, number, customer_id, created_at) values ($1, $2, $3, $4) returning id`,
      [c, `PV-${1900 + n}`, customer.id, at(13).toISOString()],
    );
    await db.query(`insert into erp.sales_order_items (sales_order_id, line_no, product_id, quantity) values ($1, 1, $2, $3)`, [so.id, product.id, shipped]);
    const orderId = await withMovementClock(at(14), async () => {
      const o = await outbound.importSalesOrder(sup, { salesOrderId: so.id, warehouseId: wh.id });
      await outbound.reserveOrder(sup, o.id);
      await outbound.releaseForPicking(sup, o.id);
      const picks = await db.query<{ id: string; quantity: number; from_location_id: string }>(
        `select id, quantity, from_location_id from wms.tasks where order_id = $1 and task_type = 'picking' and status = 'pending'`,
        [o.id],
      );
      for (const t of picks) await tasks.completeTask(op, t.id, { quantity: Number(t.quantity), locationId: t.from_location_id });
      const order = await outbound.getOrder(op, o.id);
      await outbound.checkOrder(op, o.id, { lines: order!.lines.map((l) => ({ lineId: l.id, checkedQty: Number(l.picked_qty) })) });
      return o.id;
    });
    // a expedição sai em outro relógio (fim da tarde): saída de doca
    const shipAt = at(16);
    await withMovementClock(shipAt, () => outbound.shipOrder(op, orderId, { carrier: "Transportadora Demo", vehiclePlate: "DEM0A00" }));
    await db.query(
      `update wms.outbound_orders set created_at = $2, reserved_at = $2, picked_at = $2, checked_at = $2, shipped_at = $3, updated_at = $3 where id = $1`,
      [orderId, at(14).toISOString(), shipAt.toISOString()],
    );
    await db.query(`update wms.shipments set shipped_at = $2 where order_id = $1`, [orderId, shipAt.toISOString()]);
    await db.query(`update wms.tasks set created_at = $2, started_at = $2, completed_at = $2 where order_id = $1`, [orderId, at(14).toISOString()]);
  }

  // entrega a outbox (ERP local) e registra os avisos por e-mail (transporte de registro)
  for (let i = 0; i < 10; i++) {
    const r = await processOutbox(db, { transport: localTransport, email: logEmailTransport, companyId: c, limit: 100 });
    if (!r.claimed) break;
  }
}
