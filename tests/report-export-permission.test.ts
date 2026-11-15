import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestEnv, type TestEnv } from "./helpers";
import { can, ROLES, type Role } from "@/lib/permissions";
import { buildReport, exportReport } from "@/server/services/reports";

const state: { env?: TestEnv; role?: Role } = {};
vi.mock("@/server/auth/session", () => ({
  getSessionUser: async () => (state.role ? state.env!.as(state.role).user : null),
}));
vi.mock("@/server/db", () => ({ getDb: async () => state.env!.db }));

const { GET } = await import("@/app/api/relatorios/[report]/route");

async function download(role: Role | undefined, report = "estoque") {
  state.role = role;
  return GET(new NextRequest(`http://localhost/api/relatorios/${report}`), {
    params: Promise.resolve({ report }),
  });
}

describe("exportação CSV de relatórios: só gestão (administrador e supervisor)", () => {
  beforeAll(async () => {
    state.env = await createTestEnv();
  });

  it("matriz de permissão nos 4 perfis", () => {
    const expected: Record<Role, boolean> = {
      admin: true,
      supervisor: true,
      operator: false,
      auditor: false,
    };
    for (const r of ROLES) expect(can(r, "reports.export"), r).toBe(expected[r]);
    // o auditor continua consultando a pré-visualização; o operador não
    for (const r of ROLES) expect(can(r, "reports.view"), r).toBe(r !== "operator");
  });

  it("serviço: exportReport recusa operador e auditor", async () => {
    const env = state.env!;
    for (const r of ["admin", "supervisor"] as const) expect((await exportReport(env.as(r), "estoque", new URLSearchParams())).rows.length).toBeGreaterThan(0);
    for (const r of ["operator", "auditor"] as const) await expect(exportReport(env.as(r), "estoque", new URLSearchParams())).rejects.toThrow(/permissão/);
    expect((await buildReport(env.as("auditor"), "estoque", new URLSearchParams())).rows.length).toBeGreaterThan(0);
  });

  it("rota de download: 200 para administrador/supervisor, 403 para operador/auditor, 401 sem sessão", async () => {
    for (const r of ["admin", "supervisor"] as const) {
      const res = await download(r);
      expect(res.status, r).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/csv");
    }
    for (const r of ["operator", "auditor"] as const) {
      const res = await download(r, "produtividade");
      expect(res.status, r).toBe(403);
    }
    expect((await download(undefined)).status).toBe(401);
  });
});
