/**
 * Utilitário de banco: npm run db:migrate | db:seed | db:reset
 *  - migrate: aplica as migrations de supabase/migrations
 *  - seed:    carrega os dados de demonstração se o banco estiver vazio
 *  - reset:   (somente PGlite local) apaga .data/pglite e recria tudo
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { createPgliteDb, createPostgresDb } from "../src/server/db/drivers";
import { runMigrations } from "../src/server/db/migrate";
import { seedDemoIfEmpty } from "../src/server/seed/demo";

async function main() {
  const cmd = process.argv[2];
  const url = process.env.DATABASE_URL;
  const dataDir = process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (cmd === "reset") {
    if (url) throw new Error("db:reset só é permitido no banco local (PGlite). Não há reset para DATABASE_URL.");
    await rm(dataDir, { recursive: true, force: true });
    console.log(`Banco local removido: ${dataDir}`);
  }
  const db = url ? await createPostgresDb(url) : await createPgliteDb(dataDir);
  const applied = await runMigrations(db);
  console.log(applied.length ? `Migrations aplicadas: ${applied.join(", ")}` : "Nenhuma migration pendente.");
  if (cmd === "seed" || cmd === "reset") {
    console.log((await seedDemoIfEmpty(db)) ? "Dados de demonstração carregados." : "Banco já possui dados; seed ignorado.");
  }
  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
