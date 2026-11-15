/**
 * Layout do mapa do CD usado na tela de contagem do inventário.
 *
 * O cadastro de endereços não tem coordenadas físicas (só zona, rua, módulo, nível e posição),
 * então a disposição é DETERMINÍSTICA a partir dos códigos:
 *  - zonas são empilhadas em profundidade (eixo y), na ordem do código da zona;
 *  - cada rua da zona vira uma linha de porta-paletes com profundidade 1, seguida de um
 *    corredor de largura 1 (a próxima rua começa 2 unidades depois); entre zonas há 1 unidade extra;
 *  - os módulos (bay) da rua ficam lado a lado no eixo x, em ordem natural ("2" < "10");
 *  - os níveis viram a altura (eixo z), em ordem natural dentro da rua (o mais baixo = 0);
 *  - várias posições no mesmo módulo/nível dividem a largura do módulo em partes iguais.
 * Sem React: é calculado no servidor (service de inventário) e testado isoladamente.
 */

export type Situation = "pending" | "counted" | "divergent" | "recount" | "outside";

export const SITUATION_LABELS: Record<Situation, string> = {
  pending: "A contar",
  counted: "Contado",
  divergent: "Com divergência",
  recount: "Recontagem",
  outside: "Fora do inventário",
};

export interface MapLocationInput {
  id: string;
  code: string;
  zone_id: string;
  zone_code: string;
  zone_name: string;
  zone_type: string;
  aisle: string;
  bay: string;
  level: string;
  position: string;
  location_type: string;
  status: string;
  /** capacidade cadastrada do endereço (unidades) */
  capacity_units?: number | string | null;
  /** peso máximo do endereço (kg), quando cadastrado */
  max_weight_kg?: number | string | null;
  /** saldo físico atual no endereço (unidades) */
  on_hand_units?: number | string | null;
  /** peso do saldo atual (kg) = Σ quantidade × peso do produto */
  on_hand_kg?: number | string | null;
  /** última contagem do endereço em inventário (ms epoch), qualquer inventário */
  last_counted_at?: number | string | null;
}

export interface MapItemInput {
  id: string;
  location_id: string;
  sku: string;
  barcode?: string | null;
  description: string;
  uom: string;
  lot_code: string;
  expiry_date: string | null;
  expected_qty: number;
  counted_qty: number | null;
  counted_by_name: string | null;
  /** momento da contagem em ms (epoch) */
  counted_at: number | null;
  notes: string | null;
  adjusted: boolean;
}

export interface MapItem {
  id: string;
  sku: string;
  barcode: string | null;
  description: string;
  uom: string;
  lot: string;
  expiry: string | null;
  /** null em contagem cega. */
  expected: number | null;
  counted: number | null;
  countedBy: string | null;
  /** momento da contagem (ms epoch) */
  countedAt: number | null;
  /** null quando não contado ou em contagem cega. */
  diff: number | null;
  notes: string | null;
  adjusted: boolean;
  recount: boolean;
}

export interface MapCell {
  id: string;
  code: string;
  zoneId: string;
  zoneCode: string;
  zoneName: string;
  aisle: string;
  bay: string;
  level: string;
  position: string;
  locationType: string;
  blocked: boolean;
  /** coordenadas no grid: x = módulo (com fração da posição), y = linha da rua, z = índice do nível */
  x: number;
  w: number;
  y: number;
  z: number;
  situation: Situation;
  /** ocupação 0–1 (ver `occupancyOf`); em contagem cega é arredondada a 5% */
  occupancy: number;
  /** base usada na ocupação */
  occupancyBasis: "weight" | "units" | "empty";
  /** capacidade do endereço (unidades) */
  capacity: number | null;
  /** saldo atual em unidades — null em contagem cega */
  onHand: number | null;
  /** última contagem (ms epoch) ou null se nunca contado */
  lastCountedAt: number | null;
  items: MapItem[];
}

export interface MapAisle {
  key: string;
  zoneId: string;
  zoneCode: string;
  aisle: string;
  y: number;
  bays: string[];
  levels: string[];
}

export interface MapZone {
  id: string;
  code: string;
  name: string;
  type: string;
  y0: number;
  y1: number;
  width: number;
}

export interface CdMap {
  blind: boolean;
  zones: MapZone[];
  aisles: MapAisle[];
  cells: MapCell[];
  levels: string[];
  width: number;
  depth: number;
  counts: Record<Situation, number>;
  /** momento em que o mapa foi montado (ms) — referência para "última contagem" */
  generatedAt: number;
}

