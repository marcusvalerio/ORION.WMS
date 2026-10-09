import "server-only";
import type { Queryable } from "../db/types";
import type { SessionUser } from "../context";
import { verifyPassword } from "./password";

export async function loadSessionUser(db: Queryable, userId: string): Promise<SessionUser | null> {
  const [u] = await db.query<SessionUser>(
    `select u.id, u.company_id as "companyId", c.name as "companyName", c.is_demo as "companyIsDemo", u.name, u.email, u.role
     from wms.users u join erp.companies c on c.id = u.company_id where u.id = $1 and u.active`,
    [userId],
  );
  return u ?? null;
}

export async function authenticate(db: Queryable, email: string, password: string): Promise<SessionUser | null> {
  const [row] = await db.query<{ id: string; password_hash: string | null }>(
    `select id, password_hash from wms.users where lower(email) = lower($1) and active`,
    [email.trim()],
  );
  // Verifica mesmo quando o usuário não existe, para não revelar quais e-mails são válidos pelo tempo de resposta.
  const ok = await verifyPassword(password, row?.password_hash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  if (!row || !ok) return null;
  return loadSessionUser(db, row.id);
}

export async function listDemoUsers(db: Queryable) {
  return db.query<{ email: string; name: string; role: string }>(
    `select email, name, role from wms.users where is_demo and active
     order by array_position(array['admin','supervisor','operator','auditor'], role)`,
  );
}
