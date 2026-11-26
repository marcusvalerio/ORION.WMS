import { describe, expect, it } from "vitest";
import {
  buildCdMap,
  lastCountBucket,
  nextToCount,
  occupancyBucket,
  occupancyOf,
  routeOrder,
  walkRoute,
  type MapItemInput,
  type MapLocationInput,
} from "@/lib/cd-map";
import { accuracyOf, computeInventoryKpis, type CycleInput, type KpiItemInput } from "@/lib/inventory-kpis";
import { dailySeries, litCount, niceMax, scale, splitBar, ticks, blockLayout, GAP } from "@/lib/charts";
import { cycleScale } from "@/components/inventory/inventory-kpi-panel";

const loc = (id: string, zone: string, aisle: string, bay: string, level: string, extra: Partial<MapLocationInput> = {}): MapLocationInput => ({
  id,
  code: `${zone}-${aisle}-${bay}-${level}`,
  zone_id: `z-${zone}`,
  zone_code: zone,
  zone_name: `Zona ${zone}`,
  zone_type: "storage",
  aisle,
  bay,
  level,
  position: "00",
  location_type: "rack",
  status: "active",
  capacity_units: 100,
  on_hand_units: 0,
  ...extra,
});
const item = (id: string, location_id: string, expected: number, counted: number | null, extra: Partial<MapItemInput> = {}): MapItemInput => ({
  id,
  location_id,
  sku: "SKU-1",
  description: "Produto",
  uom: "UN",
  lot_code: "",
  expiry_date: null,
  expected_qty: expected,
  counted_qty: counted,
  counted_by_name: counted === null ? null : "Op",
  counted_at: counted === null ? null : 1_000,
  notes: null,
  adjusted: false,
  ...extra,
});

const locations = [
  loc("a1", "A", "01", "1", "1", { on_hand_units: 40 }),
  loc("a2", "A", "01", "1", "2", { on_hand_units: 100 }),
  loc("a3", "A", "01", "2", "1"),
  loc("a4", "A", "01", "10", "1", { on_hand_units: 10 }),
  loc("b1", "A", "02", "1", "1", { on_hand_units: 5 }),
  loc("c1", "B", "01", "1", "1", { on_hand_units: 20 }),
];
const items = [item("i1", "a1", 40, 40), item("i2", "a2", 100, 97), item("i3", "a4", 10, null), item("i4", "b1", 5, null), item("i5", "c1", 20, 20)];

