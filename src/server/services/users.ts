import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError, NotFoundError } from "../errors";
import { parse } from "../validation";
import { hashPassword, verifyPassword } from "../auth/password";
import { isDemoMode } from "../demo-mode";
import { ROLES, type Role } from "@/lib/permissions";
import { audit, runOperation, type OpOptions } from "./common";

// -----------------------------------------------------------------------------
// Regra de senha
// -----------------------------------------------------------------------------

export const PASSWORD_RULE = "Mínimo de 8 caracteres, com pelo menos uma letra e um número.";

export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "A senha deve ter pelo menos 8 caracteres.";
  if (password.length > 128) return "A senha deve ter no máximo 128 caracteres.";
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) return "A senha deve conter pelo menos uma letra e um número.";
  return null;
}

const passwordField = (label = "Senha") =>
  z
    .string({ error: `${label} é obrigatória.` })
    .superRefine((v, c) => {
      const problem = passwordProblem(v);
      if (problem) c.addIssue({ code: "custom", message: problem });
    });

/** Senha temporária legível (sem caracteres ambíguos), sempre com letra e número. */
export function generateTemporaryPassword(length = 12): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const chars = [letters[randomInt(letters.length)], digits[randomInt(digits.length)]];
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// -----------------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------------

export interface UserListRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  is_demo: boolean;
  must_change_password: boolean;
  created_at: string;
  last_login_at: string | null;
  warehouse_codes: string[] | null;
}

export async function listUsers(ctx: Ctx, f: { q?: string | null; role?: string | null; status?: string | null } = {}) {
  assertCan(ctx, "users.manage");
  return ctx.db.query<UserListRow>(
    `select u.id, u.name, u.email, u.role, u.active, u.is_demo, u.must_change_password, u.created_at::text as created_at,
            (select max(a.created_at)::text from wms.audit_log a where a.company_id = u.company_id and a.user_id = u.id
               and a.action = 'auth.login') as last_login_at,
            (select json_agg(w.code order by w.code) from wms.user_warehouses uw join wms.warehouses w on w.id = uw.warehouse_id
               where uw.user_id = u.id) as warehouse_codes
     from wms.users u
     where u.company_id = $1 and ($2::text is null or u.name ilike '%' || $2 || '%' or u.email ilike '%' || $2 || '%')
       and ($3::text is null or u.role = $3) and ($4::text is null or u.active = ($4 = 'active'))
     order by u.active desc, u.name`,
    [ctx.user.companyId, f.q || null, f.role || null, f.status || null],
  );
}

export async function getUser(ctx: Ctx, id: string) {
  assertCan(ctx, "users.manage");
  const [u] = await ctx.db.query<UserListRow & { warehouse_ids: string[] | null; password_changed_at: string | null }>(
    `select u.id, u.name, u.email, u.role, u.active, u.is_demo, u.must_change_password, u.created_at::text as created_at,
            u.password_changed_at::text as password_changed_at,
            (select max(a.created_at)::text from wms.audit_log a where a.company_id = u.company_id and a.user_id = u.id
               and a.action = 'auth.login') as last_login_at,
            (select json_agg(uw.warehouse_id) from wms.user_warehouses uw where uw.user_id = u.id) as warehouse_ids,
            null as warehouse_codes
     from wms.users u where u.id = $1 and u.company_id = $2`,
    [id, ctx.user.companyId],
  );
  return u ?? null;
}

/** Todos os depósitos da empresa (para o administrador escolher o acesso). */
export async function listCompanyWarehouses(ctx: Ctx) {
  assertCan(ctx, "users.manage");
  return ctx.db.query<{ id: string; code: string; name: string; active: boolean }>(
    `select id, code, name, active from wms.warehouses where company_id = $1 order by code`,
    [ctx.user.companyId],
  );
}

// -----------------------------------------------------------------------------
// Operações do administrador
// -----------------------------------------------------------------------------

interface LockedUser {
  id: string;
  email: string;
  role: Role;
  active: boolean;
  is_demo: boolean;
}

async function lockUser(tx: Queryable, ctx: Ctx, id: string): Promise<LockedUser> {
  const [u] = await tx.query<LockedUser>(
    `select id, email, role, active, is_demo from wms.users where id = $1 and company_id = $2 for update`,
    [id, ctx.user.companyId],
  );
  if (!u) throw new NotFoundError("Usuário");
  return u;
}

