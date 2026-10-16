import { describe, expect, it, beforeAll } from "vitest";
import { createToken, verifyToken } from "@/server/auth/token";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { authenticate } from "@/server/auth/users";
import { can, PERMISSIONS, ROLES } from "@/lib/permissions";
import { DEMO_PASSWORD } from "@/server/seed/demo";
import { createTestEnv, type TestEnv } from "./helpers";
import { listAudit } from "@/server/services/audit";
import { buildReport, toCsv } from "@/server/services/reports";

const SECRET = "x".repeat(48);

describe("Autenticação e permissões", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv();
  });

  it("token de sessão assinado rejeita adulteração e expiração", () => {
    const token = createToken("user-1", 60, SECRET);
    expect(verifyToken(token, SECRET)?.uid).toBe("user-1");
    const [data, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "admin", exp: 9999999999 })).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(verifyToken(`${data}.${sig}`, "y".repeat(48))).toBeNull();
    expect(verifyToken(createToken("user-1", -10, SECRET), SECRET)).toBeNull();
  });

  it("hash de senha com scrypt", async () => {
    const hash = await hashPassword("segredo-forte");
    expect(hash).not.toContain("segredo-forte");
    expect(await verifyPassword("segredo-forte", hash)).toBe(true);
    expect(await verifyPassword("errada", hash)).toBe(false);
  });

  it("login de usuários de demonstração", async () => {
    expect((await authenticate(env.db, "operador@metalsupply.demo", DEMO_PASSWORD))?.role).toBe("operator");
    expect(await authenticate(env.db, "operador@metalsupply.demo", "senha-errada")).toBeNull();
    expect(await authenticate(env.db, "naoexiste@x.com", DEMO_PASSWORD)).toBeNull();
  });

  it("matriz: auditor só consulta; operador não aprova nem ajusta", () => {
    const writePerms = Object.keys(PERMISSIONS).filter((p) => !["reports.export", "audit.view"].includes(p));
    for (const p of writePerms) expect(can("auditor", p as never)).toBe(false);
    expect(can("operator", "stock.adjust")).toBe(false);
    expect(can("operator", "inventory.approve")).toBe(false);
    expect(can("operator", "task.execute")).toBe(true);
    expect(can("supervisor", "inventory.approve")).toBe(true);
    for (const r of ROLES) expect(can(r, "audit.view")).toBe(r !== "operator");
  });

  it("auditoria e relatórios respeitam permissões no servidor", async () => {
    await expect(listAudit(env.as("operator"))).rejects.toThrow(/permissão/);
    const audit = await listAudit(env.as("auditor"));
    expect(audit.total).toBeGreaterThan(0);
    await expect(buildReport(env.as("operator"), "estoque", new URLSearchParams())).rejects.toThrow(/permissão/);
    const table = await buildReport(env.as("auditor"), "estoque", new URLSearchParams());
    const csv = toCsv(table);
    expect(csv.startsWith("﻿Depósito;Endereço;SKU")).toBe(true);
    expect(csv).toContain("LUB-002");
  });

  it("CSV neutraliza fórmulas e escapa separadores", () => {
    const csv = toCsv({ headers: ["a", "b"], rows: [["=HYPERLINK(1)", 'x;"y"']] });
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain('"x;""y"""');
  });
});
