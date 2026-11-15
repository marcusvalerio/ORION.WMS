/**
 * KPIs de acuracidade do inventário (calculados no servidor a partir dos itens reais).
 *
 * Definições:
 *  - Acuracidade = itens contados cuja quantidade contada é igual à esperada ÷ itens contados × 100
 *    (por item = produto/lote/endereço). Sem item contado, não há acuracidade (null).
 *  - Diferença em pp = acuracidade atual − acuracidade do ciclo anterior (último inventário
 *    aprovado do mesmo depósito antes deste).
 *  - Endereço contado = endereço do inventário com todos os itens contados.
 *  - Ajuste em valor = Σ (contado − esperado) × último preço de compra do produto; sobra (> 0) e
 *    falta (< 0) separadas. Produtos sem preço de compra ficam fora (e isso é informado).
 *  - Ritmo = endereços contados ÷ horas entre a primeira e a última contagem (mín. 15 min);
 *    término previsto = agora + endereços restantes ÷ ritmo (só enquanto em contagem).
 */

export const ACCURACY_TARGET = 99;
const MIN_HOURS = 0.25;

export interface KpiItemInput {
  location_id: string;
  zone_code: string;
  zone_name: string;
  expected_qty: number | string;
  counted_qty: number | string | null;
  /** ms epoch */
  counted_at: number | string | null;
  unit_price: number | string | null;
}

export interface CycleInput {
  id: string;
  code: string;
  /** aprovação (ms epoch) */
  closed_at: number | string;
  items: number | string;
  accurate: number | string;
  divergences: number | string;
}

export interface Cycle {
  id: string;
  code: string;
  label: string;
  accuracy: number | null;
  divergences: number;
  current: boolean;
}

export interface InventoryKpis {
  /** contagem cega: acuracidade, divergências e valor do inventário em curso não são expostos */
  blind: boolean;
  status: string;
  accuracy: number | null;
  previousAccuracy: number | null;
  deltaPp: number | null;
  target: number;
  cycles: Cycle[];
  locations: { counted: number; total: number };
  items: { counted: number; total: number };
  divergences: number | null;
  divergencePct: number | null;
  previousDivergences: number | null;
  value: { net: number; surplus: number; shortage: number; unpriced: number } | null;
  pace: { perHour: number | null; remaining: number; eta: number | null };
  zones: { code: string; name: string; accuracy: number | null; counted: number; total: number }[];
}

const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const round1 = (v: number) => Math.round(v * 10) / 10;

export function accuracyOf(counted: number, accurate: number): number | null {
  return counted > 0 ? round1((accurate / counted) * 100) : null;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** Rótulo curto do ciclo: mês abreviado (fuso de São Paulo). */
export function cycleLabel(ms: number): string {
  const m = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", month: "numeric" }).format(new Date(ms)));
  return MONTHS[m - 1];
}

export function computeInventoryKpis({
  status,
  blind,
  items,
  history,
  currentId,
  now = Date.now(),
}: {
  status: string;
  blind: boolean;
  items: KpiItemInput[];
  /** inventários APROVADOS do depósito, em qualquer ordem (pode incluir o atual) */
  history: CycleInput[];
  currentId: string;
  now?: number;
}): InventoryKpis {
  const counted = items.filter((i) => n(i.counted_qty) !== null);
  const diffOf = (i: KpiItemInput) => Number(i.counted_qty) - Number(i.expected_qty);
  const accurate = counted.filter((i) => Math.abs(diffOf(i)) < 1e-9);
  const accuracy = accuracyOf(counted.length, accurate.length);
  const divergences = counted.length - accurate.length;

  // ciclos: aprovados em ordem cronológica; o atual entra (em andamento) se ainda não aprovado
  const closed = [...history].sort((a, b) => Number(a.closed_at) - Number(b.closed_at));
  const idx = closed.findIndex((c) => c.id === currentId);
  const before = idx >= 0 ? closed.slice(0, idx) : closed;
  const prev = before.at(-1) ?? null;
  const toCycle = (c: CycleInput): Cycle => ({
    id: c.id,
    code: c.code,
    label: cycleLabel(Number(c.closed_at)),
    accuracy: accuracyOf(Number(c.items), Number(c.accurate)),
    divergences: Number(c.divergences),
    current: c.id === currentId,
  });
  let cycles = (idx >= 0 ? closed.slice(0, idx + 1) : closed).map(toCycle);
  if (idx < 0 && !blind && accuracy !== null && status !== "cancelled") {
    cycles.push({ id: currentId, code: "atual", label: "atual", accuracy, divergences, current: true });
  }
  cycles = cycles.slice(-6);
  const previousAccuracy = prev ? accuracyOf(Number(prev.items), Number(prev.accurate)) : null;

  // endereços
  const byLoc = new Map<string, KpiItemInput[]>();
  for (const i of items) byLoc.set(i.location_id, [...(byLoc.get(i.location_id) ?? []), i]);
  const locDone = [...byLoc.values()].filter((l) => l.every((i) => n(i.counted_qty) !== null));
  const remaining = byLoc.size - locDone.length;

  // ritmo
  const times = counted.map((i) => n(i.counted_at)).filter((t): t is number => t !== null);
  let perHour: number | null = null;
  let eta: number | null = null;
  if (times.length && locDone.length) {
    const hours = Math.max(MIN_HOURS, (Math.max(...times) - Math.min(...times)) / 3_600_000);
    perHour = round1(locDone.length / hours);
    if (status === "counting" && remaining > 0 && perHour > 0) eta = now + (remaining / perHour) * 3_600_000;
  }

  // valor
  let surplus = 0;
  let shortage = 0;
  let unpriced = 0;
  for (const i of counted) {
    const d = diffOf(i);
    if (!d) continue;
    const price = n(i.unit_price);
    if (price === null) {
      unpriced++;
      continue;
    }
    if (d > 0) surplus += d * price;
    else shortage += -d * price;
  }

  // por zona
  const zoneMap = new Map<string, { code: string; name: string; total: number; counted: number; accurate: number }>();
  for (const i of items) {
    const z = zoneMap.get(i.zone_code) ?? { code: i.zone_code, name: i.zone_name, total: 0, counted: 0, accurate: 0 };
    z.total++;
    if (n(i.counted_qty) !== null) {
      z.counted++;
      if (Math.abs(diffOf(i)) < 1e-9) z.accurate++;
    }
    zoneMap.set(i.zone_code, z);
  }
  const zones = [...zoneMap.values()]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((z) => ({ code: z.code, name: z.name, accuracy: blind ? null : accuracyOf(z.counted, z.accurate), counted: z.counted, total: z.total }));

  return {
    blind,
    status,
    accuracy: blind ? null : accuracy,
    previousAccuracy,
    deltaPp: !blind && accuracy !== null && previousAccuracy !== null ? round1(accuracy - previousAccuracy) : null,
    target: ACCURACY_TARGET,
    cycles,
    locations: { counted: locDone.length, total: byLoc.size },
    items: { counted: counted.length, total: items.length },
    divergences: blind ? null : divergences,
    divergencePct: blind || !counted.length ? null : round1((divergences / counted.length) * 100),
    previousDivergences: prev ? Number(prev.divergences) : null,
    value: blind ? null : { net: surplus - shortage, surplus, shortage, unpriced },
    pace: { perHour, remaining, eta },
    zones,
  };
}
