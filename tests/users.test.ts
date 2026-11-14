import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestEnv, key, type TestEnv } from "./helpers";
import * as users from "@/server/services/users";
import { authenticate, loadSessionUser } from "@/server/auth/users";
import type { Ctx } from "@/server/context";

describe("Gestão de usuários", () => {
  let env: TestEnv;
  const ctxOf = async (id: string): Promise<Ctx> => ({ db: env.db, user: (await loadSessionUser(env.db, id))! });

  beforeAll(async () => {
    env = await createTestEnv();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("somente administrador gerencia usuários", async () => {
    await expect(users.listUsers(env.as("supervisor"))).rejects.toThrow(/permissão/);
    await expect(
      users.createUser(env.as("supervisor"), { name: "Fulano", email: "f@x.com", role: "operator", password: "abc12345" }),
    ).rejects.toThrow(/permissão/);
    const list = await users.listUsers(env.as("admin"));
    expect(list.map((u) => u.email)).toContain("operador@metalsupply.demo");
  });

  it("cria usuário com regra mínima de senha, e-mail único e troca obrigatória no primeiro acesso", async () => {
    const admin = env.as("admin");
    const base = { name: "Carla Nova", email: "Carla.Nova@MetalSupply.demo", role: "operator" };
    await expect(users.createUser(admin, { ...base, password: "curta1" })).rejects.toThrow(/8 caracteres/);
    await expect(users.createUser(admin, { ...base, password: "somenteletras" })).rejects.toThrow(/letra e um número/);
    await expect(users.createUser(admin, { ...base, role: "root", password: "abc12345" })).rejects.toThrow(/Perfil inválido/);
    await expect(users.createUser(admin, { ...base, email: "operador@METALSUPPLY.demo", password: "abc12345" })).rejects.toThrow(/Já existe/);
    const k = key();
    const created = await users.createUser(admin, { ...base, password: "abc12345" }, { idempotencyKey: k });
    // Reenvio da mesma requisição não duplica.
    expect((await users.createUser(admin, { ...base, password: "abc12345" }, { idempotencyKey: k })).id).toBe(created.id);
    const u = await authenticate(env.db, "carla.nova@metalsupply.demo", "abc12345");
    expect(u?.id).toBe(created.id);
    expect(u?.mustChangePassword).toBe(true);
    expect(u?.warehouseIds).toBeNull();
    const audit = await env.one<{ n: number }>(`select count(*)::int as n from wms.audit_log where action = 'user.created' and entity_id = $1`, [created.id]);
    expect(audit.n).toBe(1);
  });

  it("protege o último administrador ativo e impede inativar a si mesmo", async () => {
    const admin = env.as("admin");
    await expect(users.setUserActive(admin, admin.user.id, false)).rejects.toThrow(/seu próprio usuário/);
    await expect(users.updateUser(admin, admin.user.id, { name: admin.user.name, role: "supervisor" })).rejects.toThrow(/último administrador/);
    // Com um segundo admin, o primeiro pode ser rebaixado/inativado pelo segundo.
    const second = await users.createUser(admin, { name: "Segundo Admin", email: "admin2@metalsupply.demo", role: "admin", password: "abc12345" });
    const second2 = await ctxOf(second.id);
    await users.setUserActive(second2, admin.user.id, false);
    expect(await loadSessionUser(env.db, admin.user.id)).toBeNull(); // sessão perde efeito na hora
    expect(await authenticate(env.db, admin.user.email, "orion-demo")).toBeNull();
    // Agora o segundo é o único admin ativo: não pode ser inativado nem rebaixado.
    await expect(users.updateUser(second2, second.id, { name: "Segundo Admin", role: "operator" })).rejects.toThrow(/último administrador/);
    await users.setUserActive(second2, admin.user.id, true);
    await users.updateUser(admin, second.id, { name: "Segundo Admin", role: "auditor" });
    expect((await loadSessionUser(env.db, second.id))!.role).toBe("auditor");
  });

  it("redefine senha com senha temporária exibida uma vez e exige troca no próximo login", async () => {
    const admin = env.as("admin");
    const operatorId = env.as("operator").user.id;
    const k = key();
    const r = await users.resetUserPassword(admin, operatorId, { idempotencyKey: k });
    expect(users.passwordProblem(r.temporaryPassword)).toBeNull();
    expect(await authenticate(env.db, "operador@metalsupply.demo", "orion-demo")).toBeNull();
    const logged = await authenticate(env.db, "operador@metalsupply.demo", r.temporaryPassword);
    expect(logged?.mustChangePassword).toBe(true);
    // A senha não fica gravada em claro (nem no resultado de idempotência nem na auditoria).
    const stored = await env.one<{ result: unknown }>(`select result from wms.idempotency_keys where key = $1`, [k]);
    expect(JSON.stringify(stored.result)).not.toContain(r.temporaryPassword);
    const logs = await env.db.query<{ details: unknown }>(`select details from wms.audit_log where entity_id = $1`, [operatorId]);
    expect(JSON.stringify(logs)).not.toContain(r.temporaryPassword);

    const ctx = await ctxOf(operatorId);
    await expect(users.changeOwnPassword(ctx, { currentPassword: "errada", newPassword: "nova12345", confirmPassword: "nova12345" })).rejects.toThrow(
      /Senha atual incorreta/,
    );
    await expect(
      users.changeOwnPassword(ctx, { currentPassword: r.temporaryPassword, newPassword: "nova12345", confirmPassword: "outra1234" }),
    ).rejects.toThrow(/confirmação/);
    await users.changeOwnPassword(ctx, { currentPassword: r.temporaryPassword, newPassword: "nova12345", confirmPassword: "nova12345" });
    const after = await authenticate(env.db, "operador@metalsupply.demo", "nova12345");
    expect(after?.mustChangePassword).toBe(false);
    const changed = await env.one<{ n: number }>(
      `select count(*)::int as n from wms.audit_log where action = 'user.password_changed' and entity_id = $1`,
      [operatorId],
    );
    expect(changed.n).toBe(1);
  });

  it("modo demonstração protege os usuários de demonstração, mas permite gerir usuários novos", async () => {
    vi.stubEnv("WMS_DEMO_MODE", "true");
    const admin = env.as("admin");
    const supervisorId = env.as("supervisor").user.id;
    await expect(users.resetUserPassword(admin, supervisorId)).rejects.toThrow(/Modo demonstração/);
    await expect(users.setUserActive(admin, supervisorId, false)).rejects.toThrow(/Modo demonstração/);
    await expect(users.updateUser(admin, supervisorId, { name: "Supervisor", role: "operator" })).rejects.toThrow(/Modo demonstração/);
    await expect(
      users.changeOwnPassword(admin, { currentPassword: "orion-demo", newPassword: "nova12345", confirmPassword: "nova12345" }),
    ).rejects.toThrow(/Modo demonstração/);
    const fresh = await users.createUser(admin, { name: "Teste Demo", email: "teste.demo@metalsupply.demo", role: "operator", password: "abc12345" });
    const r = await users.resetUserPassword(admin, fresh.id);
    expect(r.temporaryPassword).toHaveLength(12);
    await users.setUserActive(admin, fresh.id, false);
  });
});
