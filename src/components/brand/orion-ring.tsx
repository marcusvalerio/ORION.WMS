import type { CSSProperties } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Anel "O" do ORION: as barras do símbolo repetidas em volta de um círculo,
 * com larguras, alturas e cortes variados. Gira devagar e, opcionalmente, uma
 * onda percorre o anel afinando cada barra (scaleX) e devolvendo a espessura.
 *
 * SVG gerado em código, sem JavaScript no cliente. As animações vêm de
 * classes em globals.css e param com `prefers-reduced-motion: reduce`.
 */

// Larguras, alturas e cortes (frações da altura) das 7 colunas do símbolo.
const WIDTHS = [0.15, 0.19, 0.13, 0.17, 0.1, 0.07, 0.045];
const HEIGHTS = [0.64, 1.16, 1.6, 1.72, 1.56, 1.24, 0.88];
const CUTS: number[][] = [[0.45, 0.55], [0.38, 0.47], [0.25, 0.31, 0.63, 0.69], [0.55, 0.61], [0.4, 0.46], [0.62, 0.7], []];

export const RING_PALETTES = {
  /** Anel externo do login/hero: céu, cobalto, noite e um toque de creme. */
  externo: ["#2D77CC", "#7DB7F0", "#22306F", "#7DB7F0", "#2D77CC", "#FFF8E7", "#22306F"],
  /** Anel interno, mais escuro. */
  interno: ["#22306F", "#172354", "#2D77CC", "#22306F"],
  /** Uma cor só (marca d'água sobre fundo claro). */
  tinta: ["#060B2A"],
  /** Tons de céu sobre fundo escuro. */
  ceu: ["#7DB7F0", "#2D77CC", "#9DC7F4"],
} as const;

export type RingPalette = keyof typeof RING_PALETTES | readonly string[];

export interface RingBar {
  angle: number;
  delay: number;
  x: number;
  width: number;
  segments: { y: number; height: number }[];
  color: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Barras de um anel com `count` barras no raio `radius`; `widthScale` e
 * `lengthScale` convertem as proporções do símbolo em unidades do viewBox.
 */
export function ringBars(count: number, radius: number, widthScale: number, lengthScale: number, palette: readonly string[], waveSeconds = 6): RingBar[] {
  const out: RingBar[] = [];
  for (let i = 0; i < count; i++) {
    const j = (i * 3 + Math.floor(i / 7)) % 7;
    const w = WIDTHS[j] * widthScale;
    const L = HEIGHTS[j] * lengthScale;
    const top = -(radius + L / 2);
    const pts = [0, ...CUTS[j], 1];
    const segments: RingBar["segments"] = [];
    for (let p = 0; p < pts.length; p += 2) segments.push({ y: r1(top + pts[p] * L), height: r1((pts[p + 1] - pts[p]) * L) });
    out.push({
      angle: Math.round((i * 36000) / count) / 100,
      delay: -Math.round((i / count) * waveSeconds * 100) / 100,
      x: r1(-w / 2),
      width: r1(w),
      segments,
      color: palette[(i * 5) % palette.length],
    });
  }
  return out;
}

export function OrionRing({
  size = 1100,
  bars = 84,
  palette = "externo",
  direction = "cw",
  spinSeconds = 240,
  wave = true,
  waveSeconds = 6,
  barWidth = 190,
  barLength = 340,
  className,
  style,
  title,
}: {
  /** Lado do SVG (px ou qualquer medida CSS). */
  size?: number | string;
  bars?: number;
  palette?: RingPalette;
  /** Sentido do giro: horário, anti-horário ou parado. */
  direction?: "cw" | "ccw" | "none";
  spinSeconds?: number;
  /** Onda que afina cada barra e volta à espessura normal. */
  wave?: boolean;
  waveSeconds?: number;
  barWidth?: number;
  barLength?: number;
  className?: string;
  style?: CSSProperties;
  /** Sem título, o anel é decorativo (aria-hidden). */
  title?: string;
}) {
  const colors = typeof palette === "string" ? RING_PALETTES[palette as keyof typeof RING_PALETTES] : palette;
  const items = ringBars(bars, 1000, barWidth, barLength, colors, waveSeconds);
  return (
    <svg
      viewBox="-1400 -1400 2800 2800"
      className={cn("orion-ring pointer-events-none max-w-none", className)}
      style={{ width: size, height: size, ...style }}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <g className={direction === "none" ? undefined : `orion-ring-${direction}`} style={direction === "none" ? undefined : { animationDuration: `${spinSeconds}s` }}>
        {items.map((b, i) => (
          <g key={i} transform={`rotate(${b.angle})`}>
            <g className={wave ? "orion-ring-wave" : undefined} style={wave ? { animationDelay: `${b.delay}s`, animationDuration: `${waveSeconds}s` } : undefined}>
              {b.segments.map((s, k) => (
                <rect key={k} x={b.x} y={s.y} width={b.width} height={s.height} fill={b.color} />
              ))}
            </g>
          </g>
        ))}
      </g>
    </svg>
  );
}
