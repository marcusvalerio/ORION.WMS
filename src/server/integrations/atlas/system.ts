import "server-only";
import type { Db, Queryable } from "../../db/types";
import type { Ctx } from "../../context";

let seq = 0;

/**
 * Db "aninhado" sobre uma transação aberta: `transaction(fn)` vira SAVEPOINT.
 * Permite chamar os serviços reais (que abrem a própria transação via
 * runOperation) dentro da transação que grava o evento na atlas_inbox — efeito e
 * registro do evento são confirmados ou desfeitos juntos.
 */
export function savepointDb(tx: Queryable, driver: Db["driver"] = "postgres"): Db {
  return {
    driver,
    query: (sql, params) => tx.query(sql, params),
    async exec(sql) {
      await tx.query(sql);
    },
    async close() {},
    async transaction(fn) {
      const name = `atlas_sp_${++seq}`;
      await tx.query(`savepoint ${name}`);
      try {
        const result = await fn(tx);
        await tx.query(`release savepoint ${name}`);
        return result;
      } catch (error) {
        await tx.query(`rollback to savepoint ${name}`);
        throw error;
      }
    },
  };
}

export const SYSTEM_USER_EMAIL = "integracao-atlas@sistema.orion.invalid";

/** Usuário técnico da empresa (inativo, sem senha): autor das operações aplicadas a partir de eventos do ATLAS. */
export async function ensureSystemUser(tx: Queryable, companyId: string): Promise<string> {
  const [existing] = await tx.query<{ id: string }>(
    `select id from wms.users where company_id = $1 and is_system order by created_at limit 1`,
    [companyId],
  );
  if (existing) return existing.id;
  const [row] = await tx.query<{ id: string }>(
    `insert into wms.users (company_id, name, email, role, password_hash, active, is_system)
     values ($1, 'Integração ATLAS', $2, 'admin', null, false, true) returning id`,
    [companyId, SYSTEM_USER_EMAIL],
  );
  return row.id;
}

/** Contexto de sistema para aplicar um evento do ATLAS com os serviços reais. */
export async function systemCtx(tx: Queryable, companyId: string, driver: Db["driver"] = "postgres"): Promise<Ctx> {
  const userId = await ensureSystemUser(tx, companyId);
  const [c] = await tx.query<{ name: string; is_demo: boolean }>(`select name, is_demo from erp.companies where id = $1`, [companyId]);
  return {
    db: savepointDb(tx, driver),
    user: {
      id: userId,
      companyId,
      companyName: c?.name ?? "",
      companyIsDemo: c?.is_demo ?? false,
      name: "Integração ATLAS",
      email: SYSTEM_USER_EMAIL,
      role: "admin",
      warehouseIds: null,
      isSystem: true,
    },
  };
}
