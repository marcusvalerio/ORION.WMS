import "server-only";
import path from "node:path";
import { createPgliteDb, createPostgresDb } from "./drivers";
import { runMigrations } from "./migrate";
import type { Db } from "./types";

export type { Db, Queryable, Row } from "./types";

type GlobalWithDb = typeof globalThis & { __orionDb?: Promise<Db> };
const g = globalThis as GlobalWithDb;

async function init(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  const db = url
    ? await createPostgresDb(url)
    : await createPgliteDb(process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite"));
  await runMigrations(db);
  if (process.env.WMS_AUTO_SEED !== "false") {
    const { seedDemoIfEmpty } = await import("../seed/demo");
    await seedDemoIfEmpty(db);
  }
  return db;
}

/** Conexão única por processo (sobrevive ao hot reload em desenvolvimento). */
export function getDb(): Promise<Db> {
  if (!g.__orionDb) {
    g.__orionDb = init().catch((error) => {
      g.__orionDb = undefined;
      throw error;
    });
  }
  return g.__orionDb;
}
