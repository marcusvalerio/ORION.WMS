import type { CdMap, ColorMode, MapCell } from "@/lib/cd-map";
import { SITUATION_LABELS } from "@/lib/cd-map";
import { fmtPct } from "@/lib/format";
import { cellColors, SIT_COLORS } from "./iso";

const W = 128; // largura de um módulo
const H = 124; // altura de um nível
const BEAM = 9;
const PAD = { l: 52, r: 96, t: 44, b: 40 };
const WINDOW = 6;
const STEEL = "#2D77CC";

/** Rótulo curto da posição: rua-módulo-nível(-posição). */
export function shortCode(c: MapCell) {
  return `${c.aisle}-${c.bay}-${c.level}${c.position !== "00" ? `-${c.position}` : ""}`;
}

/**
 * Vista FRONTAL RETA (elevação ortográfica, sem perspectiva) da rua do endereço escolhido:
 * montantes e longarinas azuis, cada posição como uma caixa de vidro com o volume interno =
 * ocupação (dividido em caixas), etiqueta clara do endereço sobre a longarina, posição
 * selecionada em creme-300 com a porcentagem e a régua 0–100% ao lado.
 */
export function FrontView({
  map,
  cell: picked,
  level,
  colorMode,
  now,
  onSelect,
}: {
  map: CdMap;
  cell: MapCell;
  level: number | null;
  colorMode: ColorMode;
  now: number;
  onSelect: (id: string) => void;
}) {
  const aisleFull = map.aisles.find((a) => a.zoneId === picked.zoneId && a.y === picked.y);
  // janela de até 6 módulos em volta do endereço, para a vista ficar legível
  const allBays = aisleFull?.bays ?? [picked.bay];
  const ci = Math.max(0, allBays.indexOf(picked.bay));
  const first = Math.max(0, Math.min(ci - 2, allBays.length - WINDOW));
  const bays = allBays.slice(first, first + WINDOW);
  const aisle = aisleFull ? { ...aisleFull, bays } : undefined;
  const row = map.cells
    .filter((c) => c.zoneId === picked.zoneId && c.y === picked.y && Math.floor(c.x) >= first && Math.floor(c.x) < first + WINDOW)
    .map((c) => ({ ...c, x: c.x - first }));
  const cell = row.find((c) => c.id === picked.id) ?? picked;
  const nLevels = Math.max(1, ...row.map((c) => c.z + 1));
  const nBays = Math.max(1, bays.length);
  const width = PAD.l + nBays * W + PAD.r;
  const height = PAD.t + nLevels * H + PAD.b;
  /** linha do piso do nível z (topo da longarina) */
  const floorY = (z: number) => PAD.t + (nLevels - z) * H - BEAM;
  const right = PAD.l + nBays * W;

  const geo = (c: MapCell) => {
    const x0 = PAD.l + c.x * W + 8;
    const x1 = PAD.l + (c.x + c.w) * W - 8;
    const yb = floorY(c.z);
    const yt = yb - H + BEAM + 18;
    const ix0 = x0 + 6;
    const ix1 = x1 - 6;
    const ih = (yb - yt - 6) * c.occupancy;
    return { x0, x1, yb, yt, ix0, ix1, iy: yb - ih, ih };
  };
  const sel = geo(cell);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mx-auto block h-full w-full"
      role="img"
      aria-label={`Vista frontal da rua ${cell.aisle} (zona ${cell.zoneCode}): ${nBays} módulo(s) × ${nLevels} nível(is). Endereço ${cell.code} em destaque, ocupação ${fmtPct(cell.occupancy * 100)}.`}
    >
      <text x={PAD.l} y={24} fill="#9DC7F4" className="font-mono text-[17px]">
        ZONA {cell.zoneCode} · RUA {cell.aisle} — vista de frente
      </text>
      {/* montantes */}
      {Array.from({ length: nBays + 1 }, (_, i) => (
        <line key={`p${i}`} x1={PAD.l + i * W} x2={PAD.l + i * W} y1={PAD.t - 8} y2={floorY(0) + BEAM} stroke={STEEL} strokeWidth={5} strokeLinecap="round" />
      ))}
      {/* longarinas (uma por nível, a do térreo é o piso) */}
      {Array.from({ length: nLevels }, (_, z) => (
        <rect key={`b${z}`} x={PAD.l} y={floorY(z)} width={nBays * W} height={BEAM} rx={2} fill={STEEL} />
      ))}
      {/* níveis */}
      {Array.from({ length: nLevels }, (_, z) => (
        <text key={`n${z}`} x={PAD.l - 12} y={floorY(z) - H / 2 + 10} textAnchor="end" fill={cell.z === z ? "#FFF8E7" : "#8291CC"} className="font-mono text-[16px]">
          N{z + 1}
        </text>
      ))}
      {/* módulos */}
      {aisle?.bays.map((b, i) => (
        <text key={b} x={PAD.l + i * W + W / 2} y={height - 10} textAnchor="middle" fill={b === cell.bay ? "#FFF8E7" : "#8291CC"} className="font-mono text-[15px]">
          MOD {b}
        </text>
      ))}

      {row.map((c) => {
        const g = geo(c);
        const isSel = c.id === cell.id;
        const dim = level !== null && c.z !== level;
        const col = isSel ? SIT_COLORS.selected : cellColors(c, colorMode, now);
        const seams: number[] = g.ih > 30 ? [1, 2].map((k) => g.yb - (g.ih * k) / 3) : [];
        return (
          <g key={c.id} onClick={() => onSelect(c.id)} className="cursor-pointer" opacity={dim ? 0.3 : 1}>
            <title>{`${c.code} — ${SITUATION_LABELS[c.situation]} · ocupação ${fmtPct(c.occupancy * 100)}`}</title>
            {/* volume interno = ocupação */}
            {g.ih > 0 ? (
              <>
                <rect x={g.ix0} y={g.iy} width={g.ix1 - g.ix0} height={g.ih} fill={col[1]} opacity={isSel ? 1 : 0.75} />
                <rect x={g.ix0} y={g.iy} width={g.ix1 - g.ix0} height={Math.min(4, g.ih)} fill={col[0]} opacity={isSel ? 1 : 0.85} />
                {seams.map((y) => (
                  <line key={y} x1={g.ix0} x2={g.ix1} y1={y} y2={y} stroke="#03061A" strokeOpacity={0.45} strokeWidth={1.5} />
                ))}
                {g.ih > 14 ? (
                  <line x1={(g.ix0 + g.ix1) / 2} x2={(g.ix0 + g.ix1) / 2} y1={g.iy + 4} y2={g.yb} stroke="#03061A" strokeOpacity={0.45} strokeWidth={1.5} />
                ) : null}
              </>
            ) : null}
            {/* caixa de vidro da posição */}
            <rect
              x={g.x0}
              y={g.yt}
              width={g.x1 - g.x0}
              height={g.yb - g.yt}
              rx={3}
              fill={isSel ? "#F8E2A6" : "#7DB7F0"}
              fillOpacity={isSel ? 0.1 : 0.04}
              stroke={isSel ? "#F8E2A6" : "#2D4A8A"}
              strokeWidth={isSel ? 2.5 : 1}
            />
            {/* etiqueta do endereço sobre a longarina */}
            <rect x={(g.x0 + g.x1) / 2 - 48} y={g.yb + 0.5} width={96} height={BEAM + 11} rx={3} fill={isSel ? "#F8E2A6" : "#FFF8E7"} fillOpacity={isSel ? 1 : 0.78} />
            <text x={(g.x0 + g.x1) / 2} y={g.yb + 15} textAnchor="middle" fill="#060B2A" className="pointer-events-none font-mono text-[13px] font-medium">
              {shortCode(c)}
            </text>
            {isSel ? (
              <text
                x={(g.x0 + g.x1) / 2}
                y={g.ih > 34 ? g.iy + 26 : g.iy - 8}
                textAnchor="middle"
                fill={g.ih > 34 ? "#03061A" : "#F8E2A6"}
                className="pointer-events-none font-mono text-[22px] font-medium"
              >
                {Math.round(c.occupancy * 100)}%
              </text>
            ) : null}
          </g>
        );
      })}

      {/* régua 0–100% ao lado, na altura do nível selecionado */}
      <g aria-hidden>
        <line x1={right + 34} x2={right + 34} y1={sel.yb - 6} y2={sel.yt} stroke="#9DC7F4" strokeWidth={2} />
        {[0, 25, 50, 75, 100].map((p) => {
          const y = sel.yb - 6 - ((sel.yb - 6 - sel.yt) * p) / 100;
          return (
            <g key={p}>
              <line x1={right + 34} x2={right + 44} y1={y} y2={y} stroke="#9DC7F4" strokeWidth={2} />
              <text x={right + 50} y={y + 4} fill="#9DC7F4" className="font-mono text-[14px]">
                {p}%
              </text>
            </g>
          );
        })}
        <line x1={sel.x1} x2={right + 34} y1={sel.iy} y2={sel.iy} stroke="#F8E2A6" strokeWidth={1.5} strokeDasharray="6 5" />
      </g>
    </svg>
  );
}
