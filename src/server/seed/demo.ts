import "server-only";
import type { Db, Queryable } from "../db/types";
import type { Ctx, SessionUser } from "../context";
import { hashPassword } from "../auth/password";
import { loadSessionUser } from "../auth/users";
import { formatLocationCode } from "../services/warehouse";
import { adjustStock } from "../services/stock";

/**
 * DADOS DE DEMONSTRAÇÃO — empresa fictícia "MetalSupply Componentes".
 * Todos os registros são marcados como demonstração (erp.companies.is_demo,
 * wms.users.is_demo) e a interface exibe um selo "Demonstração".
 * Senha de todos os usuários demo: DEMO_PASSWORD (documentada no README).
 */
export const DEMO_PASSWORD = "orion-demo";

export const DEMO_USERS = [
  { email: "admin@metalsupply.demo", name: "Ana Administradora", role: "admin" },
  { email: "supervisor@metalsupply.demo", name: "Sérgio Supervisor", role: "supervisor" },
  { email: "operador@metalsupply.demo", name: "Otávio Operador", role: "operator" },
  { email: "auditor@metalsupply.demo", name: "Aurora Auditora", role: "auditor" },
] as const;

export async function seedDemoIfEmpty(db: Db): Promise<boolean> {
  const [row] = await db.query<{ n: number }>("select count(*) as n from erp.companies");
  if (row.n > 0) return false;
  await seedDemo(db);
  return true;
}

async function insert<T = { id: string }>(tx: Queryable, sql: string, params: unknown[]): Promise<T> {
  const [r] = await tx.query<T>(sql, params);
  return r;
}

