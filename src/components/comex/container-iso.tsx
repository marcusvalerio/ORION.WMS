import { CONTAINERS, type ContainerLoad, type ContainerSpec } from "@/lib/container";
import { PALLETS, isPalletType, palletsPerLayer, type PalletType } from "@/lib/pallets";
import { fmtQty } from "@/lib/format";
import { cn } from "@/components/ui/cn";

/**
 * Contêiner em 3D isométrico (mesma projeção de 30° do mapa do inventário), em
 * fundo claro: paredes de fundo, carga em paletes do fundo para a porta e as
 * paredes da frente só em contorno, para a carga aparecer. Sem JavaScript.
 */
const COS = Math.cos(Math.PI / 6);
const SIN = 0.5;
type Pt = [number, number];
const P = (x: number, y: number, z: number, u: number): Pt => [(x - y) * u * COS, (x + y) * u * SIN - z * u];
const pts = (a: Pt[]) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

/** Tons [topo, frente, lateral] por nível de ocupação — a luz vem de cima. */
const TONES = {
  ok: ["#BCD9F8", "#4E97E3", "#2D77CC"],
  warning: ["#FDEFCB", "#E0A100", "#B58E2E"],
  over: ["#F5BDC0", "#E03A45", "#A3202A"],
} as const;

export function ContainerIso({
  spec,
  pct,
  level = "ok",
  compact = false,
  className,
  title,
  pallet = "PBR",
}: {
  spec: ContainerSpec;
  pct: number;
  /** palete da carga: define o tamanho de cada bloco no desenho */
  pallet?: PalletType;
  level?: ContainerLoad["level"];
  compact?: boolean;
  className?: string;
  title?: string;
}) {
  const u = 20;
  const { length: L, width: W, height: H } = spec;
  const all: Pt[] = [];
  const keep = (a: Pt[]) => (all.push(...a), a);

  const shadow = keep([P(-0.2, -0.2, 0, u), P(L + 0.5, -0.2, 0, u), P(L + 0.5, W + 0.5, 0, u), P(-0.2, W + 0.5, 0, u)]);
  const floor = keep([P(0, 0, 0, u), P(L, 0, 0, u), P(L, W, 0, u), P(0, W, 0, u)]);
  const back = keep([P(0, 0, 0, u), P(L, 0, 0, u), P(L, 0, H, u), P(0, 0, H, u)]);
  const left = keep([P(0, 0, 0, u), P(0, W, 0, u), P(0, W, H, u), P(0, 0, H, u)]);
  const front = keep([P(0, W, 0, u), P(L, W, 0, u), P(L, W, H, u), P(0, W, H, u)]);
  const right = keep([P(L, 0, 0, u), P(L, W, 0, u), P(L, W, H, u), P(L, 0, H, u)]);
  const roof = keep([P(0, 0, H, u), P(L, 0, H, u), P(L, W, H, u), P(0, W, H, u)]);

  // carga: paletes do tipo escolhido, do fundo para a porta, quantos couberem na largura,
  // empilhados até caber na altura
  const pal = PALLETS[pallet];
  const across = Math.max(1, Math.floor(W / pal.width));
  const PL = pal.length;
  const PW = W / across;
  const PH = Math.min(1.15, H / 2 - 0.04);
  const cols = Math.floor(L / PL);
  const levels = Math.max(1, Math.floor(H / (PH + 0.04)));
  const total = cols * across * levels;
  const n = Math.round((Math.min(Math.max(pct, 0), 100) / 100) * total);
  const order: [number, number, number][] = [];
  for (let c = 0; c < cols; c++) for (let z = 0; z < levels; z++) for (let r = 0; r < across; r++) order.push([c, r, z]);
  const [cTop, cFront, cSide] = TONES[level];
  const boxes = order
    .slice(0, n)
    .sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1])
    .map(([c, r, z]) => {
      const g = 0.05;
      const x0 = c * PL + g, x1 = (c + 1) * PL - g, y0 = r * PW + g, y1 = (r + 1) * PW - g;
      const z0 = z * (PH + 0.04) + 0.02, z1 = z0 + PH;
      return {
        key: `${c}-${r}-${z}`,
        top: [P(x0, y0, z1, u), P(x1, y0, z1, u), P(x1, y1, z1, u), P(x0, y1, z1, u)] as Pt[],
        front: [P(x0, y1, z0, u), P(x1, y1, z0, u), P(x1, y1, z1, u), P(x0, y1, z1, u)] as Pt[],
        side: [P(x1, y0, z0, u), P(x1, y1, z0, u), P(x1, y1, z1, u), P(x1, y0, z1, u)] as Pt[],
      };
    });

  const ribs: [Pt, Pt][] = [];
  if (!compact) for (let x = 0.3; x < L; x += 0.3) ribs.push([P(x, 0, 0.05, u), P(x, 0, H - 0.05, u)]);
  const doorMid: [Pt, Pt] = [P(L, W / 2, 0, u), P(L, W / 2, H, u)];
  const bars: [Pt, Pt][] = [W * 0.22, W * 0.36, W * 0.64, W * 0.78].map((y) => [P(L, y, 0.25, u), P(L, y, H - 0.25, u)]);

  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const vx = Math.min(...xs) - 4, vy = Math.min(...ys) - 4;
  const vw = Math.max(...xs) - vx + 4, vh = Math.max(...ys) - vy + 4;
  const stroke = compact ? 2.2 : 1.6;

  return (
    <svg
      viewBox={`${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}`}
      className={cn("block h-auto w-full", className)}
      role="img"
      aria-label={title ?? `Contêiner ${spec.label} ocupado em ${Math.round(pct)}%`}
    >
      <polygon points={pts(shadow)} fill="#060B2A" opacity={0.05} />
      <polygon points={pts(floor)} fill="#EDF2F8" stroke="#C7D3E2" />
      <polygon points={pts(back)} fill="#F7F9FC" stroke="#C7D3E2" />
      <polygon points={pts(left)} fill="#EEF3F9" stroke="#C7D3E2" />
      {ribs.map(([a, b], i) => (
        <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#DCE8F3" />
      ))}
      {boxes.map((b) => (
        <g key={b.key}>
          <polygon points={pts(b.side)} fill={cSide} />
          <polygon points={pts(b.front)} fill={cFront} />
          <polygon points={pts(b.top)} fill={cTop} />
        </g>
      ))}
      <polygon points={pts(front)} fill="#7DB7F0" fillOpacity={0.06} stroke="#060B2A" strokeWidth={stroke} strokeLinejoin="round" />
      <polygon points={pts(right)} fill="#7DB7F0" fillOpacity={0.1} stroke="#060B2A" strokeWidth={stroke} strokeLinejoin="round" />
      <polygon points={pts(roof)} fill="none" stroke="#060B2A" strokeWidth={stroke} strokeLinejoin="round" />
      <line x1={doorMid[0][0]} y1={doorMid[0][1]} x2={doorMid[1][0]} y2={doorMid[1][1]} stroke="#060B2A" strokeWidth={1.2} />
      {!compact
        ? bars.map(([a, b], i) => <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#46516A" />)
        : null}
    </svg>
  );
}