/** Bloqueia, sob lock, a remoção do último administrador ativo da empresa. */
async function assertKeepsAnAdmin(tx: Queryable, ctx: Ctx, target: LockedUser) {
  if (target.role !== "admin" || !target.active) return;
  const admins = await tx.query<{ id: string }>(
    `select id from wms.users where company_id = $1 and role = 'admin' and active for update`,
    [ctx.user.companyId],
  );
  if (admins.filter((a) => a.id !== target.id).length === 0) {
    throw new DomainError("Não é possível: este é o último administrador ativo da empresa.", "LAST_ADMIN");
  }
}

/** No modo demonstração, os usuários de demonstração (atalhos de login) ficam protegidos. */
function assertDemoUserEditable(target: { is_demo: boolean }, what: string) {
  if (isDemoMode() && target.is_demo) {
    throw new DomainError(
      `Modo demonstração: não é possível ${what} de um usuário de demonstração. Crie um novo usuário para testar esta função.`,
      "DEMO_PROTECTED",
    );
  }
}

const warehouseIdsField = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]).filter(Boolean))
  .pipe(z.array(z.string().uuid("Depósito inválido.")));

const roleField = z.enum(ROLES, { error: "Perfil inválido." });

const createSchema = z.object({
  name: z.string().trim().min(3, "Informe o nome (mínimo 3 caracteres).").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("E-mail inválido.")),
  role: roleField,
  password: passwordField("Senha inicial"),
  warehouseIds: warehouseIdsField,
});

async function writeWarehouses(tx: Queryable, ctx: Ctx, userId: string, warehouseIds: string[]) {
  const unique = [...new Set(warehouseIds)];
  if (unique.length) {
    const found = await tx.query<{ id: string }>(`select id from wms.warehouses where company_id = $1 and id = any($2::uuid[])`, [
      ctx.user.companyId,
      unique,
    ]);
    if (found.length !== unique.length) throw new NotFoundError("Depósito");
  }
  await tx.query(`delete from wms.user_warehouses where user_id = $1`, [userId]);
  for (const wh of unique) {
    await tx.query(`insert into wms.user_warehouses (user_id, warehouse_id, company_id, created_by) values ($1, $2, $3, $4)`, [
      userId,
      wh,
      ctx.user.companyId,
      ctx.user.id,
    ]);
  }
  return unique;
}

export async function createUser(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "users.manage");
  const d = parse(createSchema, input);
  const hash = await hashPassword(d.password);
  return runOperation(ctx, "user.create", opts, async (tx) => {
    const [dup] = await tx.query(`select 1 from wms.users where lower(email) = $1`, [d.email]);
    if (dup) throw new DomainError("Já existe um usuário com este e-mail.", "DUPLICATE", "email");
    const [u] = await tx.query<{ id: string }>(
      `insert into wms.users (company_id, name, email, role, password_hash, must_change_password)
       values ($1, $2, $3, $4, $5, true) returning id`,
      [ctx.user.companyId, d.name, d.email, d.role, hash],
    );
    const warehouses = await writeWarehouses(tx, ctx, u.id, d.warehouseIds);
    await audit(tx, ctx, "user.created", "user", u.id, d.email, { name: d.name, role: d.role, warehouses: warehouses.length || "todos" });
    return { id: u.id };
  });
}

const updateSchema = z.object({
  name: z.string().trim().min(3, "Informe o nome (mínimo 3 caracteres).").max(120),
  role: roleField,
});

export async function updateUser(ctx: Ctx, id: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "users.manage");
  const d = parse(updateSchema, input);
  return runOperation(ctx, "user.update", opts, async (tx) => {
    const u = await lockUser(tx, ctx, id);
    if (u.role !== d.role) {
      assertDemoUserEditable(u, "alterar o perfil");
      if (u.role === "admin") await assertKeepsAnAdmin(tx, ctx, u);
    }
    await tx.query(`update wms.users set name = $2, role = $3, updated_at = now() where id = $1`, [id, d.name, d.role]);
    await audit(tx, ctx, "user.updated", "user", id, u.email, { name: d.name, role: d.role, previousRole: u.role });
    return { id };
  });
}

