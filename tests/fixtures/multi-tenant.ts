/**
 * Fixture multiempresa: 5 empresas fictícias, 49 funcionários (10/10/10/10/9)
 * com todos os perfis, cada empresa com depósito(s), zonas, endereços, docas,
 * produtos e saldo inicial — criados pelos SERVIÇOS reais (createUser,
 * createWarehouse, createZone, generateLocations, createDock, adjustStock,
 * createManualReceipt, createManualOrder, ...). Só o que não tem serviço é
 * inserido direto: a empresa, o primeiro administrador e os cadastros mestres
 * do ERP (produtos, fornecedor, cliente), que no produto vêm da integração.
 *
 * SKUs, códigos de barras, códigos de depósito/zona/endereço/doca, fornecedor e
 * cliente são IGUAIS entre as empresas de propósito, para pegar colisões.
 */
import type { Ctx } from "@/server/context";
import type { Db } from "@/server/db/types";
import type { Role } from "@/lib/permissions";
import { createPgliteDb, createPostgresDb } from "@/server/db/drivers";
import { runMigrations } from "@/server/db/migrate";
import { hashPassword } from "@/server/auth/password";
import { loadSessionUser } from "@/server/auth/users";
import * as users from "@/server/services/users";
import * as warehouse from "@/server/services/warehouse";
import * as docks from "@/server/services/docks";
import * as stock from "@/server/services/stock";
import * as products from "@/server/services/products";
import * as receiving from "@/server/services/receiving";
import * as outbound from "@/server/services/outbound";
import * as tasks from "@/server/services/tasks";
import * as inventory from "@/server/services/inventory";
import * as waves from "@/server/services/waves";
import * as returns from "@/server/services/returns";
import * as settings from "@/server/services/settings";
import { processQueue } from "@/server/services/integration";
import { localTransport } from "@/server/integrations/outbox/transports";
import { logEmailTransport } from "@/server/integrations/outbox/email";
import * as production from "@/server/services/production";
import * as nfe from "@/server/services/nfe";
import { readFileSync } from "node:fs";
import path from "node:path";

/** NF-e de exemplo: a MESMA chave de acesso é importada nas 5 empresas (colisão proposital). */
const NFE_XML = readFileSync(path.join(process.cwd(), "docs/exemplos/nfe-pc-4588-entrega-1.xml"), "utf8");

export const PASSWORD = "Senha-QA-2026";

/** CNPJs fictícios (dígitos verificadores válidos), todos distintos. */
export const COMPANIES = [
  { key: "A", name: "Alfa Armazéns Gerais (QA)", cnpj: "11444777000161", staff: 10 },
  { key: "B", name: "Beta Logística Integrada (QA)", cnpj: "22333444000181", staff: 10 },
  { key: "C", name: "Gama Distribuidora (QA)", cnpj: "33444555000149", staff: 10 },
  { key: "D", name: "Delta Insumos Industriais (QA)", cnpj: "44555666000107", staff: 10 },
  { key: "E", name: "Épsilon Comércio Exterior (QA)", cnpj: "55666777000165", staff: 9 },
] as const;

/** SKUs comuns a todas as empresas (colisão proposital) + 1 exclusivo por empresa. */
export const SHARED_SKUS = ["SKU-001", "SKU-002", "SKU-003"] as const;
export const SHARED_BARCODES: Record<string, string> = { "SKU-001": "7891000000011", "SKU-002": "7891000000028", "SKU-003": "7891000000035" };
/** Endereços de armazenagem: DEP-01/RUA-01/MOD-01..04/NIV-01..02/POS-00 — iguais em todas as empresas. */
export const LOC = (bay: number, level: number, wh = "DEP-01") =>
  `${wh}/RUA-01/MOD-${String(bay).padStart(2, "0")}/NIV-${String(level).padStart(2, "0")}/POS-00`;
export const INITIAL_QTY = 500;

export interface Staff {
  ctx: Ctx;
  role: Role;
}

