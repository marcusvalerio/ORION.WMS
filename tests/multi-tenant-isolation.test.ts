/**
 * Bateria de ISOLAMENTO multiempresa: 5 empresas × 49 funcionários.
 * Para cada empresa X e cada outra empresa Y (20 pares), com um usuário de X:
 *  - toda leitura (list/get/relatórios/KPIs/coletor) não devolve nada de Y;
 *  - buscar registro de Y por ID devolve "não encontrado" (ou vazio);
 *  - toda escrita apontando para IDs de Y (inclusive misturando IDs de X e Y)
 *    falha e não altera NADA de Y (impressão digital de todas as tabelas);
 *  - ao final, nenhuma FK do banco aponta para registro de outra empresa.
 * A cobertura é conferida contra os exports reais de src/server/services.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DomainError, toUserMessage } from "@/server/errors";
import {
  COMPANIES, LOC, crossTenantReferences, createMultiTenantEnv, freshPostgres, snapshot, tenantIds,
  type MultiTenantEnv, type Tenant,
} from "./fixtures/multi-tenant";

import * as audit from "@/server/services/audit";
import * as collector from "@/server/services/collector";
import * as comex from "@/server/services/comex";
import * as comexPanel from "@/server/services/comex-panel";
import * as company from "@/server/services/company";
import * as dashboard from "@/server/services/dashboard";
import * as divergences from "@/server/services/divergences";
import * as docks from "@/server/services/docks";
import * as health from "@/server/services/health";
import * as integration from "@/server/services/integration";
import * as inventory from "@/server/services/inventory";
import * as labels from "@/server/services/labels";
import * as nfe from "@/server/services/nfe";
import * as novidades from "@/server/services/novidades";
import * as outbound from "@/server/services/outbound";
import * as production from "@/server/services/production";
import * as productivity from "@/server/services/productivity";
import * as products from "@/server/services/products";
import * as receiving from "@/server/services/receiving";
import * as replenishment from "@/server/services/replenishment";
import * as reports from "@/server/services/reports";
import * as returns from "@/server/services/returns";
import * as serials from "@/server/services/serials";
import * as settings from "@/server/services/settings";
import * as shippingLabel from "@/server/services/shipping-label";
import * as slotting from "@/server/services/slotting";
import * as stock from "@/server/services/stock";
import * as tasks from "@/server/services/tasks";
import * as users from "@/server/services/users";
import * as warehouse from "@/server/services/warehouse";
import * as waves from "@/server/services/waves";
import { localTransport } from "@/server/integrations/outbox/transports";
import { logEmailTransport } from "@/server/integrations/outbox/email";
import { processOutbox } from "@/server/integrations/outbox/processor";

// Rotas de API: a sessão e o banco são substituídos pelo usuário/banco do teste.
const session = vi.hoisted(() => ({ user: null as unknown, db: null as unknown }));
vi.mock("@/server/auth/session", () => ({
  getSessionUser: async () => session.user,
  requireCtx: async () => ({ db: session.db, user: session.user }),
}));
vi.mock("@/server/db", () => ({ getDb: async () => session.db }));

const MODULES: Record<string, Record<string, unknown>> = {
  audit, collector, comex, "comex-panel": comexPanel, company, dashboard, divergences, docks, health, integration, inventory, labels, nfe, novidades,
  outbound, production, productivity, products, receiving, replenishment, reports, returns, serials, settings,
  "shipping-label": shippingLabel, slotting, stock, tasks, users, warehouse, waves,
};

/** Exports que não recebem contexto de usuário (puros/internos) ou dependem de sistema externo — com o motivo. */
const EXCLUDED: Record<string, string> = {
  "atlas-sync.*": "empresa resolvida só pelo key_id assinado ou pelo contexto; coberta por tests/atlas-multi-tenant.test.ts",
  "common.*": "auxiliares internos (nextCode/audit/runOperation) sempre recebem o companyId do contexto",
  "stock-core.*": "núcleo de saldo chamado só pelos serviços (coberto indiretamente + verificação de FKs cruzadas)",
  "comex.assertCustomsCleared": "interno, recebe receiptId já validado por lockReceipt",
  "comex.recordLotOrigins": "interno, chamado em releaseReceipt após lockReceipt",
  "comex.lotOrigin": "recebe companyId explícito",
  "comex.assertExportReady": "interno, chamado em shipOrder após lockOrder",
  "company.companyHeaderLines": "puro",
  "company.normalizeAtlasCompany": "puro",
  "company.fingerprint": "puro",
  "company.listAtlasCompanies": "consulta o banco externo ATLAS (fora do escopo multiempresa)",
  "company.linkAtlasCompany": "banco externo ATLAS; grava só na empresa do contexto",
  "company.previewCompanySync": "banco externo ATLAS",
  "company.syncCompany": "banco externo ATLAS; grava só na empresa do contexto",
  "docks.todayInAgendaTz": "puro",
  "health.collectHealth": "interno (rota pública /api/health agrega sem dados de empresa)",
  "health.toPublicHealth": "puro",
  "inventory.isBlindCount": "puro",
  "labels.levelArrow": "puro",
  "productivity.defaultPeriod": "puro",
  "productivity.fmtDuration": "puro",
  "production.completeProductionPickTx": "interno, chamado por completeTask após lockTask",
  "receiving.createPoReceiptInTx": "interno, chamado por createReceiptFromPurchaseOrder/NF-e já validados",
  "receiving.refreshReceiptCompletion": "interno, após lockReceipt",
  "replenishment.checkReplenishmentTx": "interno, chamado com warehouse já validado",
  "replenishment.emergencyReplenishmentTx": "interno",
  "replenishment.completeReplenishmentTx": "interno, chamado por completeTask após lockTask",
  "reports.toCsv": "puro",
  "serials.isSerialControlled": "interno",
  "serials.parseSerials": "puro",
  "serials.pickSerials": "interno",
  "serials.pickedSerialsOfLine": "interno",
  "serials.shipSerials": "interno",
  "serials.returnSerials": "interno",
  "settings.parseSettingInput": "puro",
  "site-leads.registrarLead": "tabela pública do site (sem empresa)",
  "slotting.accessCost": "puro",
  "slotting.classifyAbc": "puro",
  "waves.sequenceRoute": "puro",
  "integration.processQueue": "coberto no bloco \"Outbox e e-mails\" (X processa só a própria fila)",
  "tasks.suggestForTask": "recebe a tarefa já carregada por getTask (escopo da empresa)",
  "users.passwordProblem": "puro",
  "users.generateTemporaryPassword": "puro",
  "warehouse.formatLocationCode": "puro",
  "waves.refreshWaveStatus": "interno",
  "waves.refreshOrderPickStatus": "interno",
  "waves.completeWavePickTx": "interno, chamado por completeTask após lockTask",
  "waves.afterPickTx": "interno",
  "waves.completeWaveIfDone": "interno",
  "waves.detachOrderFromWaveTx": "interno, após lockOrder",
};

type Call = (x: Tenant, y: Tenant) => Promise<unknown>;
const covered = new Set<string>();
const reg = <T extends Record<string, Call>>(module: string, calls: T) => {
  for (const k of Object.keys(calls)) covered.add(`${module}.${k.split("#")[0]}`);
  return Object.entries(calls).map(([k, fn]) => ({ name: `${module}.${k}`, fn }));
};

