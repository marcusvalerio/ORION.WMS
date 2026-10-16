import "server-only";
import { mkdir } from "node:fs/promises";
import type { Db, Queryable } from "./types";

const NUMERIC_OID = 1700;
const INT8_OID = 20;
const toNumber = (value: string) => Number(value);

/** PostgreSQL embarcado (WASM). Ideal para desenvolvimento, demonstração e testes. */
export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir && !dataDir.includes("://")) await mkdir(dataDir, { recursive: true });
  const pg = new PGlite({
    dataDir,
    parsers: { [NUMERIC_OID]: toNumber, [INT8_OID]: toNumber },
  });
  await pg.waitReady;

  const wrap = (exec: { query: typeof pg.query }): Queryable => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await exec.query<T>(sql, params);
      return result.rows;
    },
  });

  return {
    driver: "pglite",
    ...wrap(pg),
    // O PGlite possui uma única conexão e serializa transações internamente.
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
    exec: async (sql) => {
      await pg.exec(sql);
    },
    close: () => pg.close(),
  };
}

const RETRYABLE = new Set(["40001", "40P01"]); // serialization_failure, deadlock_detected

/** PostgreSQL/Supabase via DATABASE_URL (somente servidor). */
export async function createPostgresDb(connectionString: string): Promise<Db> {
  const { default: pgLib } = await import("pg");
  pgLib.types.setTypeParser(NUMERIC_OID, toNumber);
  pgLib.types.setTypeParser(INT8_OID, toNumber);
  const pool = new pgLib.Pool({ connectionString, max: 10 });

  return {
    driver: "postgres",
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    },
    async transaction(fn) {
      for (let attempt = 1; ; attempt++) {
        const client = await pool.connect();
        try {
          await client.query("begin");
          const value = await fn({
            async query<T>(sql: string, params: unknown[] = []) {
              const result = await client.query(sql, params);
              return result.rows as T[];
            },
          });
          await client.query("commit");
          return value;
        } catch (error) {
          await client.query("rollback").catch(() => undefined);
          const code = (error as { code?: string }).code;
          if (code && RETRYABLE.has(code) && attempt < 3) continue;
          throw error;
        } finally {
          client.release();
        }
      }
    },
    exec: async (sql) => {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}