export interface Tenant {
  key: string;
  name: string;
  cnpj: string;
  companyId: string;
  staff: Staff[];
  admin: Ctx;
  supervisor: Ctx;
  auditor: Ctx;
  operators: Ctx[];
  warehouseId: string;
  warehouse2Id: string | null;
  zones: Record<"ARM" | "EXP" | "QUA" | "PRD", string>;
  locations: Record<string, string>;
  dockLocationId: string;
  dockId: string;
  supplierId: string;
  customerId: string;
  products: Record<string, string>;
  /** Registros de cada tipo, usados como alvo dos ataques entre empresas. */
  r: {
    packagingId: string;
    balanceId: string;
    receiptId: string;
    receiptItemId: string;
    divergenceId: string;
    openOrderId: string;
    openOrderLineId: string;
    pickingOrderId: string;
    pickTaskId: string;
    shippedOrderId: string;
    shippedOrderLineId: string;
    shipmentId: string;
    transferTaskId: string;
    inventoryId: string;
    inventoryItemId: string;
    waveId: string;
    waveOrderId: string;
    returnId: string;
    returnItemId: string;
    appointmentId: string;
    outboxEventId: string;
    emailMessageId: string;
    operatorUserId: string;
    purchaseOrderId: string;
    salesOrderId: string;
    productionOrderId: string;
    productionOrder2Id: string;
    productionLineId: string;
    requisitionId: string;
    nfeImportId: string;
    nfeItemId: string;
  };
}

export interface MultiTenantEnv {
  db: Db;
  tenants: Tenant[];
  all: Staff[];
}

const sessionCtx = async (db: Db, userId: string): Promise<Ctx> => ({ db, user: (await loadSessionUser(db, userId))! });
const one = async <T,>(db: Db, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params))[0];
const id = async (db: Db, sql: string, params: unknown[] = []) => (await one<{ id: string }>(db, sql, params)).id;

function roleplan(staff: number): Role[] {
  // 1 admin, 2 supervisores, 1 auditor, restante operadores (6 ou 5)
  return ["admin", "supervisor", "supervisor", "auditor", ...Array<Role>(staff - 4).fill("operator")];
}