let env: MultiTenantEnv;
const adm = (t: Tenant) => t.admin;
const sup = (t: Tenant) => t.supervisor;
const op = (t: Tenant) => t.operators[0];
const params = (o: Record<string, string>) => new URLSearchParams(o);
const today = new Date().toISOString().slice(0, 10);

// -----------------------------------------------------------------------------
// LEITURAS: tudo o que um usuário de X consegue ler. Os filtros recebem IDs de Y
// de propósito (filtro por depósito/produto/pedido de outra empresa).
// -----------------------------------------------------------------------------
const READS = [
  ...reg("audit", {
    listAudit: (x) => audit.listAudit(adm(x), {}),
    "listAudit#filtroY": (x, y) => audit.listAudit(adm(x), { entityId: y.r.receiptId }),
    entityHistory: (x, y) => audit.entityHistory(adm(x), "receipt", y.r.receiptId),
    listIntegrationEvents: (x) => audit.listIntegrationEvents(adm(x)),
  }),
  ...reg("collector", {
    resolveLocationCode: (x) => collector.resolveLocationCode(op(x), LOC(1, 1)),
    resolveProductCode: (x) => collector.resolveProductCode(op(x), "SKU-001"),
    "resolveProductCode#ean": (x) => collector.resolveProductCode(op(x), "7891000000011"),
    listCollectorTasks: (x) => collector.listCollectorTasks(op(x)),
    listCountingInventories: (x) => collector.listCountingInventories(op(x)),
    lookupCode: (x) => collector.lookupCode(op(x), LOC(1, 1)),
    "lookupCode#sku": (x) => collector.lookupCode(op(x), "SKU-002"),
    inventoryLocation: (x, y) => collector.inventoryLocation(op(x), y.r.inventoryId, LOC(2, 1)),
    checkDestination: (x, y) => collector.checkDestination(op(x), y.r.transferTaskId, LOC(3, 1)),
    checkOrigin: (x, y) => collector.checkOrigin(op(x), y.r.transferTaskId, LOC(2, 1)),
    checkTaskProduct: (x, y) => collector.checkTaskProduct(op(x), y.r.transferTaskId, "SKU-003"),
  }),
  ...reg("comex", {
    getReceiptImport: (x, y) => comex.getReceiptImport(adm(x), y.r.receiptId),
    getPackingList: (x, y) => comex.getPackingList(adm(x), y.r.shippedOrderId),
  }),
  ...reg("comex-panel", {
    receiptCargo: (x, y) => comexPanel.receiptCargo(adm(x), y.r.receiptId),
    listImportProcesses: (x) => comexPanel.listImportProcesses(adm(x)),
    "listImportProcesses#busca": (x) => comexPanel.listImportProcesses(adm(x), { q: "REC" }),
    importIndicators: (x) => comexPanel.importIndicators(adm(x)),
    importFilterOptions: (x) => comexPanel.importFilterOptions(adm(x)),
    listExportOrders: (x) => comexPanel.listExportOrders(adm(x)),
    exportIndicators: (x) => comexPanel.exportIndicators(adm(x)),
  }),
  ...reg("company", {
    getCompanyProfile: (x) => company.getCompanyProfile(env.db, x.companyId),
  }),
  ...reg("dashboard", {
    getKpiSeries: (x) => dashboard.getKpiSeries(adm(x)),
    getKpis: (x) => dashboard.getKpis(adm(x)),
    getFlowSeries: (x) => dashboard.getFlowSeries(adm(x)),
    getTaskDistribution: (x) => dashboard.getTaskDistribution(adm(x)),
    getAlerts: (x) => dashboard.getAlerts(adm(x)),
    getRecentActivity: (x) => dashboard.getRecentActivity(adm(x)),
    getPerformance: (x) => dashboard.getPerformance(adm(x)),
  }),
  ...reg("divergences", {
    listDivergences: (x) => divergences.listDivergences(adm(x)),
    "listDivergences#filtroY": (x, y) => divergences.listDivergences(adm(x), { receiptId: y.r.receiptId, orderId: y.r.shippedOrderId }),
  }),
  ...reg("docks", {
    listDocks: (x) => docks.listDocks(adm(x)),
    "listDocks#filtroY": (x, y) => docks.listDocks(adm(x), y.warehouseId),
    listDayAppointments: (x, y) => docks.listDayAppointments(adm(x), today, y.warehouseId),
    "listDayAppointments#proprio": (x) => docks.listDayAppointments(adm(x), today, x.warehouseId),
    getAppointment: (x, y) => docks.getAppointment(adm(x), y.r.appointmentId),
  }),
  ...reg("health", {
    getSystemHealth: (x) => health.getSystemHealth(adm(x)),
  }),
  ...reg("integration", {
    listOutboxEvents: (x) => integration.listOutboxEvents(adm(x)),
    getOutboxEvent: (x, y) => integration.getOutboxEvent(adm(x), y.r.outboxEventId),
    listEmailMessages: (x) => integration.listEmailMessages(adm(x), 100),
    getEmailMessage: (x, y) => integration.getEmailMessage(adm(x), y.r.emailMessageId),
  }),
  ...reg("inventory", {
    listInventories: (x) => inventory.listInventories(adm(x)),
    getInventory: (x, y) => inventory.getInventory(adm(x), y.r.inventoryId),
    getInventoryMap: (x, y) => inventory.getInventoryMap(adm(x), y.r.inventoryId),
    getInventoryKpis: (x, y) => inventory.getInventoryKpis(adm(x), y.r.inventoryId),
  }),
  ...reg("labels", {
    listLocationLabels: (x) => labels.listLocationLabels(adm(x), {}),
    "listLocationLabels#filtroY": (x, y) => labels.listLocationLabels(adm(x), { warehouseId: y.warehouseId }),
    listAisles: (x, y) => labels.listAisles(adm(x), y.warehouseId),
    getProductLabel: (x, y) => labels.getProductLabel(adm(x), y.products["SKU-001"]),
    getShippingLabels: (x, y) => labels.getShippingLabels(adm(x), y.r.shippedOrderId, 2),
  }),
  ...reg("nfe", {
    listNfeImports: (x) => nfe.listNfeImports(adm(x)),
    getNfe: (x, y) => nfe.getNfe(adm(x), y.r.nfeImportId),
  }),
  ...reg("novidades", {
    versoesVistas: (x) => novidades.versoesVistas(adm(x)),
  }),
  ...reg("outbound", {
    listOrders: (x) => outbound.listOrders(adm(x)),
    getOrder: (x, y) => outbound.getOrder(adm(x), y.r.shippedOrderId),
    listShipments: (x) => outbound.listShipments(adm(x)),
  }),
  ...reg("production", {
    listRequisitions: (x) => production.listRequisitions(adm(x)),
    listErpProductionOrders: (x) => production.listErpProductionOrders(adm(x)),
    listProductionLines: (x) => production.listProductionLines(adm(x)),
    getRequisition: (x, y) => production.getRequisition(adm(x), y.r.requisitionId),
  }),
  ...reg("productivity", {
    productivityByUser: (x) => productivity.productivityByUser(adm(x), {}),
  }),
  ...reg("products", {
    listProducts: (x) => products.listProducts(adm(x)),
    "listProducts#sku": (x) => products.listProducts(adm(x), { q: "SKU-001" }),
    getProduct: (x, y) => products.getProduct(adm(x), y.products["SKU-001"]),
    listProductOptions: (x) => products.listProductOptions(adm(x)),
    listPackaging: (x, y) => products.listPackaging(adm(x), y.products["SKU-001"]),
  }),
  ...reg("receiving", {
    listReceipts: (x) => receiving.listReceipts(adm(x)),
    getReceipt: (x, y) => receiving.getReceipt(adm(x), y.r.receiptId),
    listPurchaseOrdersWithBalance: (x) => receiving.listPurchaseOrdersWithBalance(adm(x)),
    purchaseOrderBalance: (x) => receiving.purchaseOrderBalance(env.db, x.r.purchaseOrderId),
    listPurchaseOrderDeliveries: (x, y) => receiving.listPurchaseOrderDeliveries(env.db, x.companyId, y.r.purchaseOrderId),
  }),
  ...reg("replenishment", {
    listReplenishmentSettings: (x) => replenishment.listReplenishmentSettings(adm(x)),
    listPickingLocations: (x) => replenishment.listPickingLocations(adm(x)),
  }),
  ...reg("reports", {
    ...Object.fromEntries(
      Object.keys(reports.REPORTS).flatMap((k) => [
        [`buildReport#${k}`, (x: Tenant) => reports.buildReport(adm(x), k, params({}))],
        [`exportReport#${k}`, (x: Tenant, y: Tenant) => reports.exportReport(adm(x), k, params({ warehouseId: y.warehouseId, deposito: y.warehouseId }))],
      ]),
    ),
  }),
  ...reg("returns", {
    listReturns: (x) => returns.listReturns(adm(x)),
    getReturn: (x, y) => returns.getReturn(adm(x), y.r.returnId),
    listReturnableOrders: (x) => returns.listReturnableOrders(adm(x)),
    returnableLines: (x, y) => returns.returnableLines(env.db, x.companyId, y.r.shippedOrderId),
  }),
  ...reg("serials", {
    serialsOfOrder: (x, y) => serials.serialsOfOrder(adm(x), y.r.shippedOrderId),
  }),
  ...reg("slotting", {
    saveSlottingSettings: async () => { throw new DomainError("sem alvo: grava só na empresa do contexto (Y conferida por snapshot)"); },
  }),
  ...reg("settings", {
    listSettings: (x) => settings.listSettings(adm(x)),
    getSetting: (x) => settings.getSetting(env.db, x.companyId, "notifications.email_recipients"),
  }),
  ...reg("shipping-label", {
    getShippingLabel: (x, y) => shippingLabel.getShippingLabel(adm(x), y.r.shipmentId),
  }),
  ...reg("slotting", {
    getSlottingSettings: (x) => slotting.getSlottingSettings(adm(x)),
    computeAbc: (x) => slotting.computeAbc(adm(x)),
    slottingSuggestions: (x) => slotting.slottingSuggestions(adm(x)),
  }),
  ...reg("stock", {
    listStock: (x) => stock.listStock(adm(x), {}),
    "listStock#filtroY": (x, y) => stock.listStock(adm(x), { warehouseId: y.warehouseId, productId: y.products["SKU-001"] } as never),
    getBalance: (x, y) => stock.getBalance(adm(x), y.r.balanceId),
    stockByProduct: (x, y) => stock.stockByProduct(adm(x), y.products["SKU-001"]),
    listMovements: (x) => stock.listMovements(adm(x), {}),
    "listMovements#filtroY": (x, y) => stock.listMovements(adm(x), { productId: y.products["SKU-001"] } as never),
  }),
  ...reg("tasks", {
    listTasks: (x) => tasks.listTasks(adm(x), {}),
    getTask: (x, y) => tasks.getTask(adm(x), y.r.transferTaskId),
    listAssignableUsers: (x) => tasks.listAssignableUsers(adm(x)),
  }),
  ...reg("users", {
    listUsers: (x) => users.listUsers(adm(x)),
    getUser: (x, y) => users.getUser(adm(x), y.r.operatorUserId),
    listCompanyWarehouses: (x) => users.listCompanyWarehouses(adm(x)),
  }),
  ...reg("warehouse", {
    listWarehouses: (x) => warehouse.listWarehouses(adm(x)),
    listZones: (x, y) => warehouse.listZones(adm(x), y.warehouseId),
    "listZones#todas": (x) => warehouse.listZones(adm(x)),
    listLocations: (x) => warehouse.listLocations(adm(x), {}),
    "listLocations#filtroY": (x, y) => warehouse.listLocations(adm(x), { warehouseId: y.warehouseId } as never),
    getLocation: (x, y) => warehouse.getLocation(adm(x), y.locations[LOC(1, 1)]),
    getStructureTree: (x, y) => warehouse.getStructureTree(adm(x), y.warehouseId),
  }),
  ...reg("waves", {
    listWaves: (x) => waves.listWaves(adm(x)),
    getWave: (x, y) => waves.getWave(adm(x), y.r.waveId),
    listWaveCandidates: (x, y) => waves.listWaveCandidates(adm(x), y.warehouseId),
    "listWaveCandidates#proprio": (x) => waves.listWaveCandidates(adm(x), x.warehouseId),
    listDocks: (x) => waves.listDocks(adm(x)),
    taskAllocations: (x, y) => waves.taskAllocations(adm(x), y.r.pickTaskId),
  }),
];