const LEVEL_BADGE: Record<ContainerLoad["level"], { label: string; cls: string }> = {
  ok: { label: "Com espaço", cls: "bg-ok-bg text-ok-fg before:bg-ok-solid" },
  warning: { label: "Quase cheio", cls: "bg-warn-bg text-warn-fg before:bg-warn-solid" },
  over: { label: "Excedido", cls: "bg-crit-bg text-crit-fg before:bg-crit-solid" },
};

export function LoadBadge({ level }: { level: ContainerLoad["level"] }) {
  const b = LEVEL_BADGE[level];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 text-xs leading-5 font-medium before:size-1.5 before:rounded-full", b.cls)}>
      {b.label}
    </span>
  );
}

function Blocks({ pct, level }: { pct: number; level: ContainerLoad["level"] }) {
  const on = Math.round(Math.min(pct, 100) / 10);
  const color = level === "over" ? "bg-crit-solid" : level === "warning" ? "bg-warn-solid" : "bg-chart-2";
  return (
    <span className="flex flex-1 gap-[3px]" aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={cn("h-2.5 flex-1 rounded-[2px]", i < on ? color : "bg-subtle")} />
      ))}
    </span>
  );
}

const pctText = (n: number) => `${Math.round(n)}%`;

/** Painel do processo: desenho grande e os números de volume e peso. */
export function ContainerPanel({ load, packages, pallet }: { load: ContainerLoad | null; packages?: number; pallet?: string | null }) {
  const pt = isPalletType(pallet) ? pallet : null;
  if (!load) {
    return (
      <div className="flex items-center gap-4 rounded-lg border border-dashed border-line-strong p-4">
        <div className="w-40 shrink-0 opacity-40">
          <ContainerIso spec={CONTAINERS["40DC"]} pct={0} compact />
        </div>
        <p className="text-sm text-fg-2">Informe o tipo do contêiner para ver quanto da capacidade esta carga ocupa.</p>
      </div>
    );
  }
  const cap = load.spec.length * load.spec.width * load.spec.height;
  return (
    <div className="grid gap-4 sm:grid-cols-[3fr_2fr] sm:items-center">
      <ContainerIso spec={load.spec} pct={load.pct} level={load.level} pallet={pt ?? "PBR"} className="max-h-64" />
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-muted">Ocupação do contêiner</p>
          <p className="text-[28px] leading-8 font-medium text-fg tabular-nums">
            {pctText(load.pct)} <span className="text-sm font-normal text-fg-2">de {load.spec.label}</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-2">
            <LoadBadge level={load.level} /> limite: {load.limit === "volume" ? "volume" : "peso"}
          </p>
        </div>
        <div className="grid grid-cols-[56px_1fr_44px] items-center gap-2 text-sm">
          <span className="text-fg-2">Volume</span>
          <Blocks pct={load.volumePct} level={load.level} />
          <span className="text-right tabular-nums">{pctText(load.volumePct)}</span>
          <span className="text-fg-2">Peso</span>
          <Blocks pct={load.weightPct} level={load.level} />
          <span className="text-right tabular-nums">{pctText(load.weightPct)}</span>
        </div>
        <p className="font-mono text-xs text-fg-2">
          {load.m3.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} m³ de {cap.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} m³ ·{" "}
          {fmtQty(Math.round(load.kg))} kg de {fmtQty(load.spec.payloadKg)} kg
          {packages ? ` · ${packages} volume${packages === 1 ? "" : "s"}` : ""}
        </p>
        {pt ? (
          <p className="text-xs text-fg-2">
            Palete {PALLETS[pt].label}: cabem {palletsPerLayer(pt, load.spec.length, load.spec.width)} por camada no {load.spec.label}.
          </p>
        ) : null}
        {load.missing > 0 ? (
          <p className="text-xs text-warn-fg">
            {load.missing} item{load.missing === 1 ? "" : "s"} sem dimensões ou peso no cadastro: a ocupação real é maior.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Versão compacta para a primeira coluna da lista do Comex. */
export function ContainerMini({ load, pallet }: { load: ContainerLoad | null; pallet?: string | null }) {
  if (!load) return <span className="text-xs text-muted">sem tipo</span>;
  return (
    <span className="flex w-24 flex-col gap-0.5" title={`${load.spec.label} · ${pctText(load.pct)} (limite: ${load.limit === "volume" ? "volume" : "peso"})`}>
      <ContainerIso spec={load.spec} pct={load.pct} level={load.level} pallet={isPalletType(pallet) ? pallet : "PBR"} compact />
      <span className="flex items-baseline justify-between text-xs">
        <span className="text-muted">{load.spec.label}</span>
        <span className={cn("font-medium tabular-nums", load.level === "over" ? "text-crit-fg" : load.level === "warning" ? "text-warn-fg" : "text-fg")}>
          {pctText(load.pct)}
        </span>
      </span>
    </span>
  );
}
