import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./types";

// As migrations são incluídas no bundle de produção via outputFileTracingIncludes (next.config.ts).
export const MIGRATIONS_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "supabase", "migrations");

/**
 * Aplica as migrations versionadas de supabase/migrations em ordem, registrando-as
 * em public.orion_schema_migrations. Em projetos Supabase, prefira `supabase db push`
 * (as mesmas migrations são compatíveis).
 */
export async function runMigrations(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.exec(`create table if not exists public.orion_schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  )`);
  const applied = new Set(
    (await db.query<{ version: string }>("select version from public.orion_schema_migrations")).map((r) => r.version),
  );
  const files = (await readdir(/*turbopackIgnore: true*/ dir)).filter((f) => f.endsWith(".sql")).sort();
  const executed: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;
    const sql = await readFile(path.join(/*turbopackIgnore: true*/ dir, file), "utf8");
    await db.exec(`begin;\n${sql}\n;insert into public.orion_schema_migrations(version) values ('${version}');\ncommit;`);
    executed.push(version);
  }
  return executed;
}