const natural = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true });
const RACK_DEPTH = 1;
const CORRIDOR = 1;
const ZONE_GAP = 1;

function situationOf(items: MapItem[], blind: boolean): Situation {
  if (!items.length) return "outside";
  if (items.some((i) => i.recount)) return "recount";
  if (!blind && items.some((i) => i.diff !== null && i.diff !== 0)) return "divergent";
  if (items.some((i) => i.counted === null)) return "pending";
  return "counted";
}

/**
 * Monta o mapa. `blind` remove o saldo esperado e a diferença dos itens (e não marca
 * divergência). `rejectedAt` é a última devolução para recontagem: itens contados antes
 * dela com diferença ficam em "recontagem" até serem contados de novo.
 */
export function buildCdMap({
  locations,
  items,
  blind,
  rejectedAt = null,
  now = Date.now(),
}: {
  now?: number;
  locations: MapLocationInput[];
  items: MapItemInput[];
  blind: boolean;
  rejectedAt?: number | null;
}): CdMap {
  const rejected = rejectedAt === null || rejectedAt === undefined ? null : Number(rejectedAt);
  const itemsByLoc = new Map<string, MapItem[]>();
  for (const i of items) {
    const diff = i.counted_qty === null ? null : Number(i.counted_qty) - Number(i.expected_qty);
    const countedAt = i.counted_at === null ? null : Number(i.counted_at);
    const recount = rejected !== null && diff !== null && diff !== 0 && (countedAt === null || countedAt <= rejected);
    const list = itemsByLoc.get(i.location_id) ?? [];
    list.push({
      id: i.id,
      sku: i.sku,
      barcode: i.barcode ?? null,
      description: i.description,
      uom: i.uom,
      lot: i.lot_code,
      expiry: i.expiry_date,
      expected: blind ? null : Number(i.expected_qty),
      counted: i.counted_qty === null ? null : Number(i.counted_qty),
      countedBy: i.counted_by_name,
      countedAt,
      diff: blind ? null : diff,
      notes: i.notes,
      adjusted: i.adjusted,
      recount,
    });
    itemsByLoc.set(i.location_id, list);
  }

  // zona → rua → endereços
  const zoneOrder = [...new Map(locations.map((l) => [l.zone_id, l])).values()].sort((a, b) => natural(a.zone_code, b.zone_code));
  const zones: MapZone[] = [];
  const aisles: MapAisle[] = [];
  const cells: MapCell[] = [];
  let y = 0;
  let width = 0;
  for (const z of zoneOrder) {
    const locs = locations.filter((l) => l.zone_id === z.zone_id);
    const aisleCodes = [...new Set(locs.map((l) => l.aisle))].sort(natural);
    const y0 = y;
    let zoneWidth = 0;
    for (const a of aisleCodes) {
      const inAisle = locs.filter((l) => l.aisle === a);
      const bays = [...new Set(inAisle.map((l) => l.bay))].sort(natural);
      const levels = [...new Set(inAisle.map((l) => l.level))].sort(natural);
      aisles.push({ key: `${z.zone_id}:${a}`, zoneId: z.zone_id, zoneCode: z.zone_code, aisle: a, y, bays, levels });
      zoneWidth = Math.max(zoneWidth, bays.length);
      for (const l of inAisle) {
        const bx = bays.indexOf(l.bay);
        const lz = levels.indexOf(l.level);
        const siblings = inAisle.filter((o) => o.bay === l.bay && o.level === l.level).map((o) => o.position).sort(natural);
        const np = siblings.length;
        const p = siblings.indexOf(l.position);
        const its = itemsByLoc.get(l.id) ?? [];
        cells.push({
          id: l.id,
          code: l.code,
          zoneId: z.zone_id,
          zoneCode: z.zone_code,
          zoneName: z.zone_name,
          aisle: l.aisle,
          bay: l.bay,
          level: l.level,
          position: l.position,
          locationType: l.location_type,
          blocked: l.status === "blocked",
          x: bx + p / np,
          w: 1 / np,
          y,
          z: lz,
          situation: situationOf(its, blind),
          ...occupancyFields(l, blind),
          lastCountedAt: lastCount(l, its),
          items: its,
        });
      }
      y += RACK_DEPTH + CORRIDOR;
    }
    zones.push({ id: z.zone_id, code: z.zone_code, name: z.zone_name, type: z.zone_type, y0, y1: y - CORRIDOR, width: zoneWidth });
    width = Math.max(width, zoneWidth);
    y += ZONE_GAP;
  }
  const counts: Record<Situation, number> = { pending: 0, counted: 0, divergent: 0, recount: 0, outside: 0 };
  for (const c of cells) counts[c.situation]++;
  const levels = [...new Set(cells.map((c) => c.z))].sort((a, b) => a - b).map(String);
  return { blind, zones, aisles, cells, levels, width, depth: Math.max(0, y - ZONE_GAP - CORRIDOR), counts, generatedAt: now };
}

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * Ocupação da posição (0–1). O cadastro não tem volume útil do endereço, só capacidade em
 * unidades (`capacity_units`) e, opcionalmente, peso máximo (`max_weight_kg`). Por isso:
 *  - unidades ocupadas ÷ capacidade em unidades;
 *  - se o endereço tem peso máximo e os produtos têm peso, também peso do saldo ÷ peso máximo;
 *  - vale o MAIOR dos dois (o recurso que esgota primeiro), limitado a 100%.
 */
