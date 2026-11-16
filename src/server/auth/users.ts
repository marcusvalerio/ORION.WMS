import "server-only";
import type { Queryable } from "../db/types";
import type { SessionUser } from "../context";
import { verifyPassword } from "./password";

export async function loadSessionUser(db: Queryable, userId: string): Promise<SessionUser | null> {
  const [u] = await db.query<SessionUser>(
    `select u.id, u.company_id as "companyId", c.name as "companyName", c.is_demo as "companyIsDemo", u.name, u.email, u.role,
            u.must_change_password as "mustChangePassword", u.atlas_user_id as "atlasUserId",
            (select json_agg(uw.warehouse_id order by uw.warehouse_id) from wms.user_warehouses uw where uw.user_id = u.id) as "warehouseIds"
     from wms.users u join erp.companies c on c.id = u.company_id where u.id = $1 and u.active`,
    [userId],
  );
  return u ?? null;
}

const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export class AmbiguousLoginError extends Error {
  constructor() {
    super("Este e-mail existe em mais de uma empresa. Informe o CNPJ da empresa.");
    this.name = "AmbiguousLoginError";
  }
}

/**
 * Login local por e-mail e senha. O e-mail é único POR EMPRESA: quando a mesma
 * senha confere em mais de uma empresa, exige o CNPJ (`companyDocument`) para
 * desambiguar. Usuários vinculados ao ATLAS (atlas_user_id) não têm senha local
 * e entram só por SSO; o usuário técnico de integração nunca entra.
 */
export async function authenticate(db: Queryable, email: string, password: string, companyDocument?: string | null): Promise<SessionUser | null> {
  const doc = (companyDocument ?? "").replace(/\D/g, "") || null;
  const rows = await db.query<{ id: string; password_hash: string | null }>(
    `select u.id, u.password_hash from wms.users u join erp.companies c on c.id = u.company_id
     where lower(u.email) = lower($1) and u.active and u.atlas_user_id is null and not u.is_system
       and ($2::text is null or c.document = $2) order by u.created_at`,
    [email.trim(), doc],
  );
  // Verifica mesmo quando o usuário não existe, para não revelar quais e-mails são válidos pelo tempo de resposta.
  if (!rows.length) {
    await verifyPassword(password, DUMMY_HASH);
    return null;
  }
  const matches: string[] = [];
  for (const row of rows) if (await verifyPassword(password, row.password_hash ?? DUMMY_HASH)) matches.push(row.id);
  if (matches.length > 1) throw new AmbiguousLoginError();
  if (matches.length === 0) return null;
  return loadSessionUser(db, matches[0]);
}

export async function listDemoUsers(db: Queryable) {
  return db.query<{ email: string; name: string; role: string }>(
    `select email, name, role from wms.users where is_demo and active
     order by array_position(array['admin','supervisor','operator','auditor'], role)`,
  );
}

/** Administradora da empresa de demonstração (só usuários `is_demo`). */
export async function loadDemoAdmin(db: Queryable): Promise<SessionUser | null> {
  const [row] = await db.query<{ id: string }>(
    `select u.id from wms.users u join erp.companies c on c.id = u.company_id
     where u.is_demo and c.is_demo and u.active and u.role = 'admin' order by u.created_at limit 1`,
  );
  return row ? loadSessionUser(db, row.id) : null;
}
