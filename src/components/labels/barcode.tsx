import { barRects, encodeCode128 } from "@/lib/barcode/code128";

/** Código de barras Code 128 em SVG (vetorial, nítido na impressão). */
export function Barcode128({
  value,
  height = 48,
  showText = true,
  className,
  barHeight = "14mm",
}: {
  barHeight?: string;
  value: string;
  height?: number;
  showText?: boolean;
  className?: string;
}) {
  let code;
  try {
    code = encodeCode128(value);
  } catch {
    return <span className="text-xs text-crit-fg">Código não imprimível em Code 128: {value}</span>;
  }
  const quiet = 10;
  const width = code.modules + quiet * 2;
  return (
    <figure className={className}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height: barHeight }}
        role="img"
        aria-label={`Código de barras ${value}`}
        shapeRendering="crispEdges"
      >
        <rect width={width} height={height} fill="#fff" />
        {barRects(code, quiet).map((r, i) => (
          <rect key={i} x={r.x} y={0} width={r.w} height={height} fill="#000" />
        ))}
      </svg>
      {showText ? <figcaption className="mt-0.5 text-center font-mono text-[9pt] tracking-wider">{value}</figcaption> : null}
    </figure>
  );
}
