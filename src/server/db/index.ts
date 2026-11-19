import "server-only";
import os from "node:os";
import path from "node:path";
import { isDemoMode } from "../demo-mode";
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
    : await createPgliteDb(process.env.PGLITE_DATA_DIR ?? defaultPgliteDir());
  await runMigrations(db);
  // Demonstração sem banco real: ids iguais em todas as instâncias (ver demo-ids.ts).
  if (!url && isDemoMode()) {
    const { applyDeterministicDemoIds } = await import("./demo-ids");
    await applyDeterministicDemoIds(db);
  }
  if (process.env.WMS_AUTO_SEED !== "false") {
    const { seedDemoIfEmpty } = await import("../seed/demo");
    const seeded = await seedDemoIfEmpty(db);
    // banco de demonstração anterior à vitrine do inventário: completa (idempotente)
    if (!seeded && isDemoMode()) {
      const { seedInventoryShowcase } = await import("../seed/showcase");
      await seedInventoryShowcase(db);
    }
  }
  return db;
}

/** Em demonstração/Vercel o diretório do projeto é só leitura: usa o temporário do sistema. */
function defaultPgliteDir(): string {
  if (isDemoMode() || process.env.VERCEL) return path.join(os.tmpdir(), "orion-pglite");
  return path.join(process.cwd(), ".data", "pglite");
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