// -----------------------------------------------------------------------------
// ESCRITAS: X (administrador, que tem todas as permissões) apontando para Y.
// "#misto" = IDs de X e de Y na mesma chamada (o caso que mais escapa).
// -----------------------------------------------------------------------------
const reason = { reason: "Tentativa entre empresas (teste)" };
const WRITES = [
  ...reg("warehouse", {
    createWarehouse: async () => { throw new DomainError("sem alvo: cria sempre na empresa do contexto (ver teste de colisão)"); },
    updateWarehouse: (x, y) => warehouse.updateWarehouse(adm(x), y.warehouseId, { name: "Invadido", address: "x" }),
    setWarehouseActive: (x, y) => warehouse.setWarehouseActive(adm(x), y.warehouseId, false),
    createZone: (x, y) => warehouse.createZone(adm(x), { warehouseId: y.warehouseId, code: "HACK", name: "Hack", zoneType: "storage" }),
    setZoneActive: (x, y) => warehouse.setZoneActive(adm(x), y.zones.ARM, false),
    createLocation: (x, y) => warehouse.createLocation(adm(x), {
      zoneId: y.zones.ARM, aisle: "09", bay: "01", level: "01", position: "00", locationType: "rack", storageClass: "general", capacityUnits: 10,
    }),
    generateLocations: (x, y) => warehouse.generateLocations(adm(x), {
      zoneId: y.zones.ARM, aisle: "08", bayFrom: 1, bayTo: 1, levelFrom: 1, levelTo: 1, positions: 1, locationType: "rack", capacityUnits: 10,
    }),
    updateLocation: (x, y) => warehouse.updateLocation(adm(x), y.locations[LOC(4, 2)], { locationType: "rack", capacityUnits: 1 }),
    setLocationStatus: (x, y) => warehouse.setLocationStatus(adm(x), y.locations[LOC(4, 2)], { status: "blocked", reason: "invasão" }),
    deleteLocation: (x, y) => warehouse.deleteLocation(adm(x), y.locations[LOC(4, 2)]),
  }),
  ...reg("docks", {
    createDock: (x, y) => docks.createDock(adm(x), { warehouseId: y.warehouseId, code: "DOC-99", name: "Hack", dockType: "both" }),
    setDockActive: (x, y) => docks.setDockActive(adm(x), y.dockId, false),
    createAppointment: (x, y) => docks.createAppointment(adm(x), { dockId: y.dockId, date: "2030-01-10", startTime: "10:00", endTime: "11:00" }),
    "createAppointment#misto-pedidoY": (x, y) => docks.createAppointment(adm(x), {
      dockId: x.dockId, date: "2030-01-11", startTime: "10:00", endTime: "11:00", purchaseOrderId: y.r.purchaseOrderId,
    }),
    "createAppointment#misto-saidaY": (x, y) => docks.createAppointment(adm(x), {
      dockId: x.dockId, date: "2030-01-12", startTime: "10:00", endTime: "11:00", outboundOrderId: y.r.openOrderId,
    }),
    changeAppointmentStatus: (x, y) => docks.changeAppointmentStatus(adm(x), y.r.appointmentId, { action: "cancel" }),
  }),
  ...reg("products", {
    updateProductSettings: (x, y) => products.updateProductSettings(adm(x), y.products["SKU-001"], { storageClass: "hazardous" }),
    "updateProductSettings#misto-zonaY": (x, y) => products.updateProductSettings(adm(x), x.products["SKU-001"], { storageClass: "general", preferredZoneId: y.zones.ARM }),
    addPackaging: (x, y) => products.addPackaging(adm(x), y.products["SKU-001"], { code: "HACK", unitsPerPackage: 5 }),
    setPackagingActive: (x, y) => products.setPackagingActive(adm(x), y.r.packagingId, false),
  }),
  ...reg("stock", {
    adjustStock: (x, y) => stock.adjustStock(adm(x), { locationId: y.locations[LOC(1, 1)], productId: y.products["SKU-001"], direction: "out", quantity: 1, reason: "invasão entre empresas" }),
    "adjustStock#misto-produtoY": (x, y) => stock.adjustStock(adm(x), { locationId: x.locations[LOC(4, 1)], productId: y.products["SKU-001"], direction: "in", quantity: 1, reason: "invasão entre empresas" }),
    "adjustStock#misto-enderecoY": (x, y) => stock.adjustStock(adm(x), { locationId: y.locations[LOC(4, 1)], productId: x.products["SKU-001"], direction: "in", quantity: 1, reason: "invasão entre empresas" }),
    blockStock: (x, y) => stock.blockStock(adm(x), y.r.balanceId, { quantity: 1, reason: "invasão" }),
    unblockStock: (x, y) => stock.unblockStock(adm(x), y.r.balanceId, { quantity: 1, reason: "invasão" }),
  }),
  ...reg("receiving", {
    createReceiptFromPurchaseOrder: (x, y) => receiving.createReceiptFromPurchaseOrder(adm(x), { purchaseOrderId: y.r.purchaseOrderId, warehouseId: x.warehouseId }),
    createManualReceipt: (x, y) => receiving.createManualReceipt(adm(x), { warehouseId: y.warehouseId, supplierId: y.supplierId, items: [{ productId: y.products["SKU-001"], expectedQty: 1 }] }),
    "createManualReceipt#misto-fornecedorY": (x, y) => receiving.createManualReceipt(adm(x), { warehouseId: x.warehouseId, supplierId: y.supplierId, items: [{ productId: x.products["SKU-001"], expectedQty: 1 }] }),
    "createManualReceipt#misto-produtoY": (x, y) => receiving.createManualReceipt(adm(x), { warehouseId: x.warehouseId, supplierId: x.supplierId, items: [{ productId: y.products["SKU-001"], expectedQty: 1 }] }),
    startCheck: (x, y) => receiving.startCheck(adm(x), y.r.receiptId),
    saveCounts: (x, y) => receiving.saveCounts(adm(x), y.r.receiptId, { items: [{ itemId: y.r.receiptItemId, countedQty: 1 }] }),
    "saveCounts#misto-itemY": (x, y) => receiving.saveCounts(adm(x), x.r.receiptId, { items: [{ itemId: y.r.receiptItemId, countedQty: 1 }] }),
    addReceiptDivergence: (x, y) => receiving.addReceiptDivergence(adm(x), y.r.receiptId, { divergenceType: "other", description: "invasão" }),
    finishCheck: (x, y) => receiving.finishCheck(adm(x), y.r.receiptId, {}),
    releaseReceipt: (x, y) => receiving.releaseReceipt(adm(x), y.r.receiptId),
    releaseQualityHold: (x, y) => receiving.releaseQualityHold(adm(x), y.r.receiptItemId, { quantity: 1, justification: "invasão entre empresas" }),
    cancelReceipt: (x, y) => receiving.cancelReceipt(adm(x), y.r.receiptId, reason),
  }),
  ...reg("divergences", {
    resolveDivergence: (x, y) => divergences.resolveDivergence(adm(x), y.r.divergenceId, { resolution: "Resolvido por outra empresa" }),
  }),
  ...reg("outbound", {
    importSalesOrder: (x, y) => outbound.importSalesOrder(adm(x), { salesOrderId: y.r.salesOrderId, warehouseId: x.warehouseId }),
    createManualOrder: (x, y) => outbound.createManualOrder(adm(x), { warehouseId: y.warehouseId, customerName: "Invasor", lines: [{ productId: y.products["SKU-001"], quantity: 1 }] }),
    "createManualOrder#misto-produtoY": (x, y) => outbound.createManualOrder(adm(x), { warehouseId: x.warehouseId, customerName: "Invasor", lines: [{ productId: y.products["SKU-001"], quantity: 1 }] }),
    reserveOrder: (x, y) => outbound.reserveOrder(adm(x), y.r.openOrderId),
    releaseForPicking: (x, y) => outbound.releaseForPicking(adm(x), y.r.waveOrderId),
    checkOrder: (x, y) => outbound.checkOrder(adm(x), y.r.pickingOrderId, { lines: [{ lineId: y.r.openOrderLineId, checkedQty: 1 }] }),
    shipOrder: (x, y) => outbound.shipOrder(adm(x), y.r.pickingOrderId, {}),
    cancelOrder: (x, y) => outbound.cancelOrder(adm(x), y.r.openOrderId, reason),
    cancelOrderLine: (x, y) => outbound.cancelOrderLine(adm(x), y.r.openOrderId, { ...reason, lineId: y.r.openOrderLineId }),
    "cancelOrderLine#misto-linhaY": (x, y) => outbound.cancelOrderLine(adm(x), x.r.openOrderId, { ...reason, lineId: y.r.openOrderLineId }),
    setOrderPlanning: (x, y) => outbound.setOrderPlanning(adm(x), y.r.openOrderId, { carrier: "Invasora" }),
    "setOrderPlanning#misto-docaY": (x, y) => outbound.setOrderPlanning(adm(x), x.r.openOrderId, { dockLocationId: y.dockLocationId }),
  }),
  ...reg("tasks", {
    startTask: (x, y) => tasks.startTask(adm(x), y.r.transferTaskId),
    updateTaskAssignment: (x, y) => tasks.updateTaskAssignment(adm(x), y.r.transferTaskId, { priority: 1 }),
    "updateTaskAssignment#misto-usuarioY": (x, y) => tasks.updateTaskAssignment(adm(x), x.r.transferTaskId, { userId: y.r.operatorUserId, priority: 2 }),
    cancelTask: (x, y) => tasks.cancelTask(adm(x), y.r.transferTaskId, reason),
    completeTask: (x, y) => tasks.completeTask(adm(x), y.r.transferTaskId, {}),
    "completeTask#misto-destinoY": (x, y) => tasks.completeTask(adm(x), x.r.transferTaskId, { locationId: y.locations[LOC(3, 1)] }),
    "completeTask#picking": (x, y) => tasks.completeTask(adm(x), y.r.pickTaskId, {}),
    createTransfer: (x, y) => tasks.createTransfer(adm(x), { fromLocationId: y.locations[LOC(1, 1)], productId: y.products["SKU-001"], quantity: 1, toLocationId: y.locations[LOC(4, 1)] }),
    "createTransfer#misto-destinoY": (x, y) => tasks.createTransfer(adm(x), { fromLocationId: x.locations[LOC(1, 1)], productId: x.products["SKU-001"], quantity: 1, toLocationId: y.locations[LOC(4, 1)] }),
    "createTransfer#misto-executar": (x, y) => tasks.createTransfer(adm(x), { fromLocationId: x.locations[LOC(1, 1)], productId: x.products["SKU-001"], quantity: 1, toLocationId: y.locations[LOC(4, 1)], executeNow: "on" }),
  }),
  ...reg("collector", {
    claimTask: (x, y) => collector.claimTask(op(x), y.r.transferTaskId),
    completeFromCollector: (x, y) => collector.completeFromCollector(op(x), y.r.transferTaskId, { productCode: "SKU-003", quantity: 7, locationCode: LOC(3, 1), originCode: LOC(2, 1) }),
    countFromCollector: (x, y) => collector.countFromCollector(op(x), y.r.inventoryId, { locationCode: LOC(2, 1), productCode: "SKU-003", quantity: 1 }),
  }),
  ...reg("inventory", {
    createInventory: (x, y) => inventory.createInventory(adm(x), { warehouseId: y.warehouseId, countType: "general" }),
    "createInventory#misto-enderecoY": (x, y) => inventory.createInventory(adm(x), { warehouseId: x.warehouseId, countType: "cyclic", locationId: y.locations[LOC(1, 1)] }),
    "createInventory#misto-produtoY": (x, y) => inventory.createInventory(adm(x), { warehouseId: x.warehouseId, countType: "cyclic", productId: y.products["SKU-001"] }),
    "createInventory#misto-zonaY": (x, y) => inventory.createInventory(adm(x), { warehouseId: x.warehouseId, countType: "cyclic", zoneId: y.zones.ARM }),
    recordCounts: (x, y) => inventory.recordCounts(adm(x), y.r.inventoryId, { items: [{ itemId: y.r.inventoryItemId, countedQty: 1 }] }),
    "recordCounts#misto-itemY": (x, y) => inventory.recordCounts(adm(x), x.r.inventoryId, { items: [{ itemId: y.r.inventoryItemId, countedQty: 1 }] }),
    addInventoryItem: (x, y) => inventory.addInventoryItem(adm(x), y.r.inventoryId, { locationId: y.locations[LOC(2, 1)], productId: y.products["SKU-001"], countedQty: 1 }),
    "addInventoryItem#misto-produtoY": (x, y) => inventory.addInventoryItem(adm(x), x.r.inventoryId, { locationId: x.locations[LOC(2, 1)], productId: y.products["SKU-002"], countedQty: 1 }),
    "addInventoryItem#misto-enderecoY": (x, y) => inventory.addInventoryItem(adm(x), x.r.inventoryId, { locationId: y.locations[LOC(2, 1)], productId: x.products["SKU-002"], countedQty: 1 }),
    submitInventory: (x, y) => inventory.submitInventory(adm(x), y.r.inventoryId),
    approveInventory: (x, y) => inventory.approveInventory(adm(x), y.r.inventoryId, {}),
    rejectInventory: (x, y) => inventory.rejectInventory(adm(x), y.r.inventoryId, { notes: "Recontagem pedida por outra empresa" }),
    cancelInventory: (x, y) => inventory.cancelInventory(adm(x), y.r.inventoryId, reason),
  }),
  ...reg("waves", {
    createWave: (x, y) => waves.createWave(adm(x), { warehouseId: y.warehouseId, grouping: "manual", orderIds: [y.r.waveOrderId], dockLocationId: y.dockLocationId }),
    "createWave#misto-pedidoY": (x, y) => waves.createWave(adm(x), { warehouseId: x.warehouseId, grouping: "manual", orderIds: [y.r.waveOrderId], dockLocationId: x.dockLocationId }),
    addOrderToWave: (x, y) => waves.addOrderToWave(adm(x), y.r.waveId, { orderId: y.r.openOrderId }),
    "addOrderToWave#misto-pedidoY": (x, y) => waves.addOrderToWave(adm(x), x.r.waveId, { orderId: y.r.waveOrderId }),
    removeOrderFromWave: (x, y) => waves.removeOrderFromWave(adm(x), y.r.waveId, { orderId: y.r.waveOrderId }),
    releaseWave: (x, y) => waves.releaseWave(adm(x), y.r.waveId),
    cancelWave: (x, y) => waves.cancelWave(adm(x), y.r.waveId, reason),
    distributeWaveOrder: (x, y) => waves.distributeWaveOrder(adm(x), y.r.waveId, { orderId: y.r.waveOrderId }),
  }),
  ...reg("returns", {
    createReturn: (x, y) => returns.createReturn(adm(x), { outboundOrderId: y.r.shippedOrderId, reason: "regret", items: [{ orderLineId: y.r.shippedOrderLineId, quantity: 1 }] }),
    "createReturn#misto-linhaY": (x, y) => returns.createReturn(adm(x), { outboundOrderId: x.r.shippedOrderId, reason: "regret", items: [{ orderLineId: y.r.shippedOrderLineId, quantity: 1 }] }),
    inspectReturnItem: (x, y) => returns.inspectReturnItem(adm(x), y.r.returnItemId, { approvedQty: 1 }),
    cancelReturn: (x, y) => returns.cancelReturn(adm(x), y.r.returnId, reason),
  }),
  ...reg("users", {
    createUser: (x, y) => users.createUser(adm(x), { name: "Invasor", email: `inv-${x.key}${y.key}@x.qa.test`, role: "operator", password: "Senha-123x", warehouseIds: [y.warehouseId] }),
    updateUser: (x, y) => users.updateUser(adm(x), y.r.operatorUserId, { name: "Invadido", role: "admin" }),
    setUserActive: (x, y) => users.setUserActive(adm(x), y.r.operatorUserId, false),
    resetUserPassword: (x, y) => users.resetUserPassword(adm(x), y.r.operatorUserId),
    setUserWarehouses: (x, y) => users.setUserWarehouses(adm(x), y.r.operatorUserId, { warehouseIds: [] }),
    "setUserWarehouses#misto-depositoY": (x, y) => users.setUserWarehouses(adm(x), x.r.operatorUserId, { warehouseIds: [y.warehouseId] }),
    changeOwnPassword: async () => { throw new DomainError("sem alvo: altera só a senha do próprio usuário"); },
  }),
  ...reg("integration", {
    retryOutboxEvent: (x, y) => integration.retryOutboxEvent(adm(x), y.r.outboxEventId),
    discardOutboxEvent: (x, y) => integration.discardOutboxEvent(adm(x), y.r.outboxEventId, { reason: "invasão entre empresas" }),
  }),
  ...reg("replenishment", {
    saveReplenishmentSetting: (x, y) => replenishment.saveReplenishmentSetting(adm(x), { locationId: y.locations[LOC(1, 2)], productId: y.products["SKU-001"], minQty: 1, maxQty: 5 }),
    "saveReplenishmentSetting#misto-produtoY": (x, y) => replenishment.saveReplenishmentSetting(adm(x), { locationId: x.locations[LOC(1, 2)], productId: y.products["SKU-001"], minQty: 1, maxQty: 5 }),
    runReplenishmentCheck: (x, y) => replenishment.runReplenishmentCheck(adm(x), { warehouseId: y.warehouseId }),
  }),
  ...reg("slotting", {
    createSlottingTransfer: (x, y) => slotting.createSlottingTransfer(adm(x), { fromLocationId: y.locations[LOC(1, 1)], toLocationId: y.locations[LOC(4, 1)], productId: y.products["SKU-001"], quantity: 1 }),
    "createSlottingTransfer#misto-destinoY": (x, y) => slotting.createSlottingTransfer(adm(x), { fromLocationId: x.locations[LOC(1, 1)], toLocationId: y.locations[LOC(4, 1)], productId: x.products["SKU-001"], quantity: 1 }),
  }),
  ...reg("comex", {
    saveReceiptImport: (x, y) => comex.saveReceiptImport(adm(x), y.r.receiptId, { incoterm: "FOB", originCountry: "CN" }),
    "saveReceiptImport#misto-itemY": (x, y) => comex.saveReceiptImport(adm(x), x.r.receiptId, { items: [{ id: y.r.receiptItemId, ncm: "84818099" }] }),
    clearCustoms: (x, y) => comex.clearCustoms(adm(x), y.r.receiptId, { clearedOn: today }),
    saveOrderExport: (x, y) => comex.saveOrderExport(adm(x), y.r.openOrderId, { isExport: "on", incoterm: "FOB", destinationCountry: "US" }),
    addExportPackage: (x, y) => comex.addExportPackage(adm(x), y.r.pickingOrderId, {
      grossWeightKg: 1, netWeightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1, items: [{ orderLineId: y.r.openOrderLineId, quantity: 1 }],
    }),
    removeExportPackage: (x, y) => comex.removeExportPackage(adm(x), y.r.packagingId),
    finishPacking: (x, y) => comex.finishPacking(adm(x), y.r.pickingOrderId),
    stuffContainer: (x, y) => comex.stuffContainer(adm(x), y.r.pickingOrderId, { containerNumber: "CSQU3054383", sealNumber: "L1" }),
  }),
  ...reg("production", {
    createRequisition: (x, y) => production.createRequisition(adm(x), { productionOrderId: y.r.productionOrderId, lineLocationId: y.r.productionLineId }),
    "createRequisition#misto-ordemY": (x, y) => production.createRequisition(adm(x), { productionOrderId: y.r.productionOrderId, lineLocationId: x.r.productionLineId }),
    "createRequisition#misto-linhaY": (x, y) => production.createRequisition(adm(x), { productionOrderId: x.r.productionOrder2Id, lineLocationId: y.r.productionLineId }),
    reserveRequisition: (x, y) => production.reserveRequisition(adm(x), y.r.requisitionId),
    releaseRequisition: (x, y) => production.releaseRequisition(adm(x), y.r.requisitionId),
    deliverToLine: (x, y) => production.deliverToLine(adm(x), y.r.requisitionId, { receivedBy: "Invasor" }),
    returnLeftovers: (x, y) => production.returnLeftovers(adm(x), y.r.requisitionId, { lineId: y.r.requisitionId, quantity: 1, locationId: y.locations[LOC(1, 1)] }),
    receiveOutput: (x, y) => production.receiveOutput(adm(x), y.r.requisitionId, { quantity: 1 }),
    completeRequisition: (x, y) => production.completeRequisition(adm(x), y.r.requisitionId),
    cancelRequisition: (x, y) => production.cancelRequisition(adm(x), y.r.requisitionId, reason),
  }),
  ...reg("nfe", {
    importNfe: async () => { throw new DomainError("sem alvo: a mesma NF-e foi importada nas 5 empresas no fixture (colisão de chave)"); },
    linkNfeSupplier: (x, y) => nfe.linkNfeSupplier(adm(x), y.r.nfeImportId, { supplierId: y.supplierId }),
    "linkNfeSupplier#misto-fornecedorY": (x, y) => nfe.linkNfeSupplier(adm(x), x.r.nfeImportId, { supplierId: y.supplierId }),
    linkNfeItem: (x, y) => nfe.linkNfeItem(adm(x), y.r.nfeItemId, { productId: y.products["SKU-001"] }),
    "linkNfeItem#misto-produtoY": (x, y) => nfe.linkNfeItem(adm(x), x.r.nfeItemId, { productId: y.products["SKU-001"] }),
    setNfePurchaseOrder: (x, y) => nfe.setNfePurchaseOrder(adm(x), y.r.nfeImportId, { purchaseOrderId: y.r.purchaseOrderId }),
    "setNfePurchaseOrder#misto-pedidoY": (x, y) => nfe.setNfePurchaseOrder(adm(x), x.r.nfeImportId, { purchaseOrderId: y.r.purchaseOrderId }),
    discardNfe: (x, y) => nfe.discardNfe(adm(x), y.r.nfeImportId),
    createReceiptFromNfe: (x, y) => nfe.createReceiptFromNfe(adm(x), y.r.nfeImportId, { warehouseId: x.warehouseId }),
    "createReceiptFromNfe#misto-depositoY": (x, y) => nfe.createReceiptFromNfe(adm(x), x.r.nfeImportId, { warehouseId: y.warehouseId }),
  }),
  ...reg("settings", {
    updateSettings: async () => { throw new DomainError("sem alvo: grava só na empresa do contexto (Y conferida por snapshot)"); },
  }),
  ...reg("company", {
    updateCompanyProfile: async () => { throw new DomainError("sem alvo: grava só na empresa do contexto"); },
    unlinkAtlasCompany: async () => { throw new DomainError("sem alvo: grava só na empresa do contexto"); },
  }),
  ...reg("novidades", {
    marcarVersaoVista: async () => { throw new DomainError("sem alvo: grava só para o próprio usuário"); },
  }),
];

