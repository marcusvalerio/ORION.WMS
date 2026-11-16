/**
 * Driver PostgreSQL real (TEST_DATABASE_URL; sem ela o teste é pulado).
 *
 *   TEST_DATABASE_URL=postgres://usuario:senha@localhost:5432/banco npx vitest run tests/postgres-driver.test.ts
 *
 * Regressão: os parsers de numeric/int8 eram registrados só no `pg-types` global.
 * Com um driver compatível que usa sua própria cópia (ex.: Pool do @neondatabase/serverless)
 * as quantidades voltavam como string ("18.000") e a conferência de saída comparava
 * `18 !== "18.000"`, marcando divergência falsa.
 */
import pgLib from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createPostgresDb } from "@/server/db/drivers";

const PG_URL = process.env.TEST_DATABASE_URL?.trim();

describe.skipIf(!PG_URL)("driver PostgreSQL", () => {
  const NUMERIC = 1700;
  const INT8 = 20;
  const original = { numeric: pgLib.types.getTypeParser(NUMERIC), int8: pgLib.types.getTypeParser(INT8) };
  afterAll(() => {
    pgLib.types.setTypeParser(NUMERIC, original.numeric);
    pgLib.types.setTypeParser(INT8, original.int8);
  });

  it("devolve numeric e int8 como number mesmo sem depender do pg-types global", async () => {
    const db = await createPostgresDb(PG_URL!, { max: 2 });
    // simula o driver cuja cópia de pg-types não recebe o ajuste global
    pgLib.types.setTypeParser(NUMERIC, (v: string) => v);
    pgLib.types.setTypeParser(INT8, (v: string) => v);
    try {
      const [row] = await db.query<{ q: unknown; c: unknown }>(`select 18.000::numeric(14,3) as q, count(*) as c from generate_series(1, 3)`);
      expect(row).toEqual({ q: 18, c: 3 });
      const inTx = await db.transaction((tx) => tx.query<{ q: unknown }>(`select 2.5::numeric as q`));
      expect(inTx[0].q).toBe(2.5);
    } finally {
      await db.close();
    }
  });
});