export async function setUserActive(ctx: Ctx, id: string, active: boolean, opts?: OpOptions) {
  assertCan(ctx, "users.manage");
  return runOperation(ctx, active ? "user.activate" : "user.deactivate", opts, async (tx) => {
    const u = await lockUser(tx, ctx, id);
    if (u.active === active) throw new DomainError(active ? "O usuário já está ativo." : "O usuário já está inativo.", "INVALID_STATUS");
    if (!active) {
      if (id === ctx.user.id) throw new DomainError("Você não pode inativar o seu próprio usuário.", "SELF_DEACTIVATION");
      assertDemoUserEditable(u, "inativar");
      await assertKeepsAnAdmin(tx, ctx, u);
    }
    await tx.query(`update wms.users set active = $2, updated_at = now() where id = $1`, [id, active]);
    await audit(tx, ctx, active ? "user.activated" : "user.deactivated", "user", id, u.email);
    return { id };
  });
}

/**
 * Gera uma senha temporária (devolvida uma única vez, nunca armazenada em claro)
 * e obriga a troca no próximo acesso.
 */
export async function resetUserPassword(ctx: Ctx, id: string, opts?: OpOptions) {
  assertCan(ctx, "users.manage");
  const password = generateTemporaryPassword();
  const hash = await hashPassword(password);
  const result = await runOperation(ctx, "user.reset_password", opts, async (tx) => {
    const u = await lockUser(tx, ctx, id);
    assertDemoUserEditable(u, "redefinir a senha");
    if (!u.active) throw new DomainError("Ative o usuário antes de redefinir a senha.", "INVALID_STATUS");
    await tx.query(`update wms.users set password_hash = $2, must_change_password = true, updated_at = now() where id = $1`, [id, hash]);
    await audit(tx, ctx, "user.password_reset", "user", id, u.email);
    // O resultado fica na chave de idempotência: guarda só o id, nunca a senha.
    return { id };
  });
  return { ...result, temporaryPassword: password };
}

export async function setUserWarehouses(ctx: Ctx, id: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "users.manage");
  const d = parse(z.object({ warehouseIds: warehouseIdsField }), input ?? {});
  return runOperation(ctx, "user.warehouses", opts, async (tx) => {
    const u = await lockUser(tx, ctx, id);
    const before = await tx.query<{ warehouse_id: string }>(`select warehouse_id from wms.user_warehouses where user_id = $1`, [id]);
    const after = await writeWarehouses(tx, ctx, id, d.warehouseIds);
    const codes = after.length
      ? (await tx.query<{ code: string }>(`select code from wms.warehouses where id = any($1::uuid[]) order by code`, [after])).map((r) => r.code)
      : [];
    await audit(tx, ctx, "user.warehouses_updated", "user", id, u.email, {
      before: before.length,
      warehouses: codes.length ? codes : "todos",
    });
    return { id, warehouses: after.length };
  });
}

// -----------------------------------------------------------------------------
// Troca da própria senha
// -----------------------------------------------------------------------------

const changeSchema = z
  .object({
    currentPassword: z.string({ error: "Informe a senha atual." }).min(1, "Informe a senha atual."),
    newPassword: passwordField("Nova senha"),
    confirmPassword: z.string({ error: "Confirme a nova senha." }),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { message: "A confirmação não confere com a nova senha.", path: ["confirmPassword"] })
  .refine((d) => d.newPassword !== d.currentPassword, { message: "A nova senha deve ser diferente da atual.", path: ["newPassword"] });

export async function changeOwnPassword(ctx: Ctx, input: unknown) {
  const d = parse(changeSchema, input);
  const [row] = await ctx.db.query<{ password_hash: string | null; is_demo: boolean }>(
    `select password_hash, is_demo from wms.users where id = $1 and company_id = $2 and active`,
    [ctx.user.id, ctx.user.companyId],
  );
  if (!row) throw new NotFoundError("Usuário");
  assertDemoUserEditable(row, "trocar a senha");
  if (!(await verifyPassword(d.currentPassword, row.password_hash))) {
    throw new DomainError("Senha atual incorreta.", "INVALID_PASSWORD", "currentPassword");
  }
  const hash = await hashPassword(d.newPassword);
  return runOperation(ctx, "user.change_password", undefined, async (tx) => {
    await tx.query(
      `update wms.users set password_hash = $2, must_change_password = false, password_changed_at = now(), updated_at = now() where id = $1`,
      [ctx.user.id, hash],
    );
    await audit(tx, ctx, "user.password_changed", "user", ctx.user.id, ctx.user.email, { forced: Boolean(ctx.user.mustChangePassword) });
    return { id: ctx.user.id };
  });
}