describe("mapa do CD — montagem do layout", () => {
  it("agrupa zona → rua → módulo (ordem natural) → nível", () => {
    const m = buildCdMap({ locations, items, blind: false });
    expect(m.zones.map((z) => z.code)).toEqual(["A", "B"]);
    expect(m.aisles.map((a) => `${a.zoneCode}:${a.aisle}`)).toEqual(["A:01", "A:02", "B:01"]);
    expect(m.aisles[0].bays).toEqual(["1", "2", "10"]); // "2" antes de "10"
    const a4 = m.cells.find((c) => c.id === "a4")!;
    expect(a4.x).toBe(2);
    const a2 = m.cells.find((c) => c.id === "a2")!;
    expect([a2.z, a2.y]).toEqual([1, 0]);
    // rua seguinte 3 unidades depois (rack + corredor com o dobro da profundidade); zona seguinte com 1 unidade extra
    expect(m.cells.find((c) => c.id === "b1")!.y).toBe(3);
    expect(m.cells.find((c) => c.id === "c1")!.y).toBe(7);
    expect(m.width).toBe(3);
  });

  it("classifica a situação da contagem", () => {
    const m = buildCdMap({ locations, items, blind: false });
    const sit = Object.fromEntries(m.cells.map((c) => [c.id, c.situation]));
    expect(sit).toMatchObject({ a1: "counted", a2: "divergent", a3: "outside", a4: "pending", c1: "counted" });
    expect(m.counts).toMatchObject({ counted: 2, divergent: 1, pending: 2, outside: 1 });
    // devolvido para recontagem depois da contagem com diferença
    const r = buildCdMap({ locations, items, blind: false, rejectedAt: 2_000 });
    expect(r.cells.find((c) => c.id === "a2")!.situation).toBe("recount");
  });

  it("contagem cega não expõe esperado, diferença nem saldo", () => {
    const m = buildCdMap({ locations, items, blind: true });
    const json = JSON.stringify(m);
    for (const c of m.cells) {
      expect(c.onHand).toBeNull();
      for (const i of c.items) {
        expect(i.expected).toBeNull();
        expect(i.diff).toBeNull();
      }
    }
    expect(json).not.toContain("expected_qty");
    expect(m.cells.find((c) => c.id === "a2")!.situation).toBe("counted"); // sem "divergência" na cega
    // ocupação só arredondada a 5%
    const odd = buildCdMap({ locations: [loc("x", "A", "01", "1", "1", { on_hand_units: 37 })], items: [], blind: true });
    expect(odd.cells[0].occupancy).toBe(0.35);
  });

  it("ocupação: unidades ÷ capacidade, ou peso ÷ peso máximo quando maior; limitada a 100%", () => {
    expect(occupancyOf({ units: 30, capacity: 120 })).toEqual({ value: 0.25, basis: "units" });
    expect(occupancyOf({ units: 30, capacity: 120, kg: 600, maxKg: 1000 })).toEqual({ value: 0.6, basis: "weight" });
    expect(occupancyOf({ units: 300, capacity: 120 }).value).toBe(1);
    expect(occupancyOf({ units: 0, capacity: 120 })).toEqual({ value: 0, basis: "empty" });
    expect(occupancyOf({ units: 5, capacity: null }).value).toBe(0);
    const m = buildCdMap({ locations, items, blind: false });
    expect(m.cells.find((c) => c.id === "a1")!.occupancy).toBe(0.4);
    expect(occupancyBucket(0)).toBe(0);
    expect(occupancyBucket(0.95)).toBe(4);
  });

  it("rota: serpentina por rua, próximo pendente e caminho pelos corredores", () => {
    const m = buildCdMap({ locations, items, blind: false });
    expect(routeOrder(m).map((c) => c.id)).toEqual(["a1", "a2", "a4", "b1", "c1"]);
    expect(nextToCount(m, "a2")!.id).toBe("a4");
    expect(nextToCount(m, "b1")!.id).toBe("a4"); // volta ao início quando não há pendente adiante
    const w = walkRoute(m.cells.find((c) => c.id === "a1")!, m.cells.find((c) => c.id === "b1")!);
    expect(w.points[0]).toEqual([0.5, 2]);
    expect(w.points.at(-1)).toEqual([0.5, 4.05]);
    expect(w.meters).toBeGreaterThan(0);
  });

  it("idade da última contagem em faixas", () => {
    const day = 86_400_000;
    expect(lastCountBucket(null, 0)).toBe(3);
    expect(lastCountBucket(0, 10 * day)).toBe(0);
    expect(lastCountBucket(0, 60 * day)).toBe(1);
    expect(lastCountBucket(0, 120 * day)).toBe(2);
  });
});

