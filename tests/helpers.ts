import { createPgliteDb } from "@/server/db/drivers";
import { runMigrations } from "@/server/db/migrate";
import { seedDemo, DEMO_USERS } from "@/server/seed/demo";
import { loadSessionUser } from "@/server/auth/users";
import type { Ctx } from "@/server/context";
import type { Db } from "@/server/db/types";
import type { Role } from "@/lib/permissions";

export interface TestEnv {
  db: Db;
  as: (role: Role) => Ctx;
  id: (sql: string, params?: unknown[]) => Promise<string>;
  one: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T>;
  location: (code: string) => Promise<string>;
  product: (sku: string) => Promise<string>;
}

/** Banco PostgreSQL embarcado em memória com migrations reais + dados de demonstração. */
export async function createTestEnv(): Promise<TestEnv> {
  const db = await createPgliteDb();
  await runMigrations(db);
  await seedDemo(db);
  const ctxs = new Map<Role, Ctx>();
  for (const u of DEMO_USERS) {
    const [row] = await db.query<{ id: string }>(`select id from wms.users where email = $1`, [u.email]);
    ctxs.set(u.role, { db, user: (await loadSessionUser(db, row.id))! });
  }
  const one = async <T,>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params))[0];
  const id = async (sql: string, params: unknown[] = []) => (await one<{ id: string }>(sql, params)).id;
  return {
    db,
    as: (role) => ctxs.get(role)!,
    one,
    id,
    location: (code) => id(`select id from wms.locations where code = $1`, [code]),
    product: (sku) => id(`select id from erp.products where sku = $1`, [sku]),
  };
}

export async function balanceOf(env: TestEnv, sku: string) {
  return env.one<{ quantity: number; reserved: number; blocked: number }>(
    `select coalesce(sum(b.quantity), 0) as quantity, coalesce(sum(b.reserved_qty), 0) as reserved,
            coalesce(sum(b.blocked_qty), 0) as blocked
     from wms.stock_balances b join erp.products p on p.id = b.product_id where p.sku = $1`,
    [sku],
  );
}

export const key = () => crypto.randomUUID();