async function buildTenant(db: Db, spec: (typeof COMPANIES)[number], idx: number, adminHash: string): Promise<Tenant> {
  const k = spec.key.toLowerCase();
  // ---- empresa + 1º administrador (não há serviço de criação de empresa) ----
  const companyId = await id(
    db,
    `insert into erp.companies (name, legal_name, document, email, city, state) values ($1, $2, $3, $4, 'Cidade QA', 'SP') returning id`,
    [spec.name, `${spec.name} Ltda.`, spec.cnpj, `contato@${k}.qa.test`],
  );
  const adminId = await id(
    db,
    `insert into wms.users (company_id, name, email, role, password_hash) values ($1, $2, $3, 'admin', $4) returning id`,
    [companyId, `Admin ${spec.key}`, `admin@${k}.qa.test`, adminHash],
  );
  const admin = await sessionCtx(db, adminId);

  // ---- estrutura física (serviços) ----
  const wh = await warehouse.createWarehouse(admin, { code: "DEP-01", name: `Depósito principal ${spec.key}` });
  const wh2 = idx < 2 ? await warehouse.createWarehouse(admin, { code: "DEP-02", name: `Depósito secundário ${spec.key}` }) : null;
  const zArm = await warehouse.createZone(admin, { warehouseId: wh.id, code: "ARM", name: "Armazenagem", zoneType: "storage" });
  const zExp = await warehouse.createZone(admin, { warehouseId: wh.id, code: "EXP", name: "Expedição", zoneType: "shipping" });
  const zQua = await warehouse.createZone(admin, { warehouseId: wh.id, code: "QUA", name: "Quarentena", zoneType: "quarantine" });
  await warehouse.generateLocations(admin, {
    zoneId: zArm.id, aisle: "01", bayFrom: 1, bayTo: 4, levelFrom: 1, levelTo: 2, positions: 1,
    locationType: "rack", storageClass: "general", capacityUnits: 100000,
  });
  await warehouse.generateLocations(admin, {
    zoneId: zExp.id, aisle: "EX", bayFrom: 1, bayTo: 1, levelFrom: 0, levelTo: 0, positions: 1,
    locationType: "dock", storageClass: null, capacityUnits: 100000,
  });
  await warehouse.generateLocations(admin, {
    zoneId: zQua.id, aisle: "QA", bayFrom: 1, bayTo: 1, levelFrom: 0, levelTo: 0, positions: 1,
    locationType: "quarantine", storageClass: null, capacityUnits: 100000,
  });
  const zPrd = await warehouse.createZone(admin, { warehouseId: wh.id, code: "PRD", name: "Produção", zoneType: "production" });
  await warehouse.generateLocations(admin, {
    zoneId: zPrd.id, aisle: "PR", bayFrom: 1, bayTo: 1, levelFrom: 0, levelTo: 0, positions: 1,
    locationType: "staging", storageClass: null, capacityUnits: 100000,
  });
  if (wh2) {
    const z2 = await warehouse.createZone(admin, { warehouseId: wh2.id, code: "ARM", name: "Armazenagem", zoneType: "storage" });
    await warehouse.generateLocations(admin, {
      zoneId: z2.id, aisle: "01", bayFrom: 1, bayTo: 2, levelFrom: 1, levelTo: 1, positions: 1,
      locationType: "rack", storageClass: "general", capacityUnits: 100000,
    });
  }
  const locRows = await db.query<{ id: string; code: string }>(`select id, code from wms.locations where company_id = $1`, [companyId]);
  const locations = Object.fromEntries(locRows.map((r) => [r.code, r.id]));
  const dockLocationId = locations["DEP-01/RUA-EX/MOD-01/NIV-00/POS-00"];
  const dock = await docks.createDock(admin, { warehouseId: wh.id, code: "DOC-01", name: "Doca 1", dockType: "both" });

  // ---- funcionários (serviço createUser) ----
  const staff: Staff[] = [{ ctx: admin, role: "admin" }];
  const plan = roleplan(spec.staff);
  for (let i = 1; i < plan.length; i++) {
    const role = plan[i];
    const u = await users.createUser(admin, {
      name: `${role} ${spec.key}${i}`,
      email: `${role}${i}@${k}.qa.test`,
      role,
      password: PASSWORD,
      // um operador por empresa com acesso restrito ao DEP-01 (cobre o escopo por depósito)
      warehouseIds: role === "operator" && i === 4 ? [wh.id] : [],
    });
    await db.query(`update wms.users set must_change_password = false where id = $1`, [u.id]);
    staff.push({ ctx: await sessionCtx(db, u.id), role });
  }
  const supervisor = staff.find((s) => s.role === "supervisor")!.ctx;
  const auditor = staff.find((s) => s.role === "auditor")!.ctx;
  const operators = staff.filter((s) => s.role === "operator").map((s) => s.ctx);

  // ---- cadastros mestres do ERP (sem serviço: vêm da integração) ----
  const supplierId = await id(db, `insert into erp.suppliers (company_id, code, name) values ($1, 'FOR-001', $2) returning id`, [
    companyId, `Fornecedor ${spec.key}`,
  ]);
  const customerId = await id(db, `insert into erp.customers (company_id, code, name) values ($1, 'CLI-001', $2) returning id`, [
    companyId, `Cliente ${spec.key}`,
  ]);
  const productIds: Record<string, string> = {};
  for (const sku of [...SHARED_SKUS, `EXC-${spec.key}`]) {
    productIds[sku] = await id(
      db,
      `insert into erp.products (company_id, sku, description, barcode, uom, weight_kg) values ($1, $2, $3, $4, 'UN', 1) returning id`,
      [companyId, sku, `Produto ${sku} da empresa ${spec.key}`, SHARED_BARCODES[sku] ?? null],
    );
  }
  const purchaseOrderId = await id(
    db,
    `insert into erp.purchase_orders (company_id, number, supplier_id, expected_date) values ($1, 'PC-0001', $2, current_date) returning id`,
    [companyId, supplierId],
  );
  await db.query(`insert into erp.purchase_order_items (purchase_order_id, line_no, product_id, quantity, unit_price) values ($1, 1, $2, 50, 10)`, [
    purchaseOrderId, productIds["SKU-001"],
  ]);
  const salesOrderId = await id(db, `insert into erp.sales_orders (company_id, number, customer_id) values ($1, 'PV-0001', $2) returning id`, [
    companyId, customerId,
  ]);
  await db.query(`insert into erp.sales_order_items (sales_order_id, line_no, product_id, quantity) values ($1, 1, $2, 5)`, [
    salesOrderId, productIds["SKU-002"],
  ]);
  const packaging = await products.addPackaging(admin, productIds["SKU-001"], { code: "CX10", unitsPerPackage: 10, barcode: "17891000000018" });

  // ---- saldo inicial (serviço de ajuste) ----
  for (const sku of SHARED_SKUS) {
    for (const bay of [1, 2]) {
      await stock.adjustStock(admin, {
        locationId: locations[LOC(bay, 1)], productId: productIds[sku], direction: "in", quantity: INITIAL_QTY,
        reason: "Saldo inicial da bateria multiempresa",
      });
    }
  }
  const balanceId = await id(db, `select id from wms.stock_balances where company_id = $1 and location_id = $2 and product_id = $3`, [
    companyId, locations[LOC(1, 1)], productIds["SKU-003"],
  ]);

  // ---- e-mail: destinatários próprios da empresa ----
  await settings.updateSettings(admin, { "notifications.email_recipients": `avisos@${k}.qa.test` });

  // ---- documentos de cada tipo (alvos dos testes de isolamento) ----
  const sup = supervisor;
  const op = operators[0];
  const receipt = await receiving.createManualReceipt(sup, { warehouseId: wh.id, supplierId, items: [{ productId: productIds["SKU-001"], expectedQty: 10 }] });
  await receiving.startCheck(op, receipt.id);
  await receiving.addReceiptDivergence(op, receipt.id, { divergenceType: "other", description: `Lacre violado ${spec.key}` });
  const receiptItemId = await id(db, `select id from wms.receipt_items where receipt_id = $1`, [receipt.id]);
  const divergenceId = await id(db, `select id from wms.divergences where company_id = $1 order by created_at desc limit 1`, [companyId]);

  const openOrder = await outbound.createManualOrder(sup, { warehouseId: wh.id, customerName: `Cliente ${spec.key}`, lines: [{ productId: productIds["SKU-002"], quantity: 3 }] });
  const openOrderLineId = await id(db, `select id from wms.outbound_order_lines where order_id = $1`, [openOrder.id]);

  const picking = await outbound.createManualOrder(sup, { warehouseId: wh.id, customerName: `Cliente ${spec.key}`, lines: [{ productId: productIds["SKU-002"], quantity: 4 }] });
  await outbound.reserveOrder(sup, picking.id);
  await outbound.releaseForPicking(sup, picking.id);
  const pickTaskId = await id(db, `select id from wms.tasks where order_id = $1 and task_type = 'picking'`, [picking.id]);

  // pedido expedido (para devolução, expedição, outbox e e-mail)
  const shipped = await outbound.createManualOrder(sup, { warehouseId: wh.id, customerName: `Cliente ${spec.key}`, lines: [{ productId: productIds["SKU-001"], quantity: 5 }] });
  await outbound.reserveOrder(sup, shipped.id);
  await outbound.releaseForPicking(sup, shipped.id);
  const sPick = await id(db, `select id from wms.tasks where order_id = $1 and task_type = 'picking'`, [shipped.id]);
  await tasks.completeTask(op, sPick, {});
  const shippedOrderLineId = await id(db, `select id from wms.outbound_order_lines where order_id = $1`, [shipped.id]);
  await outbound.checkOrder(op, shipped.id, { lines: [{ lineId: shippedOrderLineId, checkedQty: 5 }] });
  await outbound.shipOrder(op, shipped.id, { carrier: `Transportadora ${spec.key}` });
  const shipmentId = await id(db, `select id from wms.shipments where order_id = $1`, [shipped.id]);
  const ret = await returns.createReturn(op, { outboundOrderId: shipped.id, reason: "regret", items: [{ orderLineId: shippedOrderLineId, quantity: 1 }] });
  const returnItemId = await id(db, `select id from wms.customer_return_items where return_id = $1`, [ret.id]);

  const transfer = await tasks.createTransfer(op, {
    fromLocationId: locations[LOC(2, 1)], productId: productIds["SKU-003"], quantity: 7, toLocationId: locations[LOC(3, 1)],
  });

  const inv = await inventory.createInventory(sup, { warehouseId: wh.id, countType: "cyclic", locationId: locations[LOC(2, 1)] });
  const inventoryItemId = await id(db, `select id from wms.inventory_count_items where inventory_id = $1 limit 1`, [inv.id]);

  const waveOrder = await outbound.createManualOrder(sup, { warehouseId: wh.id, customerName: `Cliente ${spec.key}`, lines: [{ productId: productIds["SKU-003"], quantity: 2 }] });
  await outbound.reserveOrder(sup, waveOrder.id);
  const wave = await waves.createWave(sup, { warehouseId: wh.id, grouping: "manual", orderIds: [waveOrder.id], dockLocationId });

  const date = new Date(Date.now() + 86400000 * (3 + idx)).toISOString().slice(0, 10);
  const appointment = await docks.createAppointment(sup, { dockId: dock.id, date, startTime: "08:00", endTime: "09:00", carrier: `Rota ${spec.key}` });

  // outbox (expedição gera evento) + e-mail (agendamento de recebimento gera aviso)
  await processQueue(sup, { transport: localTransport, email: logEmailTransport });
  const outboxEventId = await id(db, `select id from wms.integration_events where company_id = $1 order by created_at limit 1`, [companyId]);
  const emailMessageId = (await one<{ id: string }>(db, `select id from wms.email_messages where company_id = $1 limit 1`, [companyId]))?.id ?? "";

  // produção: ordem do ERP (sem serviço) + requisição pelo serviço
  const productionOrderId = await id(
    db,
    `insert into erp.production_orders (company_id, number, product_id, quantity, output_lot_code) values ($1, 'OP-0001', $2, 10, 'LOTE-OP1') returning id`,
    [companyId, productIds[`EXC-${spec.key}`]],
  );
  await db.query(`insert into erp.production_order_components (production_order_id, line_no, product_id, quantity) values ($1, 1, $2, 4)`, [
    productionOrderId, productIds["SKU-001"],
  ]);
  const productionOrder2Id = await id(
    db,
    `insert into erp.production_orders (company_id, number, product_id, quantity) values ($1, 'OP-0002', $2, 5) returning id`,
    [companyId, productIds[`EXC-${spec.key}`]],
  );
  await db.query(`insert into erp.production_order_components (production_order_id, line_no, product_id, quantity) values ($1, 1, $2, 1)`, [
    productionOrder2Id, productIds["SKU-002"],
  ]);
  const productionLineId = locations["DEP-01/RUA-PR/MOD-01/NIV-00/POS-00"];
  const requisition = await production.createRequisition(sup, { productionOrderId, lineLocationId: productionLineId });

  // NF-e (mesma chave em todas as empresas)
  const nf = await nfe.importNfe(op, { xml: NFE_XML });
  const nfeItemId = await id(db, `select id from wms.nfe_import_items where import_id = $1 limit 1`, [nf.id]);

  return {
    key: spec.key, name: spec.name, cnpj: spec.cnpj, companyId, staff, admin, supervisor, auditor, operators,
    warehouseId: wh.id, warehouse2Id: wh2?.id ?? null,
    zones: { ARM: zArm.id, EXP: zExp.id, QUA: zQua.id, PRD: zPrd.id },
    locations, dockLocationId, dockId: dock.id, supplierId, customerId, products: productIds,
    r: {
      packagingId: packaging.id, balanceId, receiptId: receipt.id, receiptItemId, divergenceId,
      openOrderId: openOrder.id, openOrderLineId, pickingOrderId: picking.id, pickTaskId,
      shippedOrderId: shipped.id, shippedOrderLineId, shipmentId, transferTaskId: transfer.id,
      inventoryId: inv.id, inventoryItemId, waveId: wave.id, waveOrderId: waveOrder.id,
      returnId: ret.id, returnItemId, appointmentId: appointment.id, outboxEventId, emailMessageId,
      operatorUserId: operators[0].user.id, purchaseOrderId, salesOrderId,
      productionOrderId, productionOrder2Id, productionLineId, requisitionId: requisition.id, nfeImportId: nf.id, nfeItemId,
    },
  };
}

