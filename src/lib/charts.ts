/**
 * Cálculos puros dos gráficos no "traço do símbolo" ORION: barras verticais de
 * espessuras diferentes, partidas por vãos de 4px. Sem dependência de React,
 * para poder ser testado e usado tanto no servidor quanto no cliente.
 */
import { ORION_COLUMNS } from "@/components/brand/orion-mark";

/** Vão padrão entre trechos e blocos (px). */
export const GAP = 4;

/** Larguras relativas das colunas do símbolo (0.15, 0.19, 0.13…), normalizadas pela maior. */
export const STROKE_WIDTHS: readonly number[] = (() => {
  const ws = ORION_COLUMNS.map(([, w]) => w);
  const max = Math.max(...ws);
  return ws.map((w) => w / max);
})();

/** Fração (0–1, de baixo para cima) onde cada coluna do símbolo é partida — usada para quebrar barras. */
export const BREAK_POINTS: readonly number[] = ORION_COLUMNS.map(([, , spans]) => {
  // primeiro vão do símbolo, convertido para fração da altura total da coluna
  const top = spans[0][0];
  const bottom = spans[spans.length - 1][1];
  const gapAt = spans.length > 1 ? (spans[0][1] + spans[1][0]) / 2 : (top + bottom) / 2;
  return Math.min(0.75, Math.max(0.25, (bottom - gapAt) / (bottom - top)));
});

/** Espessura relativa (0–1) da i-ésima barra, ciclando as colunas do símbolo. */
export function strokeWidth(i: number): number {
  return STROKE_WIDTHS[((i % STROKE_WIDTHS.length) + STROKE_WIDTHS.length) % STROKE_WIDTHS.length];
}

/** Máximo "redondo" para a escala (1, 2, 2.5, 5 × 10ⁿ), nunca menor que o maior valor. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * base >= value) return Number((m * base).toFixed(10));
  }
  return 10 * base;
}

/** Marcas do eixo: 0, metade e máximo da escala. */
export function ticks(max: number): number[] {
  const m = niceMax(max);
  return [0, m / 2, m];
}

/** Altura (px) de um valor numa escala linear 0..max sobre `height` px. */
export function scale(value: number, max: number, height: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.min(height, (value / max) * height);
}

/**
 * Parte uma barra vertical de altura `h` em trechos separados por um vão de `gap` px,
 * no ponto de quebra da coluna i do símbolo. Barras curtas demais ficam inteiras.
 * Retorna trechos [y0, y1] medidos a partir da base (0 = chão).
 */
export function splitBar(h: number, i: number, gap = GAP): [number, number][] {
  if (h <= 0) return [];
  if (h < gap * 3) return [[0, h]];
  const at = BREAK_POINTS[((i % BREAK_POINTS.length) + BREAK_POINTS.length) % BREAK_POINTS.length] * h;
  return [
    [0, at - gap / 2],
    [at + gap / 2, h],
  ];
}

/** Dia (YYYY-MM-DD) no fuso local de São Paulo. */
export function isoDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Série diária contínua dos últimos `days` dias terminando em `today`, preenchendo com 0
 * os dias sem registro. Linhas fora da janela são ignoradas.
 */
export function dailySeries(rows: { day: string; n: number | string }[], days: number, today: string): { day: string; value: number }[] {
  const byDay = new Map(rows.map((r) => [r.day.slice(0, 10), Number(r.n) || 0]));
  const end = new Date(`${today}T12:00:00Z`);
  const out: { day: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ day: d, value: byDay.get(d) ?? 0 });
  }
  return out;
}

/** Quantos de `total` trechos/blocos ficam acesos para uma porcentagem. */
export function litCount(pct: number, total: number): number {
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.min(total, Math.max(1, Math.round((Math.min(pct, 100) / 100) * total)));
}

/** Trechos do símbolo em ordem de acendimento (coluna da esquerda → direita; em cada coluna, de baixo para cima). */
export function glyphSegments(): { col: number; cx: number; w: number; y0: number; y1: number }[] {
  return ORION_COLUMNS.flatMap(([cx, w, spans], col) =>
    [...spans].reverse().map(([y0, y1]) => ({ col, cx, w, y0, y1 })),
  );
}

/**
 * Blocos de uma faixa horizontal: larguras variadas (ciclo das colunas do símbolo) somando
 * `width` px incluindo vãos. O valor é lido pela quantidade de blocos cheios.
 */
export function blockLayout(count: number, width: number, gap = GAP): { x: number; w: number }[] {
  const rel = Array.from({ length: count }, (_, i) => 0.6 + 0.4 * strokeWidth(i));
  const sum = rel.reduce((a, b) => a + b, 0);
  const free = width - gap * (count - 1);
  let x = 0;
  return rel.map((r) => {
    const w = (r / sum) * free;
    const b = { x, w };
    x += w + gap;
    return b;
  });
}
