"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import type { MapCell } from "@/lib/cd-map";
import { SITUATION_LABELS } from "@/lib/cd-map";
import { blockLayout, litCount } from "@/lib/charts";
import { recordCountsAction } from "@/server/actions/inventory";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { fmtDate, fmtPct, fmtQty } from "@/lib/format";
import { SIT_COLORS } from "./iso";

const BLOCKS = blockLayout(10, 100);

function lastCountText(at: number | null, now: number) {
  if (at === null) return "nunca contado";
  const days = Math.floor((now - at) / 86_400_000);
  const d = new Date(at).toISOString().slice(0, 10);
  return `${fmtDate(d)} · ${days <= 0 ? "hoje" : days === 1 ? "há 1 dia" : `há ${days} dias`}`;
}

/**
 * Painel do endereço em foco (vista frontal): código grande em Geist Mono, ocupação, nível,
 * última contagem, SKU lido, quantidade e as ações existentes — confirmar contagem e recontar
 * (limpar para contar de novo), ambas via recordCounts — além de anterior/próximo na rota.
 * Em contagem cega o saldo esperado, a diferença e as unidades em estoque não chegam ao cliente.
 */
export function CellPanel({
  cell,
  levels,
  inventoryId,
  canCount,
  blind,
  now,
  onClose,
  onPrev,
  onNext,
  autoAdvance,
  onAutoAdvanceChange,
  onCounted,
  focusScan = false,
}: {
  cell: MapCell;
  levels: number;
  inventoryId: string;
  canCount: boolean;
  blind: boolean;
  now: number;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  /** "Avançar sozinho": após confirmar a contagem, vai para o próximo endereço pendente. */
  autoAdvance: boolean;
  onAutoAdvanceChange: (on: boolean) => void;
  /** Contagem confirmada com sucesso neste endereço. */
  onCounted: () => void;
  /** Foca o campo de SKU ao abrir (chegada por avanço automático). */
  focusScan?: boolean;
}) {
  const [scan, setScan] = useState("");
  const scanRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusScan) return;
    // mantém o operador no fluxo de leitura: SKU primeiro; sem itens, a 1ª quantidade
    const target = scanRef.current ?? qtyRef.current?.querySelector<HTMLInputElement>("input[type=number]") ?? null;
    target?.focus({ preventScroll: true });
  }, [focusScan]);
  const editable = canCount && cell.items.some((i) => !i.adjusted);
  const counted = cell.items.filter((i) => i.counted !== null);
  const pct = cell.occupancy * 100;
  const lit = litCount(pct, BLOCKS.length);
  const q = scan.trim().toUpperCase();
  const match = q ? cell.items.find((i) => i.sku.toUpperCase() === q || (i.barcode ?? "").toUpperCase() === q) : null;

  return (
    <section className="flex flex-col gap-4 p-4 sm:p-5" aria-label={`Endereço ${cell.code}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-fg-2">Você está de frente para</p>
          <p className="mt-1 font-mono text-2xl font-medium tracking-tight break-words text-accent sm:leading-tight">
            {cell.code.split("/").map((part, i) => (
              <span key={i}>
                {i ? "/" : ""}
                {part}
                <wbr />
              </span>
            ))}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-fg" aria-label="Fechar endereço">
          <X className="size-4" />
        </button>
      </div>
      <p className="-mt-2 flex flex-wrap items-center gap-1.5 text-sm text-fg">
        <span className="h-3.5 w-1.5" style={{ background: SIT_COLORS[cell.situation][0] }} aria-hidden />
        {SITUATION_LABELS[cell.situation]}
        <span className="text-xs text-muted">· {cell.zoneName}</span>
        {cell.blocked ? <Badge tone="warning">Bloqueado</Badge> : null}
      </p>

      <div className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-fg-2">Ocupação da posição</span>
          <span className="font-display text-3xl font-medium tabular-nums">{fmtPct(pct)}</span>
        </div>
        <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="block h-3 w-full" role="img" aria-label={`Ocupação ${fmtPct(pct)}: ${lit} de ${BLOCKS.length} blocos`}>
          {BLOCKS.map((b, i) => (
            <rect key={i} x={b.x} y={0} width={b.w} height={6} rx={0.6} className={i < lit ? "fill-accent" : "fill-chart-off"} />
          ))}
        </svg>
        <span className="text-xs text-fg-2">
          {cell.onHand !== null && cell.capacity !== null
            ? `${fmtQty(cell.onHand)} de ${fmtQty(cell.capacity)} un${cell.occupancyBasis === "weight" ? " · limitado pelo peso máximo" : ""}`
            : blind
              ? "Contagem cega: ocupação arredondada, sem quantidades"
              : "Sem capacidade cadastrada"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 text-sm">
        <div className="rounded-xl bg-subtle/70 p-3">
          <span className="text-xs text-fg-2">Nível</span>
          <br />
          <b className="font-semibold">
            {cell.z + 1} de {levels}
          </b>
        </div>
        <div className="rounded-xl bg-subtle/70 p-3">
          <span className="text-xs text-fg-2">Última contagem</span>
          <br />
          <b className="font-semibold">{lastCountText(cell.lastCountedAt, now)}</b>
        </div>
      </div>

      {cell.items.length ? (
        <>
          <label className="flex flex-col gap-1.5 text-sm text-fg-2">
            SKU lido
            <input
              ref={scanRef}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              placeholder="Leia ou digite o SKU / código de barras"
              autoComplete="off"
              className="input h-11 font-mono"
            />
          </label>
          {q ? (
            match ? (
              <p className="-mt-2 flex items-center gap-1.5 text-xs text-ok-fg">
                <Check className="size-3.5" aria-hidden /> Confere: {match.sku} · {match.description}
              </p>
            ) : (
              <p className="-mt-2 text-xs text-warn-fg" role="alert">
                Este SKU não consta neste endereço. Se encontrou mercadoria aqui, use “Incluir item encontrado”.
              </p>
            )
          ) : null}
          {blind ? <p className="-mt-1 text-xs text-fg-2">Contagem cega: o saldo esperado não é exibido.</p> : null}

          {editable ? (
            <ActionForm
              action={recordCountsAction}
              className="space-y-3"
              key={cell.items.map((i) => `${i.id}:${i.counted}`).join("|")}
              onSuccess={onCounted}
            >
              <div ref={qtyRef} className="space-y-3">
              <input type="hidden" name="_id" value={inventoryId} />
              {cell.items.map((i, idx) => (
                <ItemBlock key={i.id} item={i} blind={blind} highlight={match?.id === i.id}>
                  <input type="hidden" name={`items.${idx}.itemId`} value={i.id} />
                  <input type="hidden" name={`items.${idx}.notes`} value={i.notes ?? ""} />
                  <label className="mt-2 block text-sm text-fg-2" htmlFor={`cnt-${i.id}`}>
                    Quantidade contada ({i.uom})
                  </label>
                  <input
                    id={`cnt-${i.id}`}
                    name={`items.${idx}.countedQty`}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    defaultValue={i.counted ?? ""}
                    className="input mt-1.5 h-14 border-2 border-accent font-mono text-2xl font-medium"
                  />
                </ItemBlock>
              ))}
              </div>
              <SubmitButton className="h-12 w-full rounded-full text-[15px]">Confirmar contagem</SubmitButton>
              <label className="flex items-center justify-center gap-2 text-xs text-fg-2">
                <input type="checkbox" checked={autoAdvance} onChange={(e) => onAutoAdvanceChange(e.target.checked)} className="size-4 accent-current" />
                Avançar sozinho para o próximo endereço pendente
              </label>
            </ActionForm>
          ) : (
            <div className="space-y-2">
              {cell.items.map((i) => (
                <ItemBlock key={i.id} item={i} blind={blind} highlight={match?.id === i.id} />
              ))}
            </div>
          )}
          {editable && counted.length ? (
            <ActionForm action={recordCountsAction} confirm={`Limpar a contagem de ${cell.code} para contar de novo?`}>
              <input type="hidden" name="_id" value={inventoryId} />
              {cell.items.map((i, idx) => (
                <span key={i.id}>
                  <input type="hidden" name={`items.${idx}.itemId`} value={i.id} />
                  <input type="hidden" name={`items.${idx}.countedQty`} value="" />
                  <input type="hidden" name={`items.${idx}.notes`} value={i.notes ?? ""} />
                </span>
              ))}
              <SubmitButton variant="secondary" size="sm" className="w-full rounded-full">
                Recontar este endereço
              </SubmitButton>
            </ActionForm>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-fg-2">Endereço fora do escopo deste inventário. Se encontrou mercadoria aqui, use “Incluir item encontrado”.</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPrev ?? undefined}
          disabled={!onPrev}
          className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-line-strong text-sm text-fg hover:bg-subtle disabled:opacity-40"
        >
          <ArrowLeft className="size-4" aria-hidden /> Anterior
        </button>
        <button
          type="button"
          onClick={onNext ?? undefined}
          disabled={!onNext}
          className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-line-strong text-sm text-fg hover:bg-subtle disabled:opacity-40"
        >
          Próximo <ArrowRight className="size-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}

function ItemBlock({ item, blind, highlight, children }: { item: MapCell["items"][number]; blind: boolean; highlight?: boolean; children?: React.ReactNode }) {
  return (
    <div className={cn("rounded-xl border bg-canvas/60 p-3", highlight ? "border-ok-solid" : "border-line")}>
      <p className="text-sm">
        <span className="font-mono font-medium text-fg">{item.sku}</span>
        {item.recount ? <Badge tone="warning" className="ml-1.5">Recontar</Badge> : null}
        {item.adjusted ? <Badge tone="success" className="ml-1.5">Ajustado</Badge> : null}
      </p>
      <p className="text-xs text-fg-2">{item.description}</p>
      <p className="mt-1 font-mono text-[11px] text-muted">
        Lote {item.lot || "—"} · validade {fmtDate(item.expiry)}
      </p>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted">Esperado</dt>
          <dd className="font-mono text-fg">{blind || item.expected === null ? "oculto" : `${fmtQty(item.expected)} ${item.uom}`}</dd>
        </div>
        <div>
          <dt className="text-muted">Contado</dt>
          <dd className="font-mono text-fg">{item.counted === null ? "—" : `${fmtQty(item.counted)} ${item.uom}`}</dd>
        </div>
        <div>
          <dt className="text-muted">Diferença</dt>
          <dd className={cn("font-mono", item.diff && item.diff < 0 ? "text-crit-fg" : item.diff && item.diff > 0 ? "text-warn-fg" : "text-fg")}>
            {blind || item.diff === null ? "—" : `${item.diff > 0 ? "+" : ""}${fmtQty(item.diff)}`}
          </dd>
        </div>
      </dl>
      {item.countedBy ? <p className="mt-1 text-[11px] text-muted">Contado por {item.countedBy}</p> : null}
      {children}
    </div>
  );
}