/**
 * Monta as 5 empresas. Sem `db`, usa PGlite em memória com as migrations reais.
 * Com `db` (ex.: Postgres real), o banco deve estar migrado e vazio.
 */
export async function createMultiTenantEnv(db?: Db): Promise<MultiTenantEnv> {
  const database = db ?? (await createPgliteDb());
  if (!db) await runMigrations(database);
  const adminHash = await hashPassword(PASSWORD);
  const tenants: Tenant[] = [];
  for (const [i, spec] of COMPANIES.entries()) tenants.push(await buildTenant(database, spec, i, adminHash));
  return { db: database, tenants, all: tenants.flatMap((t) => t.staff) };
}

/**
 * PostgreSQL real para os testes (TEST_DATABASE_URL). ATENÇÃO: APAGA os schemas
 * erp/wms do banco indicado e reaplica as migrations. Use um banco só de teste.
 */
export async function freshPostgres(url: string, max = 25): Promise<Db> {
  const db = await createPostgresDb(url, { max });
  await db.exec(`drop schema if exists wms cascade; drop schema if exists erp cascade;
                 drop table if exists public.orion_schema_migrations; drop table if exists public.site_leads cascade;`);
  await runMigrations(db);
  return db;
}

/** Todas as tabelas erp/wms com company_id (descobertas do catálogo, não de uma lista fixa). */
export async function tenantTables(db: Db): Promise<string[]> {
  const rows = await db.query<{ t: string }>(
    `select c.table_schema || '.' || c.table_name as t
     from information_schema.columns c join information_schema.tables tb using (table_schema, table_name)
     where c.column_name = 'company_id' and c.table_schema in ('erp', 'wms') and tb.table_type = 'BASE TABLE'
     order by 1`,
  );
  return rows.map((r) => r.t);
}