describe("KPIs de acuracidade do inventário", () => {
  const kItems: KpiItemInput[] = [
    { location_id: "l1", zone_code: "A", zone_name: "A", expected_qty: 10, counted_qty: 10, counted_at: 0, unit_price: 5 },
    { location_id: "l1", zone_code: "A", zone_name: "A", expected_qty: 4, counted_qty: 6, counted_at: 1_800_000, unit_price: 5 },
    { location_id: "l2", zone_code: "B", zone_name: "B", expected_qty: 3, counted_qty: 0, counted_at: 3_600_000, unit_price: 10 },
    { location_id: "l3", zone_code: "B", zone_name: "B", expected_qty: 8, counted_qty: 8, counted_at: 3_600_000, unit_price: null },
    { location_id: "l4", zone_code: "B", zone_name: "B", expected_qty: 8, counted_qty: null, counted_at: null, unit_price: 1 },
  ];
  const history: CycleInput[] = [
    { id: "c1", code: "INV-1", closed_at: Date.UTC(2026, 6, 15), items: 100, accurate: 95, divergences: 5 },
    { id: "c2", code: "INV-2", closed_at: Date.UTC(2026, 7, 15), items: 50, accurate: 49, divergences: 1 },
  ];

  it("calcula acuracidade, pp vs ciclo anterior, endereços, divergências, valor, ritmo e zonas", () => {
    const k = computeInventoryKpis({ status: "counting", blind: false, items: kItems, history, currentId: "cur", now: 3_600_000 });
    expect(k.accuracy).toBe(50); // 2 de 4 contados sem diferença
    expect(k.previousAccuracy).toBe(98);
    expect(k.deltaPp).toBe(-48);
    expect(k.items).toEqual({ counted: 4, total: 5 });
    expect(k.locations).toEqual({ counted: 3, total: 4 });
    expect(k.divergences).toBe(2);
    expect(k.previousDivergences).toBe(1);
    expect(k.value).toEqual({ net: 10 - 30, surplus: 10, shortage: 30, unpriced: 0 });
    expect(k.pace.perHour).toBe(3); // 3 endereços em 1 h
    expect(k.pace.eta).toBe(3_600_000 + 1_200_000);
    expect(k.cycles.map((c) => c.label)).toEqual(["jul", "ago", "atual"]);
    expect(k.zones).toEqual([
      { code: "A", name: "A", accuracy: 50, counted: 2, total: 2 },
      { code: "B", name: "B", accuracy: 50, counted: 2, total: 3 },
    ]);
  });

  it("inventário aprovado usa o próprio ciclo e o anterior; cega oculta acuracidade e valor", () => {
    const k = computeInventoryKpis({ status: "approved", blind: false, items: kItems, history, currentId: "c2" });
    expect(k.previousAccuracy).toBe(95);
    expect(k.cycles.map((c) => [c.code, c.current])).toEqual([
      ["INV-1", false],
      ["INV-2", true],
    ]);
    const b = computeInventoryKpis({ status: "counting", blind: true, items: kItems, history, currentId: "cur" });
    expect([b.accuracy, b.divergences, b.value, b.deltaPp]).toEqual([null, null, null, null]);
    expect(b.zones.every((z) => z.accuracy === null)).toBe(true);
    expect(b.cycles).toHaveLength(2); // ciclos fechados continuam visíveis
    expect(accuracyOf(0, 0)).toBeNull();
  });

  it("mantém só os 6 últimos ciclos", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `h${i}`, code: `H${i}`, closed_at: Date.UTC(2026, i, 10), items: 10, accurate: 9, divergences: 1 }));
    const k = computeInventoryKpis({ status: "counting", blind: false, items: kItems, history: many, currentId: "cur" });
    expect(k.cycles).toHaveLength(6);
    expect(k.cycles.at(-1)!.current).toBe(true);
  });
});

describe("escala dos gráficos no traço do símbolo", () => {
  it("niceMax/ticks/scale", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(180)).toBe(200);
    expect(niceMax(230)).toBe(250);
    expect(niceMax(0.3)).toBe(0.5);
    expect(ticks(37)).toEqual([0, 25, 50]);
    expect(scale(50, 100, 200)).toBe(100);
    expect(scale(500, 100, 200)).toBe(200);
    expect(scale(-1, 100, 200)).toBe(0);
  });

  it("barras partidas por vão de 4px e blocos", () => {
    const parts = splitBar(100, 0);
    expect(parts).toHaveLength(2);
    expect(parts[1][0] - parts[0][1]).toBe(GAP);
    expect(splitBar(8, 0)).toEqual([[0, 8]]);
    expect(splitBar(0, 0)).toEqual([]);
    expect(litCount(0, 14)).toBe(0);
    expect(litCount(1, 14)).toBe(1);
    expect(litCount(50, 14)).toBe(7);
    expect(litCount(150, 14)).toBe(14);
    const b = blockLayout(12, 240);
    const last = b.at(-1)!;
    expect(last.x + last.w).toBeCloseTo(240, 6);
    expect(cycleScale([95.1, 98.4], 99)).toEqual({ floor: 90, ceil: 100 });
  });

  it("série diária de 14 dias preenche dias sem registro e ignora fora da janela", () => {
    const s = dailySeries(
      [
        { day: "2026-11-15", n: "3" },
        { day: "2026-11-10", n: 2 },
        { day: "2026-10-01", n: 99 },
      ],
      14,
      "2026-11-15",
    );
    expect(s).toHaveLength(14);
    expect(s[0].day).toBe("2026-11-02");
    expect(s.at(-1)).toEqual({ day: "2026-11-15", value: 3 });
    expect(s.find((d) => d.day === "2026-11-10")!.value).toBe(2);
    expect(s.reduce((a, d) => a + d.value, 0)).toBe(5);
  });
});
