import { glyphSegments, litCount } from "@/lib/charts";
import { fmtPct } from "@/lib/format";

const SEGMENTS = glyphSegments();
const fix = (n: number) => Number(n.toFixed(4));

/**
 * O próprio símbolo ORION como medidor: os 14 trechos acendem em céu-400 conforme a
 * porcentagem (coluna da esquerda para a direita, de baixo para cima); o restante fica
 * apagado (gelo-200 no claro, noite-600 no escuro).
 */
export function GlyphGauge({ value, label, size = 112, detail }: { value: number; label: string; size?: number; detail?: string }) {
  const lit = litCount(value, SEGMENTS.length);
  return (
    <div className="flex items-center gap-4">
      <svg
        width={size}
        height={size}
        viewBox="-1 -1 2 2"
        role="img"
        aria-label={`${label}: ${fmtPct(value)} — ${lit} de ${SEGMENTS.length} trechos acesos`}
        className="shrink-0"
      >
        {SEGMENTS.map((s, i) => (
          <rect
            key={i}
            x={fix(s.cx - s.w / 2)}
            y={fix(s.y0)}
            width={fix(s.w)}
            height={fix(s.y1 - s.y0)}
            className={i < lit ? "fill-ceu-400" : "fill-chart-off"}
          />
        ))}
      </svg>
      <div>
        <p className="font-display text-3xl font-semibold tracking-tight text-fg tabular-nums">{fmtPct(value)}</p>
        <p className="text-xs font-medium text-fg-2">{label}</p>
        {detail ? <p className="mt-0.5 text-xs text-muted">{detail}</p> : null}
        <p className="mt-1 text-[11px] text-muted">
          {lit}/{SEGMENTS.length} trechos acesos
        </p>
      </div>
    </div>
  );
}