/** Tabelas filhas sem company_id e a junção até o registro pai. */
export const CHILD_TABLES: Record<string, string> = {
  "erp.purchase_order_items": "join erp.purchase_orders p on p.id = x.purchase_order_id",
  "erp.sales_order_items": "join erp.sales_orders p on p.id = x.sales_order_id",
  "wms.receipt_items": "join wms.receipts p on p.id = x.receipt_id",
  "wms.outbound_order_lines": "join wms.outbound_orders p on p.id = x.order_id",
  "wms.inventory_count_items": "join wms.inventory_counts p on p.id = x.inventory_id",
  "wms.task_events": "join wms.tasks p on p.id = x.task_id",
  "wms.user_warehouses": "join wms.users p on p.id = x.user_id",
};

/**
 * Impressão digital de TODOS os dados de uma empresa: hash do conteúdo de cada
 * tabela (linhas inteiras), inclusive tabelas filhas via registro pai. Qualquer
 * INSERT/UPDATE/DELETE em dados da empresa muda o resultado.
 */
export async function snapshot(db: Db, companyId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of await tenantTables(db)) {
    const [r] = await db.query<{ n: number; h: string | null }>(
      `select count(*)::int as n, md5(string_agg(x::text, '|' order by x::text)) as h from ${t} x where x.company_id = $1`,
      [companyId],
    );
    out[t] = `${r.n}:${r.h ?? "-"}`;
  }
  for (const [t, join] of Object.entries(CHILD_TABLES)) {
    const [r] = await db.query<{ n: number; h: string | null }>(
      `select count(*)::int as n, md5(string_agg(x::text, '|' order by x::text)) as h from ${t} x ${join} where p.company_id = $1`,
      [companyId],
    );
    out[t] = `${r.n}:${r.h ?? "-"}`;
  }
  const [c] = await db.query<{ h: string }>(`select md5(x::text) as h from erp.companies x where id = $1`, [companyId]);
  out["erp.companies"] = c.h;
  return out;
}

