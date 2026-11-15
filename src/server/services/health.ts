import "server-only";
import { readdir } from "node:fs/promises";
import packageJson from "../../../package.json";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import type { Db } from "../db/types";
import { MIGRATIONS_DIR } from "../db/migrate";
import { queueCounts } from "../integrations/outbox/processor";
import { transportFromEnv } from "../integrations/outbox/transports";
import { isAtlasConfigured } from "../integrations/atlas/connector";

export interface PublicHealth {
  status: "ok" | "degraded" | "error";
  version: string;
  time: string;
  database: { ok: boolean; latency_ms: number | null };
  migrations: { applied: number; available: number; pending: number } | null;
  queue: { pending: number; failed: number } | null;
}

export interface DetailedHealth extends PublicHealth {
  driver: Db["driver"] | null;
  pending_migrations: string[];
  last_migration: string | null;
  queue_detail: Record<string, number> | null;
  oldest_pending_at: string | null;
  transport: { ok: boolean; name: string; description: string };
  atlas_configured: boolean;
  cron_configured: boolean;
  node: string;
}

async function availableMigrations(): Promise<string[]> {
  try {
    return (await readdir(/*turbopackIgnore: true*/ MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.replace(/\.sql$/, ""))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Verificação de saúde. `db` nulo/erro de conexão → status "error".
 * Pendências de migration ou eventos que falharam → "degraded".
 */
/**
 * `companyId`: limita a fila (contagens e evento pendente mais antigo) a uma empresa.
 * Sem ele (rota pública /api/health), a fila é agregada de todas as empresas, sem dados de nenhuma.
 */
export async function collectHealth(getDb: () => Promise<Db>, companyId: string | null = null): Promise<DetailedHealth> {
  const time = new Date().toISOString();
  const config = transportFromEnv();
  const base = {
    version: packageJson.version,
    time,
    transport: config.ok
      ? { ok: true, name: config.transport.name, description: config.description }
      : { ok: false, name: config.name, description: config.error },
    atlas_configured: isAtlasConfigured(),
    cron_configured: Boolean(process.env.CRON_SECRET?.trim()),
    node: process.version,
  };
  let db: Db;
  const started = Date.now();
  try {
    db = await getDb();
    await db.query("select 1");
  } catch (error) {
    console.error("[health]", (error as Error)?.message);
    return {
      ...base,
      status: "error",
      database: { ok: false, latency_ms: null },
      migrations: null,
      queue: null,
      driver: null,
      pending_migrations: [],
      last_migration: null,
      queue_detail: null,
      oldest_pending_at: null,
    };
  }
  const latency = Date.now() - started;
  const [applied, available, counts, [oldest]] = await Promise.all([
    db.query<{ version: string }>(`select version from public.orion_schema_migrations order by version`).catch(() => []),
    availableMigrations(),
    queueCounts(db, companyId),
    db.query<{ at: string | null }>(
      `select min(created_at)::text as at from wms.integration_events where status = 'pending' and ($1::uuid is null or company_id = $1::uuid)`,
      [companyId],
    ),
  ]);
  const appliedSet = new Set(applied.map((a) => a.version));
  const pending = available.filter((v) => !appliedSet.has(v));
  const degraded = pending.length > 0 || counts.failed > 0 || !base.transport.ok;
  return {
    ...base,
    status: degraded ? "degraded" : "ok",
    database: { ok: true, latency_ms: latency },
    migrations: { applied: appliedSet.size, available: available.length, pending: pending.length },
    queue: { pending: counts.pending + counts.sending, failed: counts.failed },
    driver: db.driver,
    pending_migrations: pending,
    last_migration: applied.at(-1)?.version ?? null,
    queue_detail: counts,
    oldest_pending_at: oldest?.at ?? null,
  };
}

/** Versão pública (rota /api/health): sem nomes de host, driver, segredos ou dados de empresa. */
export function toPublicHealth(h: DetailedHealth): PublicHealth {
  return { status: h.status, version: h.version, time: h.time, database: h.database, migrations: h.migrations, queue: h.queue };
}

export async function getSystemHealth(ctx: Ctx): Promise<DetailedHealth> {
  assertCan(ctx, "system.health");
  // Tela do administrador da empresa: a fila mostrada é só a da própria empresa.
  return collectHealth(async () => ctx.db, ctx.user.companyId);
}