// -----------------------------------------------------------------------------

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
let markers: Map<string, { ids: Set<string>; texts: string[] }>;
const stats = { readChecks: 0, byIdChecks: 0, writeAttacks: 0, snapshotsCompared: 0, fkChecks: 0, apiChecks: 0 };
const started = Date.now();

function leaks(value: unknown, y: Tenant): string[] {
  const json = JSON.stringify(value ?? null, (_k, v) => (typeof v === "bigint" ? String(v) : v));
  const m = markers.get(y.key)!;
  const found = new Set<string>();
  for (const u of json.match(UUID_RE) ?? []) if (m.ids.has(u)) found.add(u);
  for (const t of m.texts) if (json.includes(t)) found.add(t);
  return [...found];
}

beforeAll(async () => {
  // TEST_DATABASE_URL: roda a mesma bateria no PostgreSQL real (o banco é APAGADO).
  const url = process.env.TEST_DATABASE_URL?.trim();
  env = await createMultiTenantEnv(url ? await freshPostgres(url) : undefined);
  markers = new Map();
  for (const t of env.tenants) {
    const k = t.key.toLowerCase();
    markers.set(t.key, {
      ids: await tenantIds(env.db, t.companyId),
      texts: [t.name, `@${k}.qa.test`, `da empresa ${t.key}`, `Lacre violado ${t.key}`, `Transportadora ${t.key}`, `Depósito principal ${t.key}`],
    });
  }
}, 300_000);

