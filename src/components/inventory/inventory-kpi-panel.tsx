import type { InventoryKpis } from "@/lib/inventory-kpis";
import { blockLayout, GAP, litCount, splitBar, strokeWidth } from "@/lib/charts";
import { fmtPct, fmtQty } from "@/lib/format";
import { cn } from "@/components/ui/cn";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pp = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pp`;
const hhmm = (ms: number) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(ms));

/** Escala dos ciclos: o eixo começa num piso (múltiplo de 5 abaixo do menor valor) para mostrar a variação. */
export function cycleScale(values: number[], target: number) {
  const lo = Math.min(target, ...values);
  const floor = Math.max(0, Math.floor((lo - 2) / 5) * 5);
  return { floor, ceil: 100 };
}

function Cycles({ k }: { k: InventoryKpis }) {
  const cycles = k.cycles.filter((c) => c.accuracy !== null);
  if (!cycles.length) return <p className="text-xs text-fg-2">Ainda não há inventário aprovado neste depósito para comparar.</p>;
  const { floor, ceil } = cycleScale(
    cycles.map((c) => c.accuracy!),
    k.target,
  );
  const W = 320;
  const H = 120;
  const top = 18;
  const inner = H - top;
  const slot = W / cycles.length;
  const y = (v: number) => H - ((v - floor) / (ceil - floor)) * inner;
  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H + 18}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Acuracidade dos últimos ${cycles.length} ciclos: ${cycles.map((c) => `${c.label} ${fmtPct(c.accuracy)}`).join(", ")}. Meta ${fmtPct(k.target)}. Eixo de ${floor}% a 100%.`}
      >
        <line x1={0} x2={W} y1={H} y2={H} className="stroke-line-strong" />
        <line x1={0} x2={W} y1={y(k.target)} y2={y(k.target)} className="stroke-accent" strokeDasharray="4 4" />
        <text x={0} y={y(k.target) - 4} className="fill-accent text-[10px]">
          meta {fmtPct(k.target)}
        </text>
        {cycles.map((c, i) => {
          const h = H - y(c.accuracy!);
          const bw = 12 + 10 * strokeWidth(i);
          const cx = slot * i + slot / 2;
          const fill = c.current ? "fill-accent" : "fill-ceu-400";
          return (
            <g key={c.id}>
              <title>{`${c.code} (${c.label}) — ${fmtPct(c.accuracy)} · ${c.divergences} divergência(s)`}</title>
              {splitBar(h, i, GAP).map(([a, b], j) => (
                <rect key={j} x={cx - bw / 2} y={H - b} width={bw} height={Math.max(1, b - a)} rx={1.5} className={fill} opacity={c.current ? 1 : 0.75} />
              ))}
              <text x={cx} y={H - h - 5} textAnchor="middle" className={cn("text-[10px] tabular-nums", c.current ? "fill-fg" : "fill-fg-2")}>
                {c.accuracy!.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              </text>
              <text x={cx} y={H + 14} textAnchor="middle" className="fill-fg-2 text-[10px]">
                {c.label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function Blocks({ value, total }: { value: number; total: number }) {
  const blocks = blockLayout(8, 100, 3);
  const lit = litCount(total ? (value / total) * 100 : 0, blocks.length);
  return (
    <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="block h-2 w-full" aria-hidden>
      {blocks.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={6} rx={0.8} className={i < lit ? "fill-ceu-400" : "fill-chart-off"} />
      ))}
    </svg>
  );
}

function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line bg-surface p-3.5">
      <span className="text-xs text-fg-2">{title}</span>
      {children}
    </div>
  );
}

/** Painel lateral de KPIs do inventário (dados calculados no servidor por `getInventoryKpis`). */
export function InventoryKpiPanel({ k }: { k: InventoryKpis }) {
  return (
    <div className="flex flex-col gap-3.5 p-4 sm:p-5">
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        <span className="text-[13px] font-medium text-fg-2">Acuracidade do inventário</span>
        {k.blind ? (
          <p className="text-sm text-fg-2">Oculta durante a contagem cega — aparece para o supervisor e após a submissão.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="font-display text-[40px] leading-none font-medium tabular-nums">{k.accuracy === null ? "—" : fmtPct(k.accuracy)}</span>
              {k.deltaPp !== null ? (
                <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", k.deltaPp >= 0 ? "bg-ok-bg text-ok-fg" : "bg-crit-bg text-crit-fg")}>{pp(k.deltaPp)}</span>
              ) : null}
            </div>
            <span className="text-xs text-fg-2">
              {k.previousAccuracy !== null ? `vs. ciclo anterior (${fmtPct(k.previousAccuracy)})` : "sem ciclo anterior"} · meta {fmtPct(k.target)}
            </span>
          </>
        )}
        <Cycles k={k} />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Tile title="Endereços contados">
          <span className="text-2xl font-medium tabular-nums">
            {k.locations.counted}
            <span className="text-[13px] text-fg-2"> / {k.locations.total}</span>
          </span>
          <Blocks value={k.locations.counted} total={k.locations.total} />
        </Tile>
        <Tile title="Divergências">
          {k.divergences === null ? (
            <span className="text-sm text-fg-2">Ocultas (cega)</span>
          ) : (
            <span className="text-2xl font-medium tabular-nums">
              {k.divergences}
              {k.divergencePct !== null ? <span className="text-[12px] text-crit-fg"> {fmtPct(k.divergencePct)} dos itens</span> : null}
            </span>
          )}
          <span className="text-xs text-fg-2">{k.previousDivergences !== null ? `ciclo anterior: ${k.previousDivergences}` : "sem ciclo anterior"}</span>
        </Tile>
        <Tile title="Ajuste em valor">
          {k.value === null ? (
            <span className="text-sm text-fg-2">Oculto (cega)</span>
          ) : (
            <>
              <span className="text-2xl font-medium tabular-nums">{k.value.net < 0 ? `−${brl(-k.value.net)}` : brl(k.value.net)}</span>
              <span className="text-xs text-fg-2">
                sobra {brl(k.value.surplus)} · falta {brl(k.value.shortage)}
                {k.value.unpriced ? ` · ${k.value.unpriced} sem preço` : ""}
              </span>
            </>
          )}
        </Tile>
        <Tile title="Ritmo">
          <span className="text-2xl font-medium tabular-nums">
            {k.pace.perHour === null ? "—" : fmtQty(k.pace.perHour)}
            <span className="text-[13px] text-fg-2"> end./h</span>
          </span>
          <span className="text-xs text-fg-2">
            {k.pace.eta ? `término previsto ${hhmm(k.pace.eta)}` : k.pace.remaining ? `${k.pace.remaining} endereço(s) restantes` : "contagem completa"}
          </span>
        </Tile>
      </div>

      <div className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4">
        <span className="text-xs text-fg-2">Acuracidade por zona</span>
        {k.zones.map((z) => {
          const blocks = blockLayout(10, 100, 3);
          const lit = z.accuracy === null ? 0 : litCount(z.accuracy, blocks.length);
          return (
            <div key={z.code} className="grid grid-cols-[minmax(0,6.5rem)_1fr_3.25rem] items-center gap-2.5 text-xs">
              <span className="truncate text-fg-2">
                {z.code} · {z.name}
              </span>
              <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="block h-2 w-full" role="img" aria-label={`Zona ${z.code}: ${z.accuracy === null ? "sem contagem" : fmtPct(z.accuracy)}`}>
                {blocks.map((b, i) => (
                  <rect key={i} x={b.x} y={0} width={b.w} height={6} rx={0.8} className={i < lit ? (z.accuracy! >= k.target ? "fill-ok-solid" : "fill-ceu-400") : "fill-chart-off"} />
                ))}
              </svg>
              <span className="text-right tabular-nums">{z.accuracy === null ? `${z.counted}/${z.total}` : fmtPct(z.accuracy)}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-muted">
        Acuracidade = itens contados sem diferença ÷ itens contados. Valor pelo último preço de compra. Ritmo = endereços concluídos por hora entre a primeira e a última contagem.
      </p>
    </div>
  );
}