export function occupancyOf(input: { units: number; capacity: number | null; kg?: number | null; maxKg?: number | null }): {
  value: number;
  basis: "weight" | "units" | "empty";
} {
  const byUnits = input.capacity && input.capacity > 0 ? input.units / input.capacity : 0;
  const byWeight = input.maxKg && input.maxKg > 0 && input.kg ? input.kg / input.maxKg : 0;
  const value = Math.min(1, Math.max(0, byUnits, byWeight));
  if (value <= 0) return { value: 0, basis: "empty" };
  return { value, basis: byWeight > byUnits ? "weight" : "units" };
}

function occupancyFields(l: MapLocationInput, blind: boolean) {
  const o = occupancyOf({
    units: num(l.on_hand_units) ?? 0,
    capacity: num(l.capacity_units),
    kg: num(l.on_hand_kg),
    maxKg: num(l.max_weight_kg),
  });
  // contagem cega: só a fração arredondada (5%), sem unidades, para não revelar o saldo esperado
  return {
    occupancy: blind ? Math.round(o.value * 20) / 20 : o.value,
    occupancyBasis: o.basis,
    capacity: num(l.capacity_units),
    onHand: blind ? null : (num(l.on_hand_units) ?? 0),
  };
}

function lastCount(l: MapLocationInput, items: MapItem[]): number | null {
  const times = [num(l.last_counted_at), ...items.map((i) => i.countedAt)].filter((t): t is number => t !== null);
  return times.length ? Math.max(...times) : null;
}

/**
 * Ordem de rota da contagem: zona → rua; em cada rua os módulos em serpentina (ruas
 * pares no sentido inverso, para o operador não voltar ao início) e, no módulo, do nível
 * mais baixo ao mais alto. Só endereços dentro do inventário.
 */
export function routeOrder(map: CdMap): MapCell[] {
  const ys = [...new Set(map.cells.map((c) => c.y))].sort((a, b) => a - b);
  return map.cells
    .filter((c) => c.situation !== "outside")
    .sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      const reverse = ys.indexOf(a.y) % 2 === 1;
      const dx = Math.floor(a.x) - Math.floor(b.x);
      if (dx) return reverse ? -dx : dx;
      return a.z - b.z || a.x - b.x;
    });
}

/** Próximo endereço a contar (a contar ou em recontagem) na ordem de rota, a partir de `fromId`. */
export function nextToCount(map: CdMap, fromId: string | null): MapCell | null {
  const route = routeOrder(map);
  const todo = (c: MapCell) => c.situation === "pending" || c.situation === "recount";
  const i = fromId ? route.findIndex((c) => c.id === fromId) : -1;
  return route.slice(i + 1).find(todo) ?? route.slice(0, Math.max(0, i + 1)).find(todo) ?? null;
}

/** Endereço onde o operador está: o último contado neste inventário (ou null = entrada do CD). */
export function lastCountedCell(map: CdMap): MapCell | null {
  let best: MapCell | null = null;
  for (const c of map.cells) {
    const at = Math.max(-1, ...c.items.filter((i) => i.countedAt !== null).map((i) => i.countedAt!));
    if (at < 0) continue;
    const bestAt = best ? Math.max(...best.items.filter((i) => i.countedAt !== null).map((i) => i.countedAt!)) : -1;
    if (at > bestAt) best = c;
  }
  return best;
}

