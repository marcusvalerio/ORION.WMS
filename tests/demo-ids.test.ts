/**
 * Demonstração na Vercel: cada instância do servidor cria o próprio banco
 * temporário. Os ids precisam sair iguais em todas, senão a lista (instância A)
 * aponta para um id que o detalhe (instância B) não conhece e dá 404.
 */
import { describe, expect, it } from "vitest";
import { createPgliteDb } from "@/server/db/drivers";
import { runMigrations } from "@/server/db/migrate";
import { applyDeterministicDemoIds } from "@/server/db/demo-ids";
import { seedDemoIfEmpty } from "@/server/seed/demo";

async function instance() {
  const db = await createPgliteDb();
  await runMigrations(db);
  await applyDeterministicDemoIds(db);
  await seedDemoIfEmpty(db);
  const ids = async (table: string) =>
    (await db.query<{ id: string }>(`select id from ${table} order by code`)).map((r) => r.id);
  return {
    inventarios: await ids("wms.inventory_counts"),
    recebimentos: await ids("wms.receipts"),
    tarefas: await ids("wms.tasks"),
  };
}

describe("ids do banco de demonstração", () => {
  it("duas instâncias novas geram os mesmos ids", async () => {
    const a = await instance();
    const b = await instance();
    expect(a.inventarios.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  }, 240_000);
});
