import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestEnv, type TestEnv } from "./helpers";
import type { Role } from "@/lib/permissions";
import { seedComexShowcase } from "@/server/seed/showcase";
import * as comex from "@/server/services/comex";
import { exportIndicators, importIndicators, listExportOrders, listImportProcesses } from "@/server/services/comex-panel";
import { importTimeline } from "@/lib/comex-panel";

const state: { env?: TestEnv; role?: Role } = {};
vi.mock("@/server/auth/session", () => ({
  getSessionUser: async () => (state.role ? state.env!.as(state.role).user : null),
}));
vi.mock("@/server/db", () => ({ getDb: async () => state.env!.db }));
const { GET } = await import("@/app/api/relatorios/[report]/route");

describe("Aba Comex: consultas, indicadores, isolamento e exportação CSV", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = state.env = await createTestEnv();
    await seedComexShowcase(env.db);
    await seedComexShowcase(env.db); // idempotente
  }, 120_000);

  it("vitrine cria processos em situações diferentes e não duplica", async () => {
    const rows = await listImportProcesses(env.as("auditor"));
    const demo = rows.filter((r) => r.po_number?.startsWith("PC-IMP-"));
    expect(demo).toHaveLength(4);
    expect(new Set(demo.map((r) => r.situation))).toEqual(new Set(["no_data", "awaiting", "stored"]));
    const exp = await listExportOrders(env.as("auditor"));
    expect(exp.map((r) => r.situation).sort()).toEqual(["packing", "stuffed"]);
    expect(exp.find((r) => r.situation === "stuffed")).toMatchObject({ packages: 2, destination_country: "CL", export_declaration: "26BR0001093374" });
  });

  it("filtros por situação, país, fornecedor, período e busca (DI/DUIMP, invoice, contêiner, BL/AWB)", async () => {
    const ctx = env.as("supervisor");
    expect((await listImportProcesses(ctx, { situation: "awaiting" })).every((r) => r.customs_status === "awaiting")).toBe(true);
    expect((await listImportProcesses(ctx, { country: "de" })).map((r) => r.po_number).sort()).toEqual(["PC-IMP-0003", "PC-IMP-0004"]);
    expect((await listImportProcesses(ctx, { q: "26BR0004417730" })).map((r) => r.po_number)).toEqual(["PC-IMP-0002"]);
    expect((await listImportProcesses(ctx, { q: "SW-90412" })).map((r) => r.po_number)).toEqual(["PC-IMP-0004"]);
    expect((await listImportProcesses(ctx, { q: "MEDUSZ" })).map((r) => r.po_number)).toEqual(["PC-IMP-0001"]);
    expect((await listImportProcesses(ctx, { q: "MSCU771204" })).map((r) => r.po_number)).toEqual(["PC-IMP-0001"]);
    const supplier = await env.id(`select id from erp.suppliers where code = 'FOR-CN01'`);
    expect((await listImportProcesses(ctx, { supplierId: supplier })).length).toBe(2);
    expect(await listImportProcesses(ctx, { from: "2999-01-01" })).toHaveLength(0);
    expect((await listExportOrders(ctx, { due: "without" })).map((r) => r.destination_country)).toEqual(["AR"]);
    expect((await listExportOrders(ctx, { country: "cl" })).length).toBe(1);
  });

  it("indicadores: em aberto, aguardando, desembaraçados no mês e trânsito com valor", async () => {
    const k = await importIndicators(env.as("auditor"));
    expect(k.awaiting).toBe(2);
    expect(k.open).toBe(3);
    // em trânsito: PC-IMP-0001 (600 × 38,50) e PC-IMP-0004 (12 × 1.890)
    expect(k.inTransit).toEqual({ processes: 2, quantity: 612, value: 600 * 38.5 + 12 * 1890 });
    expect(k.clearedSeries).toHaveLength(14);
    const cleared = await env.one<{ n: number }>(
      `select count(*)::int as n from wms.receipts where customs_cleared_on >= date_trunc('month', current_date)`,
    );
    expect(k.clearedThisMonth).toBe(cleared.n);
    expect(await exportIndicators(env.as("auditor"))).toMatchObject({ open: 2, packing: 1, withoutDue: 1 });
  });

  it("isolamento: outra empresa e depósito sem acesso não enxergam os processos", async () => {
    const sup = env.as("supervisor");
    const other = { db: env.db, user: { ...sup.user, companyId: crypto.randomUUID() } };
    expect(await listImportProcesses(other)).toHaveLength(0);
    expect(await listExportOrders(other)).toHaveLength(0);
    expect((await importIndicators(other)).open).toBe(0);
    const cd02 = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    const elsewhere = await env.db.query<{ id: string }>(`select id from wms.warehouses where id <> $1 limit 1`, [cd02]);
    const restricted = { db: env.db, user: { ...sup.user, warehouseIds: [elsewhere[0]?.id ?? crypto.randomUUID()] } };
    expect((await listImportProcesses(restricted)).some((r) => r.po_number?.startsWith("PC-IMP-"))).toBe(false);
    expect(await listExportOrders(restricted)).toHaveLength(0);
  });

  it("novos campos: validações de data e canal exigem a declaração", async () => {
    const sup = env.as("supervisor");
    const id = await env.id(`select r.id from wms.receipts r join erp.purchase_orders p on p.id = r.purchase_order_id where p.number = 'PC-IMP-0001'`);
    await expect(comex.saveReceiptImport(sup, id, { shippedOn: "2026-10-10", etaOn: "2026-10-01" })).rejects.toThrow(/anterior ao embarque/);
    await expect(comex.saveReceiptImport(sup, id, { customsChannel: "red" })).rejects.toThrow(/exigem a declaração/);
    await expect(comex.saveReceiptImport(sup, id, { transportMode: "boat" })).rejects.toThrow(/Modal/);
    await expect(env.db.query(`update wms.receipts set customs_channel = 'blue' where id = $1`, [id])).rejects.toMatchObject({ code: "23514" });
  });

  it("linha do tempo: armazenado implica recebido e chegada; marcos aduaneiros só quando registrados", () => {
    const t = importTimeline({ shipped_on: null, eta_on: "2026-11-20", arrived_at: null, import_registered_on: null, customs_cleared_on: null, checked_at: null, completed_at: "2026-11-10 10:00:00+00" });
    expect(t.map((s) => s.done)).toEqual([false, true, false, false, true, true]);
  });

  it("CSV do Comex: só gestão (reports.export) e respeita filtros", async () => {
    for (const role of ["operator", "auditor"] as const) {
      state.role = role;
      const res = await GET(new NextRequest("http://localhost/api/relatorios/importacoes"), { params: Promise.resolve({ report: "importacoes" }) });
      expect(res.status).toBe(403);
    }
    state.role = "supervisor";
    const res = await GET(new NextRequest("http://localhost/api/relatorios/importacoes?situacao=awaiting&cabecalho=0"), {
      params: Promise.resolve({ report: "importacoes" }),
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("26BR0004417730");
    expect(csv).not.toContain("Armazenado");
    const exp = await GET(new NextRequest("http://localhost/api/relatorios/exportacoes?cabecalho=0"), { params: Promise.resolve({ report: "exportacoes" }) });
    expect(await exp.text()).toContain("INV-2026-0107");
  });
});
