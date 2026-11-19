/**
 * Assistente "Montar armazém": monta várias áreas de uma vez, numa transação,
 * continuando a numeração das ruas do depósito e sem duplicar endereços.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, type TestEnv } from "./helpers";
import { buildLayout, createWarehouse, layoutStartAisle } from "@/server/services/warehouse";
import { newArea, planLayout } from "@/lib/layout-wizard";

describe("Montar armazém (assistente)", () => {
  let env: TestEnv;
  let whId: string;
  beforeAll(async () => {
    env = await createTestEnv();
    const r = await createWarehouse(env.as("admin"), { code: "CD-NOVO", name: "CD de teste do assistente" });
    whId = r.id;
  });

  it("o plano numera as ruas e conta os endereços", () => {
    const plan = planLayout([{ ...newArea("rack"), aisles: 2, bays: 3, levels: 2 }, newArea("receiving")], 5);
    expect(plan.errors).toEqual([]);
    expect(plan.aisles.map((a) => a.aisle)).toEqual(["05", "06", "REC"]);
    expect(plan.total).toBe(2 * 3 * 2 + 3);
  });

  it("acusa código repetido e limite de endereços", () => {
    const dup = planLayout([newArea("rack"), newArea("rack")]);
    expect(dup.errors.join(" ")).toMatch(/já foi usado/);
    const big = planLayout([{ ...newArea("rack"), aisles: 40, bays: 99, levels: 20 }]);
    expect(big.errors.join(" ")).toMatch(/limite/);
  });

  it("cria zonas e endereços de uma vez", async () => {
    const ctx = env.as("admin");
    const areas = [{ ...newArea("rack"), aisles: 2, bays: 3, levels: 2 }, { ...newArea("shelf"), aisles: 1, bays: 2, levels: 3 }, newArea("shipping")];
    const r = await buildLayout(ctx, { warehouseId: whId, areas: JSON.stringify(areas) });
    expect(r).toEqual({ zonesCreated: 3, created: 12 + 6 + 3, skipped: 0 });
    const codes = await env.db.query<{ code: string }>(
      `select code from wms.locations where warehouse_id = $1 order by code limit 2`,
      [whId],
    );
    expect(codes[0].code).toBe("CD-NOVO/RUA-01/MOD-01/NIV-01/POS-00");
    const docks = await env.db.query<{ n: number }>(
      `select count(*)::int as n from wms.locations where warehouse_id = $1 and location_type = 'dock' and aisle = 'EXP'`,
      [whId],
    );
    expect(docks[0].n).toBe(3);
  });

  it("montar de novo continua a numeração e reaproveita as zonas", async () => {
    const ctx = env.as("admin");
    expect(await layoutStartAisle(ctx, whId)).toBe(4);
    const r = await buildLayout(ctx, { warehouseId: whId, areas: JSON.stringify([{ ...newArea("rack"), aisles: 1, bays: 2, levels: 1 }, newArea("shipping")]) });
    // zona PP e EXP já existem; docas EXP já existem e ficam como estão
    expect(r).toEqual({ zonesCreated: 0, created: 2, skipped: 3 });
  });

  it("operador não monta armazém", async () => {
    await expect(buildLayout(env.as("operator"), { warehouseId: whId, areas: JSON.stringify([newArea("rack")]) })).rejects.toThrow();
  });
});
