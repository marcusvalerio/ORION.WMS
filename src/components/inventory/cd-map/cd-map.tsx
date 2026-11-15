"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, Search } from "lucide-react";
import type { CdMap as CdMapData, ColorMode, Direction, MapCell } from "@/lib/cd-map";
import { lastCountedCell, neighbor, nextToCount, routeOrder, SITUATION_LABELS, walkRoute } from "@/lib/cd-map";
import { fmtPct } from "@/lib/format";
import { cn } from "@/components/ui/cn";
import { CellPanel } from "./cell-panel";
import { FrontView } from "./front-view";
import { cellBox, cellColors, IsoBox, legendFor, project, projectedBounds, pts, SIT_COLORS, type ViewBox } from "./iso";

const FULL_PAD = 30;
const ANIM_MS = 650;
const AUTO_ADVANCE_KEY = "orion.inventario.avancarSozinho";
const MODES: { key: ColorMode; label: string }[] = [
  { key: "situation", label: "Situação" },
  { key: "occupancy", label: "Ocupação" },
  { key: "lastCount", label: "Última contagem" },
];

function ease(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Mapa do CD na contagem de inventário.
 * Visão do CD: porta-paletes em perspectiva isométrica (SVG) montados dos endereços reais, com
 * piso, corredores pintados, rótulos de rua, cor por situação/ocupação/última contagem, seletor de
 * níveis e o marcador "Você" com a rota pontilhada até o próximo endereço a contar.
 * Ao escolher um endereço a câmera (viewBox) aproxima a rua e troca para a vista frontal reta.
 */
export function CdMap({
  map,
  inventoryId,
  canCount,
  now,
  kpiPanel,
}: {
  map: CdMapData;
  inventoryId: string;
  canCount: boolean;
  /** "agora" do servidor (ms), para a cor da última contagem ser igual no SSR e no cliente */
  now: number;
  kpiPanel?: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"overview" | "front">("overview");
  const [colorMode, setColorMode] = useState<ColorMode>("situation");
  const [level, setLevel] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [notFound, setNotFound] = useState(false);
  const selected = map.cells.find((c) => c.id === selectedId) ?? null;
  // "Avançar sozinho" (lembrado neste navegador) e foco no SKU ao chegar por avanço automático
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [arrivedId, setArrivedId] = useState<string | null>(null);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(AUTO_ADVANCE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preferência só existe no cliente
      if (saved !== null) setAutoAdvance(saved === "1");
    } catch {
      /* armazenamento indisponível: mantém o padrão */
    }
  }, []);
  const changeAutoAdvance = useCallback((on: boolean) => {
    setAutoAdvance(on);
    try {
      window.localStorage.setItem(AUTO_ADVANCE_KEY, on ? "1" : "0");
    } catch {
      /* ignora */
    }
  }, []);

  const route = useMemo(() => routeOrder(map), [map]);
  const you = useMemo(() => lastCountedCell(map), [map]);
  const next = useMemo(() => nextToCount(map, you?.id ?? null), [map, you]);
  const walk = useMemo(() => (next ? walkRoute(you, next) : null), [you, next]);

  const full = useMemo<ViewBox>(() => {
    const b = projectedBounds(map.cells.flatMap((c) => cellBox(c).corners));
    const floor = projectedBounds([project(-2.2, -1.2, 0), project(map.width + 0.8, -1.2, 0), project(-2.2, map.depth + 1.2, 0), project(map.width + 0.8, map.depth + 1.2, 0)]);
    const x0 = Math.min(b.x, floor.x);
    const y0 = Math.min(b.y, floor.y);
    const x1 = Math.max(b.x + b.w, floor.x + floor.w);
    const y1 = Math.max(b.y + b.h, floor.y + floor.h);
    return { x: x0 - FULL_PAD, y: y0 - FULL_PAD, w: x1 - x0 + FULL_PAD * 2, h: y1 - y0 + FULL_PAD * 2 };
  }, [map]);

  const [vb, setVb] = useState<ViewBox>(full);
  const vbRef = useRef(vb);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    vbRef.current = vb;
  }, [vb]);

  const animateTo = useCallback((target: ViewBox, done?: () => void) => {
    if (raf.current) cancelAnimationFrame(raf.current);
    const from = vbRef.current;
    if (prefersReducedMotion()) {
      setVb(target);
      done?.();
      return;
    }
    const start = performance.now();
    const step = (t0: number) => {
      const t = Math.min(1, (t0 - start) / ANIM_MS);
      const k = ease(t);
      setVb({ x: from.x + (target.x - from.x) * k, y: from.y + (target.y - from.y) * k, w: from.w + (target.w - from.w) * k, h: from.h + (target.h - from.h) * k });
      if (t < 1) raf.current = requestAnimationFrame(step);
      else {
        raf.current = null;
        done?.();
      }
    };
    raf.current = requestAnimationFrame(step);
  }, []);
  useEffect(() => () => void (raf.current && cancelAnimationFrame(raf.current)), []);

  const aisleTarget = useCallback(
    (cell: MapCell): ViewBox => {
      const row = map.cells.filter((c) => c.y === cell.y && c.zoneId === cell.zoneId);
      const b = projectedBounds(row.flatMap((c) => cellBox(c).corners));
      const pad = 30;
      return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    },
    [map],
  );

  const select = useCallback(
    (id: string | null, opts: { front?: boolean } = {}) => {
      setSelectedId(id);
      const cell = map.cells.find((c) => c.id === id);
      if (!cell || !(opts.front ?? true) || mode === "front") return;
      animateTo(aisleTarget(cell), () => setMode("front"));
    },
    [map, mode, animateTo, aisleTarget],
  );

  /** Após confirmar a contagem: próximo endereço pendente na rota (o atual ainda aparece pendente no mapa antigo). */
  const advanceFrom = useCallback(
    (fromId: string) => {
      const i = route.findIndex((c) => c.id === fromId);
      const todo = (c: MapCell) => c.id !== fromId && (c.situation === "pending" || c.situation === "recount");
      const target = route.slice(i + 1).find(todo) ?? route.slice(0, Math.max(0, i)).find(todo) ?? null;
      if (!target) return;
      const from = map.cells.find((c) => c.id === fromId);
      setArrivedId(target.id);
      if (from && from.y === target.y && from.zoneId === target.zoneId) {
        setSelectedId(target.id);
        return;
      }
      // outra rua: a câmera percorre o mapa até a rua do próximo endereço
      setMode("overview");
      if (from) setVb(aisleTarget(from));
      setSelectedId(target.id);
      requestAnimationFrame(() => animateTo(aisleTarget(target), () => setMode("front")));
    },
    [route, map, aisleTarget, animateTo],
  );

  const back = useCallback(() => {
    if (selected) setVb(aisleTarget(selected));
    setMode("overview");
    requestAnimationFrame(() => animateTo(full));
  }, [selected, aisleTarget, animateTo, full]);

  const live = selected
    ? `${selected.code}: ${SITUATION_LABELS[selected.situation]}, ocupação ${fmtPct(selected.occupancy * 100)}${mode === "front" ? `, vista frontal da rua ${selected.aisle}` : ""}`
    : "Nenhum endereço selecionado";

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const dirs: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    const dir = dirs[e.key];
    if (dir) {
      e.preventDefault();
      const n = neighbor(map, selectedId, dir);
      if (n) select(n, { front: mode === "front" });
      return;
    }
    if (e.key === "Enter" && selected && mode === "overview") {
      e.preventDefault();
      select(selected.id, { front: true });
    }
    if (e.key === "Escape" && mode === "front") {
      e.preventDefault();
      back();
    }
  }

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim().toUpperCase();
    if (!q) return;
    const hit = map.cells.find((c) => c.code.toUpperCase() === q) ?? map.cells.find((c) => c.code.toUpperCase().includes(q));
    setNotFound(!hit);
    if (hit) select(hit.id);
  }

  const drawOrder = useMemo(() => [...map.cells].sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z), [map]);
  const maxZ = Math.max(0, ...map.cells.map((c) => c.z));
  const ri = selected ? route.findIndex((c) => c.id === selected.id) : -1;
  const legend = legendFor(colorMode, map.blind);

  if (!map.cells.length) {
    return <p className="p-4 text-sm text-muted">O depósito não tem endereços cadastrados para desenhar o mapa.</p>;
  }

  const youPt = walk ? project(...walk.points[0], 0) : null;
  const selAnchor = selected && mode === "overview" ? cellBox(selected).anchor : null;

  return (
    <div className="grid overflow-hidden rounded-xl border border-line bg-[radial-gradient(ellipse_at_40%_45%,#0D163B_0%,#03061A_70%)] lg:grid-cols-[minmax(0,1fr)_380px]">
      <section aria-label="Mapa do CD" className="flex min-w-0 flex-col border-b border-line lg:border-r lg:border-b-0">
        <div className="flex flex-wrap items-center gap-2 px-3 pt-3 sm:px-4">
          {mode === "front" ? (
            <button type="button" onClick={back} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong px-3.5 text-sm text-fg-2 hover:bg-subtle">
              <ArrowLeft className="size-4" aria-hidden /> Visão do CD
            </button>
          ) : null}
          <div role="radiogroup" aria-label="Colorir endereços por" className="flex gap-0.5 rounded-full border border-line bg-surface p-1 text-[13px]">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={colorMode === m.key}
                onClick={() => setColorMode(m.key)}
                className={cn("rounded-full px-3 py-1.5", colorMode === m.key ? "bg-action font-semibold text-on-action" : "text-fg-2 hover:text-fg")}
              >
                {m.label}
              </button>
            ))}
          </div>
          <form onSubmit={onSearch} className="flex min-w-[200px] flex-1 items-center gap-2" role="search">
            <label htmlFor="cd-map-search" className="sr-only">
              Buscar ou ler endereço
            </label>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input
                id="cd-map-search"
                list="cd-map-codes"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setNotFound(false);
                }}
                placeholder="Buscar ou ler endereço…"
                autoComplete="off"
                className="input rounded-full pl-8 font-mono"
              />
              <datalist id="cd-map-codes">
                {map.cells.map((c) => (
                  <option key={c.id} value={c.code} />
                ))}
              </datalist>
            </div>
            <button type="submit" className="h-9 rounded-full border border-line-strong px-3.5 text-sm text-fg-2 hover:bg-subtle">
              Ir
            </button>
          </form>
          <div className="flex w-full flex-wrap gap-1.5 text-xs">
            {map.zones.map((z) => (
              <span key={z.id} className="rounded-full border border-line-strong px-3 py-1 text-fg-2">
                Zona {z.code} · {z.name}
              </span>
            ))}
          </div>
          {notFound ? (
            <p role="alert" className="w-full text-xs text-crit-fg">
              Endereço não encontrado neste depósito.
            </p>
          ) : null}
        </div>

        <div
          className="relative mt-1 outline-none focus-visible:ring-2 focus-visible:ring-focus"
          tabIndex={0}
          role="group"
          aria-roledescription="mapa do CD"
          aria-label="Mapa do CD. Use as setas para navegar entre endereços, Enter para ficar de frente para o porta-paletes e Esc para voltar à visão do CD."
          onKeyDown={onKey}
        >
          <p className="sr-only" aria-live="polite">
            {live}
          </p>
          <svg
            viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
            className={cn(
              "block h-[320px] w-full transition-opacity duration-300 motion-reduce:transition-none sm:h-[480px] xl:h-[560px]",
              mode === "front" ? "pointer-events-none opacity-0" : "opacity-100",
            )}
            role="img"
            aria-label={`CD em perspectiva isométrica: ${map.zones.length} zona(s), ${map.aisles.length} rua(s), ${map.cells.length} endereços — ${Object.entries(map.counts)
              .filter(([, n]) => n)
              .map(([k, n]) => `${n} ${SITUATION_LABELS[k as keyof typeof SITUATION_LABELS].toLowerCase()}`)
              .join(", ")}${next ? `. Próximo a contar: ${next.code}` : ""}`}
            aria-hidden={mode === "front"}
          >
            <defs>
              <radialGradient id="cdmap-glow">
                <stop offset="0" stopColor="#7DB7F0" stopOpacity="0.7" />
                <stop offset="1" stopColor="#7DB7F0" stopOpacity="0" />
              </radialGradient>
            </defs>
            {/* piso */}
            <polygon
              points={pts([project(-2.2, -1.2, 0), project(map.width + 0.8, -1.2, 0), project(map.width + 0.8, map.depth + 1.2, 0), project(-2.2, map.depth + 1.2, 0)])}
              fill="#0A1230"
              stroke="#172354"
            />
            {/* corredores pintados com faixa tracejada */}
            {map.aisles.map((a) => {
              const w = Math.max(1, a.bays.length);
              const y0 = a.y + 1.12;
              const y1 = a.y + 1.88;
              const s0 = project(-0.5, a.y + 1.5, 0);
              const s1 = project(w + 0.4, a.y + 1.5, 0);
              return (
                <g key={`lane-${a.key}`}>
                  <polygon points={pts([project(-0.5, y0, 0), project(w + 0.4, y0, 0), project(w + 0.4, y1, 0), project(-0.5, y1, 0)])} fill="#0F1B4A" />
                  <line x1={s0[0]} y1={s0[1]} x2={s1[0]} y2={s1[1]} stroke="#F8E2A6" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="10 8" />
                </g>
              );
            })}
            {drawOrder.map((c) => {
              if (level !== null && c.z > level) return null;
              return (
                <IsoBox
                  key={c.id}
                  cell={c}
                  colors={cellColors(c, colorMode, now)}
                  selected={c.id === selectedId}
                  dim={level !== null && c.z < level}
                  onSelect={() => select(c.id)}
                  title={`${c.code} — ${SITUATION_LABELS[c.situation]} · ocupação ${fmtPct(c.occupancy * 100)}${c.blocked ? " (bloqueado)" : ""}`}
                />
              );
            })}
            {/* rótulos de rua por cima das caixas */}
            {map.aisles.map((a) => {
              const p = project(-0.7, a.y + 0.5, 0);
              return (
                <text key={a.key} x={p[0] - 8} y={p[1] + 4} textAnchor="end" fill="#9DC7F4" className="font-mono text-[12px]">
                  RUA {a.aisle}
                </text>
              );
            })}
            {/* você + rota até o próximo endereço a contar */}
            {walk && youPt ? (
              <g aria-hidden>
                <polyline points={pts(walk.points.map(([x, y]) => project(x, y, 0)))} fill="none" stroke="#7DB7F0" strokeWidth={3} strokeDasharray="2 7" strokeLinecap="round" />
                <circle cx={youPt[0]} cy={youPt[1]} r={24} fill="url(#cdmap-glow)" />
                <circle cx={youPt[0]} cy={youPt[1]} r={6} fill="#7DB7F0" stroke="#03061A" strokeWidth={2} />
                <text x={youPt[0] + 12} y={youPt[1] + 24} fill="#9DC7F4" className="text-[12px]">
                  Você · {walk.meters} m até {next ? next.code.split("/").slice(1).join("/") : "o próximo"}
                </text>
              </g>
            ) : null}
            {selAnchor && selected ? (
              <g aria-hidden className="pointer-events-none">
                <line x1={selAnchor[0]} y1={selAnchor[1]} x2={selAnchor[0]} y2={selAnchor[1] - 40} stroke="#F8E2A6" strokeWidth={1.5} />
                <circle cx={selAnchor[0]} cy={selAnchor[1]} r={4} fill="#F8E2A6" />
                <rect x={selAnchor[0] - 8} y={selAnchor[1] - 84} width={236} height={46} rx={10} fill="#FFF8E7" />
                <text x={selAnchor[0] + 4} y={selAnchor[1] - 64} fill="#060B2A" className="font-mono text-[13px] font-medium">
                  {selected.code.split("/").slice(1).join("/")}
                </text>
                <text x={selAnchor[0] + 4} y={selAnchor[1] - 47} fill="#060B2A" className="text-[11px]">
                  Enter ou toque para ficar de frente
                </text>
              </g>
            ) : null}
          </svg>

          {selected ? (
            <div
              className={cn("absolute inset-0 transition-opacity duration-300 motion-reduce:transition-none", mode === "front" ? "opacity-100" : "pointer-events-none opacity-0")}
              aria-hidden={mode !== "front"}
            >
              {mode === "front" ? <FrontView map={map} cell={selected} level={level} colorMode={colorMode} now={now} onSelect={(id) => select(id)} /> : null}
            </div>
          ) : null}

          <div className="absolute top-2 right-2 flex flex-col gap-1 rounded-xl border border-line bg-surface/90 p-1.5 text-xs" role="radiogroup" aria-label="Nível">
            <button type="button" role="radio" aria-checked={level === null} onClick={() => setLevel(null)} className={cn("rounded-lg px-2.5 py-1.5", level === null ? "bg-accent font-semibold text-on-action" : "text-fg-2 hover:bg-subtle")}>
              Todos
            </button>
            {Array.from({ length: maxZ + 1 }, (_, i) => maxZ - i).map((z) => (
              <button
                key={z}
                type="button"
                role="radio"
                aria-checked={level === z}
                onClick={() => setLevel(level === z ? null : z)}
                className={cn("rounded-lg px-2.5 py-1.5 font-mono", level === z ? "bg-accent font-semibold text-on-action" : "text-fg-2 hover:bg-subtle")}
              >
                N{z + 1}
              </button>
            ))}
          </div>
        </div>

        <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-1 px-3 py-3 text-xs text-fg-2 sm:px-4" aria-label="Legenda">
          {mode === "front" ? <li className="text-fg">Volume interno = ocupação da posição</li> : null}
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px]" style={{ background: l.color }} aria-hidden />
              {l.label}
              {colorMode === "situation" ? (
                <strong className="tabular-nums">{map.counts[(Object.keys(SITUATION_LABELS) as (keyof typeof SITUATION_LABELS)[]).find((k) => SITUATION_LABELS[k] === l.label)!]}</strong>
              ) : null}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: SIT_COLORS.selected[1] }} aria-hidden /> Selecionado
          </li>
        </ul>
      </section>

      <aside className="min-w-0 bg-surface/60" aria-label={mode === "front" && selected ? "Endereço em foco" : "Indicadores do inventário"}>
        {mode === "front" && selected ? (
          <CellPanel
            key={selected.id}
            cell={selected}
            levels={map.aisles.find((a) => a.zoneId === selected.zoneId && a.y === selected.y)?.levels.length ?? 1}
            inventoryId={inventoryId}
            canCount={canCount}
            blind={map.blind}
            now={now}
            onClose={back}
            onPrev={ri > 0 ? () => select(route[ri - 1].id) : null}
            onNext={ri >= 0 && ri < route.length - 1 ? () => select(route[ri + 1].id) : next ? () => select(next.id) : null}
            autoAdvance={autoAdvance}
            onAutoAdvanceChange={changeAutoAdvance}
            onCounted={() => (autoAdvance ? advanceFrom(selected.id) : undefined)}
            focusScan={arrivedId === selected.id}
          />
        ) : (
          <>
            {next ? (
              <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="text-xs text-fg-2">Próximo a contar</p>
                  <p className="truncate font-mono text-sm text-accent">{next.code}</p>
                </div>
                <button type="button" onClick={() => select(next.id)} className="h-9 shrink-0 rounded-full bg-action px-4 text-sm font-semibold text-on-action hover:bg-action-hover">
                  Ir para
                </button>
              </div>
            ) : null}
            {kpiPanel}
          </>
        )}
      </aside>
    </div>
  );
}
