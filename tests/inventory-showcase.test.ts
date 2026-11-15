import { describe, expect, it } from "vitest";
import { createTestEnv } from "./helpers";
import { seedInventoryShowcase } from "@/server/seed/showcase";
import { getInventoryKpis, getInventoryMap } from "@/server/services/inventory";
import { getKpis } from "@/server/services/dashboard";

describe("vitrine do inventário (seed de demonstração)", () => {
  it("monta o CD-02 com ciclos aprovados e um inventário em contagem", async () => {
    const env = await createTestEnv();
    await seedInventoryShowcase(env.db);
    const inv = await env.one<{ id: string }>(`select id from wms.inventory_counts where status = 'counting' and notes like 'Inventário geral%'`);
    const map = await getInventoryMap(env.as("supervisor"), inv.id);
    expect(map!.cells.length).toBe(144);
    expect(map!.counts.counted + map!.counts.divergent).toBeGreaterThan(50);
    const kpis = await getInventoryKpis(env.as("supervisor"), inv.id);
    expect(kpis!.cycles.length).toBe(6);
    expect(kpis!.cycles.filter((c) => !c.current).every((c) => c.accuracy! > 90)).toBe(true);
    expect(kpis!.accuracy).toBeGreaterThan(90);
    expect(kpis!.deltaPp).not.toBeNull();
    expect(kpis!.value!.shortage).toBeGreaterThan(0);
    expect(kpis!.pace.perHour).toBeGreaterThan(0);
    // ocupação real a partir do saldo
    expect(map!.cells.some((c) => c.occupancy > 0.8)).toBe(true);
    expect(map!.cells.some((c) => c.lastCountedAt !== null && c.situation === "pending")).toBe(true);

    // operador: contagem cega — sem esperado, diferença, saldo nem acuracidade do inventário em curso
    const blindMap = await getInventoryMap(env.as("operator"), inv.id);
    expect(blindMap!.blind).toBe(true);
    expect(blindMap!.cells.every((c) => c.onHand === null && c.items.every((i) => i.expected === null && i.diff === null))).toBe(true);
    const blindKpis = await getInventoryKpis(env.as("operator"), inv.id);
    expect([blindKpis!.accuracy, blindKpis!.divergences, blindKpis!.value]).toEqual([null, null, null]);

    // a vitrine é idempotente
    await seedInventoryShowcase(env.db);
    expect((await env.one<{ n: number }>(`select count(*)::int as n from wms.warehouses where code = 'CD-02'`)).n).toBe(1);
  }, 120_000);

  it("KPIs do dashboard têm série de 14 dias terminando hoje", async () => {
    const env = await createTestEnv();
    const kpis = await getKpis(env.as("admin"));
    const withSeries = kpis.filter((k) => k.series);
    expect(withSeries.length).toBeGreaterThanOrEqual(4);
    for (const k of withSeries) expect(k.series).toHaveLength(14);
    const putaway = kpis.find((k) => k.key === "putaway")?.series ?? kpis.find((k) => k.seriesLabel?.includes("armazenadas"))!.series!;
    expect(putaway.at(-1)!.day).toBe(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()));
  }, 120_000);
});