export async function seedDemo(db: Db): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const ids = await db.transaction(async (tx) => {
    const company = await insert(tx, `insert into erp.companies (name, is_demo) values ('MetalSupply Componentes', true) returning id`, []);
    const c = company.id;
    const users: Record<string, string> = {};
    for (const u of DEMO_USERS) {
      const r = await insert(
        tx,
        `insert into wms.users (company_id, name, email, role, password_hash, is_demo) values ($1,$2,$3,$4,$5,true) returning id`,
        [c, u.name, u.email, u.role, passwordHash],
      );
      users[u.role] = r.id;
    }

    // ---------------- ERP: cadastros mestres ----------------
    const supplier = await insert(
      tx,
      `insert into erp.suppliers (company_id, code, name) values ($1, 'FOR-001', 'Aço Forte Distribuidora (demo)') returning id`,
      [c],
    );
    const supplier2 = await insert(
      tx,
      `insert into erp.suppliers (company_id, code, name) values ($1, 'FOR-002', 'Química Delta Insumos (demo)') returning id`,
      [c],
    );
    const customer = await insert(
      tx,
      `insert into erp.customers (company_id, code, name) values ($1, 'CLI-001', 'Indústria Horizonte (demo)') returning id`,
      [c],
    );
    const customer2 = await insert(
      tx,
      `insert into erp.customers (company_id, code, name) values ($1, 'CLI-002', 'Montadora Vértice (demo)') returning id`,
      [c],
    );
    const product = async (sku: string, description: string, barcode: string, category: string, weight: number, dims: number[]) =>
      (
        await insert(
          tx,
          `insert into erp.products (company_id, sku, description, barcode, uom, category, weight_kg, length_cm, width_cm, height_cm)
           values ($1,$2,$3,$4,'UN',$5,$6,$7,$8,$9) returning id`,
          [c, sku, description, barcode, category, weight, ...dims],
        )
      ).id;
    const pA = await product("CIA-001", "Componente Industrial A", "7890000000017", "Componentes", 0.5, [20, 15, 10]);
    const pB = await product("LUB-002", "Lubrificante Industrial B 1L", "7890000000024", "Insumos", 1.1, [10, 10, 25]);
    const pC = await product("ADE-003", "Adesivo Epóxi C (refrigerado)", "7890000000031", "Insumos", 0.3, [8, 8, 15]);
    const pD = await product("CHP-004", "Chapa de Aço D 2mm", "7890000000048", "Matéria-prima", 12, [100, 50, 1]);

    const settings = async (productId: string, lot: boolean, expiry: boolean, cls: string, max: number | null) =>
      tx.query(
        `insert into wms.product_settings (product_id, company_id, lot_controlled, expiry_controlled, storage_class, max_units_per_location)
         values ($1,$2,$3,$4,$5,$6)`,
        [productId, c, lot, expiry, cls, max],
      );
    await settings(pA, false, false, "general", null);
    await settings(pB, true, true, "general", null);
    await settings(pC, true, true, "refrigerated", null);
    await settings(pD, false, false, "bulky", null);
    await tx.query(
      `insert into wms.packaging_units (company_id, product_id, code, description, units_per_package, barcode)
       values ($1,$2,'CX10','Caixa com 10 unidades',10,'17890000000014'), ($1,$2,'PLT200','Palete com 200 unidades',200,null)`,
      [c, pA],
    );

    const po = async (number: string, supplierId: string, invoice: string | null, items: [string, number][]) => {
      const r = await insert(
        tx,
        `insert into erp.purchase_orders (company_id, number, supplier_id, expected_date, invoice_number)
         values ($1,$2,$3, current_date, $4) returning id`,
        [c, number, supplierId, invoice],
      );
      let line = 1;
      for (const [productId, q] of items) {
        await tx.query(
          `insert into erp.purchase_order_items (purchase_order_id, line_no, product_id, quantity, unit_price) values ($1,$2,$3,$4,10)`,
          [r.id, line++, productId, q],
        );
      }
      return r.id;
    };
    await po("PC-4587", supplier.id, "NF 000.123", [[pA, 100]]);
    await po("PC-4588", supplier2.id, "NF 000.456", [
      [pB, 60],
      [pC, 40],
    ]);

    const so = async (number: string, customerId: string, items: [string, number][]) => {
      const r = await insert(tx, `insert into erp.sales_orders (company_id, number, customer_id) values ($1,$2,$3) returning id`, [
        c,
        number,
        customerId,
      ]);
      let line = 1;
      for (const [productId, q] of items) {
        await tx.query(`insert into erp.sales_order_items (sales_order_id, line_no, product_id, quantity) values ($1,$2,$3,$4)`, [
          r.id,
          line++,
          productId,
          q,
        ]);
      }
    };
    await so("PV-1001", customer.id, [[pA, 20]]);
    await so("PV-1002", customer2.id, [[pA, 500]]);

    // ---------------- WMS: estrutura física ----------------
    const wh = await insert(
      tx,
      `insert into wms.warehouses (company_id, code, name, address, created_by)
       values ($1, 'DEP-01', 'Almoxarifado Central', 'Endereço de demonstração', $2) returning id`,
      [c, users.admin],
    );
    const zone = async (code: string, name: string, type: string) =>
      (
        await insert(
          tx,
          `insert into wms.zones (company_id, warehouse_id, code, name, zone_type) values ($1,$2,$3,$4,$5) returning id`,
          [c, wh.id, code, name, type],
        )
      ).id;
    const zArm = await zone("ARM", "Armazenagem geral", "storage");
    const zFri = await zone("FRI", "Câmara refrigerada", "storage");
    const zVol = await zone("VOL", "Blocado / volumosos", "storage");
    const zExp = await zone("EXP", "Docas de expedição", "shipping");
    const zQua = await zone("QUA", "Quarentena / qualidade", "quarantine");

    const loc = async (zoneId: string, aisle: string, bay: string, level: string, position: string, type: string, cls: string | null, cap: number) =>
      tx.query(
        `insert into wms.locations (company_id, warehouse_id, zone_id, aisle, bay, level, position, code, location_type,
                                    storage_class, capacity_units, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [c, wh.id, zoneId, aisle, bay, level, position, formatLocationCode("DEP-01", { aisle, bay, level, position }), type, cls, cap, users.admin],
      );
    for (const bay of ["01", "02", "03"]) for (const level of ["01", "02"]) await loc(zArm, "01", bay, level, "00", "rack", "general", 200);
    for (const bay of ["01", "02"]) for (const level of ["01", "02"]) await loc(zArm, "02", bay, level, "00", "shelf", "general", 100);
    for (const bay of ["01", "02"]) await loc(zFri, "03", bay, "01", "00", "rack", "refrigerated", 50);
    for (const bay of ["01", "02"]) await loc(zVol, "04", bay, "00", "00", "floor", "bulky", 80);
    await loc(zExp, "EX", "01", "00", "00", "dock", null, 5000);
    await loc(zQua, "QA", "01", "00", "00", "quarantine", null, 500);

    return { company: c, admin: users.admin, pB, pD, wh: wh.id };
  });

  // Carga inicial de saldo para outros produtos, registrada como ajuste auditado.
  const admin = (await loadSessionUser(db, ids.admin)) as SessionUser;
  const ctx: Ctx = { db, user: admin };
  const [l1] = await db.query<{ id: string }>(`select id from wms.locations where code = 'DEP-01/RUA-02/MOD-01/NIV-01/POS-00'`);
  const [l2] = await db.query<{ id: string }>(`select id from wms.locations where code = 'DEP-01/RUA-04/MOD-01/NIV-00/POS-00'`);
  const expiry = new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);
  await adjustStock(ctx, {
    locationId: l1.id,
    productId: ids.pB,
    lotCode: "L2026-01",
    expiryDate: expiry,
    direction: "in",
    quantity: 30,
    reason: "Carga inicial de saldo — dados de demonstração",
  });
  await adjustStock(ctx, {
    locationId: l2.id,
    productId: ids.pD,
    lotCode: "",
    direction: "in",
    quantity: 40,
    reason: "Carga inicial de saldo — dados de demonstração",
  });
}