/** Todos os UUIDs de registros da empresa (marcadores para detectar vazamento em leituras). */
export async function tenantIds(db: Db, companyId: string): Promise<Set<string>> {
  const ids = new Set<string>([companyId]);
  for (const t of await tenantTables(db)) {
    const hasId = await db.query(
      `select 1 from information_schema.columns where table_schema || '.' || table_name = $1 and column_name = 'id'`,
      [t],
    );
    if (!hasId.length) continue;
    for (const r of await db.query<{ id: string }>(`select id::text as id from ${t} where company_id = $1`, [companyId])) ids.add(r.id);
  }
  for (const [t, join] of Object.entries(CHILD_TABLES)) {
    const hasId = await db.query(
      `select 1 from information_schema.columns where table_schema || '.' || table_name = $1 and column_name = 'id'`,
      [t],
    );
    if (!hasId.length) continue;
    for (const r of await db.query<{ id: string }>(`select x.id::text as id from ${t} x ${join} where p.company_id = $1`, [companyId])) ids.add(r.id);
  }
  return ids;
}

/**
 * Referências cruzadas: linhas cuja FK aponta para registro de OUTRA empresa.
 * Descobre as FKs no catálogo (pg_constraint) entre tabelas que têm company_id.
 */
export async function crossTenantReferences(db: Db): Promise<{ fk: string; rows: number }[]> {
  const fks = await db.query<{ child: string; col: string; parent: string; pcol: string; name: string }>(
    `select cn.nspname || '.' || c.relname as child, a.attname as col, pn.nspname || '.' || p.relname as parent,
            pa.attname as pcol, k.conname as name
     from pg_constraint k
     join pg_class c on c.oid = k.conrelid join pg_namespace cn on cn.oid = c.relnamespace
     join pg_class p on p.oid = k.confrelid join pg_namespace pn on pn.oid = p.relnamespace
     join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
     join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = k.confkey[1]
     where k.contype = 'f' and array_length(k.conkey, 1) = 1 and cn.nspname in ('erp', 'wms') and pn.nspname in ('erp', 'wms')
       and a.attname <> 'company_id'
       and exists (select 1 from pg_attribute x where x.attrelid = k.conrelid and x.attname = 'company_id' and not x.attisdropped)
       and (exists (select 1 from pg_attribute x where x.attrelid = k.confrelid and x.attname = 'company_id' and not x.attisdropped)
            or p.relname = 'companies')`,
  );
  const out: { fk: string; rows: number }[] = [];
  for (const f of fks) {
    const pc = f.parent === "erp.companies" ? "p.id" : "p.company_id";
    const [r] = await db.query<{ n: number }>(
      `select count(*)::int as n from ${f.child} x join ${f.parent} p on p.${f.pcol} = x.${f.col} where x.company_id <> ${pc}`,
    );
    out.push({ fk: `${f.child}.${f.col} -> ${f.parent}`, rows: r.n });
  }
  return out;
}
