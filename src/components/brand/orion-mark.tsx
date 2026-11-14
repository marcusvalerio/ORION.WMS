/** Colunas do símbolo ORION: centro x, largura e trechos verticais, em unidades do raio R. */
export const ORION_COLUMNS: readonly (readonly [number, number, readonly (readonly [number, number])[]])[] = [
  [-0.7, 0.15, [[-0.3, -0.06], [0.04, 0.34]]],
  [-0.44, 0.19, [[-0.58, -0.14], [-0.04, 0.58]]],
  [-0.17, 0.13, [[-0.8, -0.4], [-0.3, 0.22], [0.32, 0.8]]],
  [0.08, 0.17, [[-0.86, 0.08], [0.18, 0.86]]],
  [0.32, 0.1, [[-0.78, -0.16], [-0.06, 0.78]]],
  [0.52, 0.07, [[-0.62, 0.14], [0.24, 0.62]]],
  [0.7, 0.045, [[-0.44, 0.44]]],
];

/** Retângulos do símbolo para um raio R (origem no centro). */
export function orionRects(r: number) {
  return ORION_COLUMNS.flatMap(([cx, w, spans]) =>
    spans.map(([y0, y1]) => ({ x: (cx - w / 2) * r, y: y0 * r, width: w * r, height: (y1 - y0) * r })),
  );
}

const fix = (n: number) => Number(n.toFixed(4));

export function OrionMark({
  size = 32,
  color = "currentColor",
  className,
  title,
}: {
  size?: number;
  color?: string;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-1 -1 2 2"
      fill={color}
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {orionRects(1).map((b, i) => (
        <rect key={i} x={fix(b.x)} y={fix(b.y)} width={fix(b.width)} height={fix(b.height)} />
      ))}
    </svg>
  );
}
