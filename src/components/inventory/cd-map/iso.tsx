import type { ColorMode, MapCell, Situation } from "@/lib/cd-map";
import { lastCountBucket, LAST_COUNT_LABELS, OCCUPANCY_LABELS, occupancyBucket, SITUATION_LABELS } from "@/lib/cd-map";

/** Projeção isométrica (30°): 1 unidade de módulo/rua = U px; 1 nível = BOX_H px de altura. */
export const U = 34;
export const BOX_H = 22;
const COS = Math.cos(Math.PI / 6);
const SIN = 0.5;
/** folga entre caixas (fração do módulo) e vão de 4px entre níveis */
const G = 0.12;
const GAP_PX = 4;

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function project(x: number, y: number, zPx: number): [number, number] {
  return [(x - y) * U * COS, (x + y) * U * SIN - zPx];
}

export function projectedBounds(points: [number, number][]): ViewBox {
  if (!points.length) return { x: 0, y: 0, w: 100, h: 100 };
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Caixa 3D do endereço: módulo/posição no x, profundidade da rua no y, nível na altura. */
export function cellBox(c: MapCell) {
  const x0 = c.x + (G / 2) * c.w;
  const x1 = c.x + c.w - (G / 2) * c.w;
  const y0 = c.y + G / 2;
  const y1 = c.y + 1 - G / 2;
  const b = c.z * BOX_H + 1;
  const t = b + BOX_H - GAP_PX;
  const P = project;
  const top = [P(x0, y0, t), P(x1, y0, t), P(x1, y1, t), P(x0, y1, t)];
  const front = [P(x0, y1, b), P(x1, y1, b), P(x1, y1, t), P(x0, y1, t)];
  const side = [P(x1, y0, b), P(x1, y1, b), P(x1, y1, t), P(x1, y0, t)];
  return { top, front, side, corners: [...top, ...front, ...side], anchor: P((x0 + x1) / 2, (y0 + y1) / 2, t) };
}

/** Três tons por cor: [topo, frente, lateral] — a luz vem de cima. Paleta do modo inventário (escuro). */
type Tri = readonly [string, string, string];
export const SIT_COLORS: Record<Situation | "selected", Tri> = {
  counted: ["#2CC593", "#178A69", "#0F6B51"],
  pending: ["#4A5578", "#2E3756", "#232B47"],
  divergent: ["#F2545E", "#B83740", "#8F2A31"],
  recount: ["#E9B53A", "#B88A22", "#8F6A17"],
  outside: ["#1B2756", "#151F48", "#111A3C"],
  selected: ["#FFF8E7", "#F8E2A6", "#D9BE77"],
};
export const OCC_COLORS: readonly Tri[] = [
  ["#1B2756", "#151F48", "#111A3C"],
  ["#2160A8", "#1A4C86", "#143B69"],
  ["#4E97E3", "#2D77CC", "#2160A8"],
  ["#9DC7F4", "#7DB7F0", "#4E97E3"],
  ["#E9B53A", "#B88A22", "#8F6A17"],
];
export const AGE_COLORS: readonly Tri[] = [SIT_COLORS.counted, ["#7DB7F0", "#4E97E3", "#2D77CC"], SIT_COLORS.recount, SIT_COLORS.pending];

export function cellColors(c: MapCell, mode: ColorMode, now: number): Tri {
  if (mode === "occupancy") return OCC_COLORS[occupancyBucket(c.occupancy)];
  if (mode === "lastCount") return AGE_COLORS[lastCountBucket(c.lastCountedAt, now)];
  return SIT_COLORS[c.situation];
}

export function legendFor(mode: ColorMode, blind: boolean): { label: string; color: string }[] {
  if (mode === "occupancy") return OCCUPANCY_LABELS.map((label, i) => ({ label, color: OCC_COLORS[i][1] }));
  if (mode === "lastCount") return LAST_COUNT_LABELS.map((label, i) => ({ label, color: AGE_COLORS[i][0] }));
  return (Object.keys(SITUATION_LABELS) as Situation[])
    .filter((k) => !(blind && k === "divergent"))
    .map((k) => ({ label: SITUATION_LABELS[k], color: SIT_COLORS[k][0] }));
}

export const pts = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

export function IsoBox({
  cell,
  colors,
  selected,
  dim,
  onSelect,
  title,
}: {
  cell: MapCell;
  colors: Tri;
  selected: boolean;
  dim: boolean;
  onSelect: () => void;
  title: string;
}) {
  const box = cellBox(cell);
  const c = selected ? SIT_COLORS.selected : colors;
  return (
    <g onClick={onSelect} className="cursor-pointer" opacity={dim ? 0.25 : 1}>
      <title>{title}</title>
      <polygon points={pts(box.front)} fill={c[1]} />
      <polygon points={pts(box.side)} fill={c[2]} />
      <polygon points={pts(box.top)} fill={c[0]} />
      {selected ? <polygon points={pts(box.top)} fill="none" stroke="#FFF8E7" strokeWidth={1.5} /> : null}
    </g>
  );
}