/** Metros por unidade do grid (largura de um módulo de porta-paletes), para a distância estimada. */
export const METERS_PER_UNIT = 2.7;

/**
 * Rota a pé (no piso, coordenadas do grid) de um endereço até outro pelos corredores: sai para
 * o corredor em frente à rua de origem, segue pela cabeceira (x = -0,6) se precisar trocar de
 * corredor e entra no corredor de destino até o módulo. `from` null = entrada do CD.
 */
export function walkRoute(from: MapCell | null, to: MapCell): { points: [number, number][]; meters: number } {
  const lane = (c: MapCell) => c.y + 1.5;
  const head = -0.6;
  const tx = Math.floor(to.x) + 0.5;
  const pts: [number, number][] = [];
  if (!from) {
    pts.push([head, -0.8], [head, lane(to)]);
  } else {
    const fx = Math.floor(from.x) + 0.5;
    pts.push([fx, lane(from)]);
    if (lane(from) !== lane(to)) pts.push([head, lane(from)], [head, lane(to)]);
  }
  pts.push([tx, lane(to)], [tx, to.y + 1.05]);
  const dedup = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  let len = 0;
  for (let i = 1; i < dedup.length; i++) len += Math.abs(dedup[i][0] - dedup[i - 1][0]) + Math.abs(dedup[i][1] - dedup[i - 1][1]);
  return { points: dedup, meters: Math.round(len * METERS_PER_UNIT) };
}

export type ColorMode = "situation" | "occupancy" | "lastCount";

/** Faixas de idade da última contagem (dias). */
export function lastCountBucket(at: number | null, now: number): 0 | 1 | 2 | 3 {
  if (at === null) return 3;
  const days = (now - at) / 86_400_000;
  return days <= 30 ? 0 : days <= 90 ? 1 : 2;
}
export const LAST_COUNT_LABELS = ["Até 30 dias", "31 a 90 dias", "Mais de 90 dias", "Nunca contado"] as const;

/** Faixa de ocupação (0 = vazio … 4 = acima de 90%). */
export function occupancyBucket(v: number): 0 | 1 | 2 | 3 | 4 {
  return v <= 0 ? 0 : v <= 0.4 ? 1 : v <= 0.7 ? 2 : v <= 0.9 ? 3 : 4;
}
export const OCCUPANCY_LABELS = ["Vazio", "Até 40%", "41–70%", "71–90%", "Acima de 90%"] as const;

export type Direction = "left" | "right" | "up" | "down";

/**
 * Endereço vizinho para navegação por teclado: esquerda/direita percorrem a rua no mesmo
 * nível (módulo/posição); cima/baixo trocam de nível no mesmo módulo; nas pontas da rua,
 * esquerda/direita passam para a rua anterior/seguinte.
 */
export function neighbor(map: CdMap, fromId: string | null, dir: Direction): string | null {
  const ordered = [...map.cells].sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
  if (!ordered.length) return null;
  const cur = ordered.find((c) => c.id === fromId);
  if (!cur) return ordered[0].id;
  if (dir === "up" || dir === "down") {
    const sameBay = map.cells.filter((c) => c.y === cur.y && Math.floor(c.x) === Math.floor(cur.x) && c.z !== cur.z);
    const cands = sameBay.filter((c) => (dir === "up" ? c.z > cur.z : c.z < cur.z)).sort((a, b) => (dir === "up" ? a.z - b.z : b.z - a.z));
    return cands[0]?.id ?? cur.id;
  }
  // percorre a rua no mesmo nível; nas pontas, salta para a rua vizinha
  const row = ordered.filter((c) => c.y === cur.y && c.z === cur.z).sort((a, b) => a.x - b.x);
  const i = row.indexOf(cur) + (dir === "right" ? 1 : -1);
  if (i >= 0 && i < row.length) return row[i].id;
  const ys = [...new Set(ordered.map((c) => c.y))].sort((a, b) => a - b);
  const ny = ys[ys.indexOf(cur.y) + (dir === "right" ? 1 : -1)];
  if (ny === undefined) return cur.id;
  const next = ordered.filter((c) => c.y === ny).sort((a, b) => (dir === "right" ? a.x - b.x || a.z - b.z : b.x - a.x || a.z - b.z));
  return next[0]?.id ?? cur.id;
}