afterAll(async () => {
  if (env.db.driver === "postgres") await env.db.close();
  console.log(
    `[multiempresa] empresas=${env.tenants.length} usuarios=${env.all.length} leituras=${stats.readChecks} ` +
      `buscas-por-id=${stats.byIdChecks} ataques-de-escrita=${stats.writeAttacks} snapshots=${stats.snapshotsCompared} ` +
      `driver=${env.db.driver} fks-verificadas=${stats.fkChecks} api=${stats.apiChecks} tempo=${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
});

describe("Fixture multiempresa", () => {
  it("5 empresas, 49 funcionários com todos os perfis, mesmos SKUs e códigos de endereço", async () => {
    expect(env.tenants).toHaveLength(5);
    expect(env.all).toHaveLength(49);
    expect(env.tenants.map((t) => t.staff.length)).toEqual(COMPANIES.map((c) => c.staff));
    for (const t of env.tenants) {
      expect(new Set(t.staff.map((s) => s.role))).toEqual(new Set(["admin", "supervisor", "operator", "auditor"]));
      expect(t.staff.every((s) => s.ctx.user.companyId === t.companyId)).toBe(true);
    }
    const [dup] = await env.db.query<{ n: number }>(
      `select count(distinct company_id)::int as n from wms.locations where code = $1`, [LOC(1, 1)],
    );
    expect(dup.n).toBe(5);
    const [sku] = await env.db.query<{ n: number }>(`select count(*)::int as n from erp.products where sku = 'SKU-001'`);
    expect(sku.n).toBe(5);
  });
});

describe("Cobertura: todo export de src/server/services está classificado", () => {
  it("leitura, escrita ou exclusão justificada", async () => {
    const dir = path.join(process.cwd(), "src/server/services");
    const missing: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const mod = file.replace(/\.ts$/, "");
      const exports = MODULES[mod] ?? (await import(`../src/server/services/${mod}.ts`));
      for (const [name, value] of Object.entries(exports)) {
        if (typeof value !== "function") continue;
        const full = `${mod}.${name}`;
        if (covered.has(full) || EXCLUDED[full] || EXCLUDED[`${mod}.*`]) continue;
        missing.push(full);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("Leituras: usuário de X não vê nada de Y", () => {
  it.each(COMPANIES.map((c) => c.key))("empresa %s", async (xKey) => {
    const x = env.tenants.find((t) => t.key === xKey)!;
    const problems: string[] = [];
    for (const y of env.tenants.filter((t) => t !== x)) {
      for (const r of READS) {
        let value: unknown;
        try {
          value = await r.fn(x, y);
        } catch (e) {
          if (!(e instanceof DomainError)) problems.push(`${r.name} (${x.key}->${y.key}): erro inesperado ${(e as Error).message}`);
          value = null;
        }
        stats.readChecks++;
        if (/#|get|entityHistory|Labels|inventoryLocation|check|taskAllocations|serials|returnableLines|Deliveries/.test(r.name)) stats.byIdChecks++;
        const l = leaks(value, y);
        if (l.length) problems.push(`${r.name} (${x.key} vê ${y.key}): ${l.slice(0, 3).join(", ")}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("códigos iguais (endereço, SKU, EAN, embalagem) resolvem para o registro da própria empresa", async () => {
    for (const x of env.tenants) {
      const loc = (await collector.resolveLocationCode(op(x), LOC(1, 1))) as { id: string };
      expect(loc.id).toBe(x.locations[LOC(1, 1)]);
      for (const code of ["SKU-001", "7891000000011"]) {
        const p = (await collector.resolveProductCode(op(x), code)) as { id?: string; productId?: string; product_id?: string };
        expect(p.id ?? p.productId ?? p.product_id).toBe(x.products["SKU-001"]);
      }
    }
  });

  it("KPIs, dashboard, curva ABC e produtividade agregam só a própria empresa (movimentar Y não muda os números de X)", async () => {
    const aggregates = async (x: Tenant) => {
      const abc = await slotting.computeAbc(adm(x));
      const prod = await productivity.productivityByUser(adm(x), {});
      const st = await stock.listStock(adm(x), {});
      return JSON.stringify({
        kpis: await dashboard.getKpis(adm(x)),
        series: await dashboard.getKpiSeries(adm(x)),
        flow: await dashboard.getFlowSeries(adm(x)),
        dist: await dashboard.getTaskDistribution(adm(x)),
        perf: await dashboard.getPerformance(adm(x)),
        alerts: await dashboard.getAlerts(adm(x)),
        abc: abc.rows.map((r) => [r.sku, (r as unknown as { units: number }).units, (r as unknown as { stock: number }).stock]),
        prod: prod.rows,
        stock: st.totals,
      });
    };
    const [x, y] = env.tenants;
    const before = await aggregates(x);
    // Y trabalha: ajuste, transferência executada, tarefa concluída por operador de Y
    await stock.adjustStock(adm(y), { locationId: y.locations[LOC(4, 2)], productId: y.products["SKU-001"], direction: "in", quantity: 777, reason: "movimento de Y para o teste de KPI" });
    const t = await tasks.createTransfer(op(y), { fromLocationId: y.locations[LOC(4, 2)], productId: y.products["SKU-001"], quantity: 77, toLocationId: y.locations[LOC(3, 2)] });
    await tasks.completeTask(op(y), t.id, {});
    expect(await aggregates(x)).toBe(before);
    // e a própria curva ABC de X só lista produtos de X
    const own = new Set(Object.values(x.products));
    const abc = await slotting.computeAbc(adm(x));
    expect(abc.rows.length).toBeGreaterThan(0);
    for (const r of abc.rows as unknown as { product_id: string }[]) expect(own.has(r.product_id)).toBe(true);
    const prod = await productivity.productivityByUser(adm(y), {});
    const staffY = new Set(y.staff.map((s) => s.ctx.user.id));
    expect(prod.rows.length).toBeGreaterThan(0);
    for (const r of prod.rows as unknown as { user_id?: string; id?: string }[]) expect(staffY.has((r.user_id ?? r.id)!)).toBe(true);
  });
});

describe("Escritas: X não altera nada de Y", () => {
  const accepted: string[] = [];
  const messages = new Map<string, string>();

  it.each(COMPANIES.map((c) => c.key))("empresa %s ataca as outras 4", async (xKey) => {
    const x = env.tenants.find((t) => t.key === xKey)!;
    for (const y of env.tenants.filter((t) => t !== x)) {
      const before = await snapshot(env.db, y.companyId);
      for (const w of WRITES) {
        stats.writeAttacks++;
        try {
          await w.fn(x, y);
          accepted.push(`${w.name} (${x.key}->${y.key})`);
        } catch (e) {
          if (!(e instanceof DomainError)) accepted.push(`${w.name} (${x.key}->${y.key}): erro não tratado ${(e as Error).message}`);
          else if (!messages.has(w.name)) messages.set(w.name, `${(e as DomainError).code}: ${e.message}`);
        }
      }
      const after = await snapshot(env.db, y.companyId);
      stats.snapshotsCompared++;
      const changed = Object.keys(before).filter((k) => before[k] !== after[k]);
      expect(changed, `dados de ${y.key} alterados por ${x.key}`).toEqual([]);
    }
    expect(accepted).toEqual([]);
  });

  it("nenhuma FK aponta para registro de outra empresa", async () => {
    const refs = await crossTenantReferences(env.db);
    stats.fkChecks += refs.length;
    expect(refs.length).toBeGreaterThan(50);
    expect(refs.filter((r) => r.rows > 0)).toEqual([]);
  });

  it("o banco recusa referência cruzada mesmo fora dos serviços (gatilho tenant_guard)", async () => {
    const [x, y] = env.tenants;
    const [g] = await env.db.query<{ n: number }>(`select count(*)::int as n from pg_trigger where tgname = 'tenant_guard'`);
    expect(g.n).toBeGreaterThan(30);
    await expect(
      env.db.query(`insert into wms.product_settings (product_id, company_id, preferred_zone_id) values ($1, $2, $3)`, [
        x.products[`EXC-${x.key}`], x.companyId, y.zones.ARM,
      ]),
    ).rejects.toThrow(/outra empresa/);
    await expect(
      env.db.query(
        `insert into wms.stock_balances (company_id, warehouse_id, location_id, product_id, quantity) values ($1, $2, $3, $4, 1)`,
        [x.companyId, x.warehouseId, x.locations[LOC(4, 2)], y.products["SKU-001"]],
      ),
    ).rejects.toThrow(/outra empresa/);
    await expect(
      env.db.query(`update wms.tasks set to_location_id = $1 where id = $2`, [y.locations[LOC(4, 1)], x.r.transferTaskId]),
    ).rejects.toThrow(/outra empresa/);
    // atualização comum (sem trocar referência) segue funcionando
    await env.db.query(`update wms.tasks set priority = priority where id = $1`, [x.r.transferTaskId]);
  });

  it("os ataques foram barrados por regra de empresa, não por validação de formato", () => {
    // VALIDATION com mensagem de regra ("não pertence ao pedido") é aceitável; mensagem de formato (Zod) não.
    const validation = [...messages.entries()].filter(([, m]) => m.startsWith("VALIDATION:") && /Invalid input|inválid|obrigatóri/i.test(m));
    console.log("[multiempresa] mensagens de recusa:\n" + [...messages.entries()].map(([k, m]) => `  ${k} => ${m}`).join("\n"));
    expect(validation).toEqual([]);
  });
});

describe("Identificador malformado", () => {
  it("ID que não é UUID (ex.: código TAR-000001 no lugar do ID) gera mensagem clara, não \"erro inesperado\"", async () => {
    const x = env.tenants[0];
    const error = await tasks.completeTask(op(x), "TAR-000001", {}).catch((e) => e);
    expect(toUserMessage(error)).toBe("Registro não encontrado: identificador inválido.");
  });
});

describe("Outbox e e-mails: cada empresa usa só a própria configuração", () => {
  it("processQueue de X não toca eventos de Y; e-mails de cada evento vão aos destinatários da empresa do evento", async () => {
    // novo evento pendente em cada empresa
    const pending = new Map<string, string>();
    for (const t of env.tenants) {
      const [r] = await env.db.query<{ id: string }>(
        `insert into wms.integration_events (company_id, event_type, aggregate_type, aggregate_id, payload)
         values ($1, 'divergence.registered', 'divergence', $2, $3) returning id`,
        [t.companyId, t.r.divergenceId, JSON.stringify({ location: LOC(1, 1), expected: 1, counted: 0 })],
      );
      pending.set(t.key, r.id);
    }
    const [a, ...others] = env.tenants;
    await integration.processQueue(sup(a), { transport: localTransport, email: logEmailTransport });
    const st = async (id: string) => (await env.db.query<{ status: string }>(`select status from wms.integration_events where id = $1`, [id]))[0].status;
    expect(await st(pending.get(a.key)!)).toBe("sent");
    for (const o of others) expect(await st(pending.get(o.key)!)).toBe("pending");
    // processador global (rota /api/integracao/processar): cada e-mail com os destinatários da sua empresa
    await processOutbox(env.db, { transport: localTransport, email: logEmailTransport, limit: 200 });
    const mails = await env.db.query<{ company_id: string; to_addresses: string[] }>(`select company_id, to_addresses from wms.email_messages`);
    expect(mails.length).toBeGreaterThanOrEqual(10);
    for (const m of mails) {
      const t = env.tenants.find((x) => x.companyId === m.company_id)!;
      expect(m.to_addresses).toEqual([`avisos@${t.key.toLowerCase()}.qa.test`]);
    }
    const [cross] = await env.db.query<{ n: number }>(
      `select count(*)::int as n from wms.email_messages m join wms.integration_events e on e.id = m.event_id where e.company_id <> m.company_id`,
    );
    expect(cross.n).toBe(0);
  });

  it("saúde do sistema (tela do administrador) conta só a fila da própria empresa", async () => {
    const [a, b] = env.tenants;
    for (let i = 0; i < 3; i++) {
      await env.db.query(
        `insert into wms.integration_events (company_id, event_type, aggregate_type, aggregate_id, payload, status)
         values ($1, 'outbound.shipped', 'outbound_order', $2, '{}', 'failed')`,
        [b.companyId, b.r.shippedOrderId],
      );
    }
    const hb = await health.getSystemHealth(adm(b));
    const ha = await health.getSystemHealth(adm(a));
    expect(hb.queue?.failed).toBe(3);
    expect(ha.queue?.failed).toBe(0);
    await env.db.query(`delete from wms.integration_events where company_id = $1 and status = 'failed'`, [b.companyId]);
  });
});

describe("Rotas de API com sessão de X", () => {
  it("/api/relatorios/[report] exporta só dados de X, mesmo com filtros apontando para Y", async () => {
    const { GET } = await import("@/app/api/relatorios/[report]/route");
    session.db = env.db;
    for (const x of env.tenants) {
      session.user = adm(x).user;
      for (const y of env.tenants.filter((t) => t !== x)) {
        for (const report of Object.keys(reports.REPORTS)) {
          const url = `http://localhost/api/relatorios/${report}?warehouseId=${y.warehouseId}&deposito=${y.warehouseId}&productId=${y.products["SKU-001"]}`;
          const { NextRequest } = await import("next/server");
          const res = await GET(new NextRequest(url), { params: Promise.resolve({ report }) });
          const body = await res.text();
          stats.apiChecks++;
          expect([200, 400]).toContain(res.status);
          expect(leaks(body, y), `${report}: ${x.key} vê ${y.key}`).toEqual([]);
          if (res.status === 200) expect(body).toContain(x.cnpj.slice(0, 2));
        }
      }
    }
  });

  it("/api/relatorios recusa operador e auditor (sem reports.export)", async () => {
    const { GET } = await import("@/app/api/relatorios/[report]/route");
    const { NextRequest } = await import("next/server");
    session.db = env.db;
    for (const ctx of [op(env.tenants[0]), env.tenants[0].auditor]) {
      session.user = ctx.user;
      const res = await GET(new NextRequest("http://localhost/api/relatorios/estoque"), { params: Promise.resolve({ report: "estoque" }) });
      stats.apiChecks++;
      expect(res.status).toBe(403);
    }
  });

  it("/api/health pública não expõe dados de empresa", async () => {
    const { GET } = await import("@/app/api/health/route");
    session.db = env.db;
    const res = await GET();
    const body = await res.text();
    stats.apiChecks++;
    for (const y of env.tenants) expect(leaks(body, y)).toEqual([]);
  });
});
