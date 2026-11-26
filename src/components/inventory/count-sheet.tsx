"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, CircleAlert, Lock, RotateCcw } from "lucide-react";
import { SubmitButton } from "@/components/forms/action-form";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { fmtDate, fmtQty } from "@/lib/format";
import { plural, shortLocation } from "@/lib/inventory-rules";

export interface SheetItem {
  id: string;
  location_code: string;
  aisle: string | null;
  bay: string | null;
  level: string | null;
  position: string | null;
  sku: string;
  description: string;
  uom: string;
  lot_code: string;
  expiry_date: string | null;
  lot_controlled: boolean;
  expiry_controlled: boolean;
  /** null durante a contagem: o servidor não envia o esperado (contagem cega) */
  expected_qty: number | null;
  counted_qty: number | null;
  notes: string | null;
  adjusted: boolean;
  status: string;
  round: number;
  empty_location: boolean;
  found: boolean;
  stock_origin: "available" | "blocked" | "quarantine";
  rounds: {
    round: number;
    counted_qty: number | null;
    counted_by_name: string;
  }[];
}

const STATUS_LABEL: Record<string, string> = {
  pending: "A contar",
  counting: "Em contagem",
  counted: "Contado",
  recount: "Recontar",
  closed: "Fechado",
};

function StatusChip({ status, round }: { status: string; round: number }) {
  const Icon =
    status === "counted" || status === "closed"
      ? Check
      : status === "recount"
        ? RotateCcw
        : status === "counting"
          ? Lock
          : null;
  const tone =
    status === "recount"
      ? "warning"
      : status === "counted" || status === "closed"
        ? "success"
        : status === "counting"
          ? "progress"
          : "neutral";
  return (
    <Badge tone={tone} className="whitespace-nowrap">
      {Icon ? <Icon className="mr-1 inline size-3" aria-hidden /> : null}
      {STATUS_LABEL[status] ?? status}
      {status === "recount" ? ` · ${round}ª` : ""}
    </Badge>
  );
}

const WIDE = "(min-width: 640px)";
function subscribeWide(cb: () => void) {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
/** Só um layout existe no DOM por vez (os campos não se repetem no formulário). */
function useWide() {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

const ORIGIN: Record<string, string> = {
  available: "Disponível",
  blocked: "Bloqueado",
  quarantine: "Quarentena",
};

/**
 * Folha de contagem. Durante a contagem "Esperado" mostra "oculto" (o servidor não
 * envia o valor). Linhas alteradas e não salvas ficam destacadas; a barra fixa
 * mostra quantas e salva; sair com alterações pede confirmação. Abaixo de 640 px
 * cada linha vira cartão.
 */
export function CountSheet({
  items,
  editable,
}: {
  items: SheetItem[];
  editable?: boolean;
}) {
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const wide = useWide();
  const showLot = items.some(
    (i) => i.lot_controlled || i.expiry_controlled || i.lot_code,
  );
  const showOrigin = items.some((i) => i.stock_origin !== "available");

  useEffect(() => {
    if (!dirty.size) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const mark = (id: string, changed: boolean) =>
    setDirty((d) => {
      const next = new Set(d);
      if (changed) next.add(id);
      else next.delete(id);
      return next;
    });

  const canEdit = (i: SheetItem) =>
    editable && !["counted", "closed"].includes(i.status);

  const expected = (i: SheetItem) =>
    i.expected_qty === null ? (
      <span className="text-muted italic">oculto</span>
    ) : (
      fmtQty(i.expected_qty)
    );
  const diffOf = (i: SheetItem) =>
    i.expected_qty === null || i.counted_qty === null
      ? null
      : i.counted_qty - i.expected_qty;
  const diffCell = (i: SheetItem) => {
    const d = diffOf(i);
    if (d === null) return <span className="text-muted">—</span>;
    if (d === 0) return <span className="text-muted">0</span>;
    return (
      <span className="font-medium text-crit-fg">
        <CircleAlert className="mr-1 inline size-3.5" aria-hidden />
        {d > 0 ? "+" : ""}
        {fmtQty(d)}
      </span>
    );
  };
  const input = (i: SheetItem, idx: number) =>
    canEdit(i) ? (
      <>
        <input type="hidden" name={`items.${idx}.itemId`} value={i.id} />
        <input
          name={`items.${idx}.countedQty`}
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          defaultValue=""
          onChange={(e) => mark(i.id, e.currentTarget.value !== "")}
          aria-label={`Contado ${i.sku} em ${i.location_code}`}
          className="input min-h-11 w-28 text-right tabular-nums focus:border-focus focus:ring-focus"
        />
      </>
    ) : (
      <span className="tabular-nums">{fmtQty(i.counted_qty)}</span>
    );

  return (
    <div>
      {/* telas ≥ 640 px: tabela */}
      {wide ? (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Endereço</th>
                <th>Produto</th>
                {showLot ? <th>Lote / validade</th> : null}
                {showOrigin ? <th>Origem do saldo</th> : null}
                <th className="num">Esperado</th>
                <th className="num">Contado</th>
                <th className="num">Diferença</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, idx) => (
                <tr
                  key={i.id}
                  className={cn(dirty.has(i.id) && "bg-accent-soft")}
                >
                  <td
                    className="font-mono text-sm whitespace-nowrap"
                    title={i.location_code}
                  >
                    {shortLocation({ ...i, code: i.location_code })}
                  </td>
                  <td>
                    <span className="font-mono whitespace-nowrap">{i.sku}</span>
                    {i.found ? (
                      <Badge tone="info" className="ml-1">
                        Encontrado
                      </Badge>
                    ) : null}
                    <span className="block text-xs text-muted">
                      {i.description}
                    </span>
                  </td>
                  {showLot ? (
                    <td className="text-xs whitespace-nowrap">
                      {i.lot_code || "—"} · {fmtDate(i.expiry_date)}
                    </td>
                  ) : null}
                  {showOrigin ? (
                    <td className="text-xs">{ORIGIN[i.stock_origin]}</td>
                  ) : null}
                  <td className="num">{expected(i)}</td>
                  <td className="num">{input(i, idx)}</td>
                  <td className="num">{diffCell(i)}</td>
                  <td>
                    <StatusChip status={i.status} round={i.round} />
                    {i.adjusted ? (
                      <Badge tone="success" className="ml-1">
                        Ajustado
                      </Badge>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="space-y-2 p-3">
          {items.map((i, idx) => (
            <li
              key={i.id}
              className={cn(
                "rounded-lg border border-line p-3",
                dirty.has(i.id) && "border-focus bg-accent-soft",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-sm" title={i.location_code}>
                  {shortLocation({ ...i, code: i.location_code })}
                </span>
                <StatusChip status={i.status} round={i.round} />
              </div>
              <p className="mt-1 font-mono">{i.sku}</p>
              <p className="text-xs text-muted">{i.description}</p>
              <div className="mt-2 flex items-end justify-between gap-3 text-sm">
                <span>
                  <span className="block text-xs text-muted">Esperado</span>
                  {expected(i)}
                </span>
                <span className="text-right">
                  <span className="block text-xs text-muted">Contado</span>
                  {input(i, idx)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editable ? (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3">
          <span
            className={cn("text-sm", dirty.size ? "text-fg" : "text-muted")}
            aria-live="polite"
          >
            {dirty.size
              ? `${plural(dirty.size, "linha alterada", "linhas alteradas")} sem salvar`
              : "Nenhuma alteração"}
          </span>
          <SubmitButton disabled={!dirty.size}>Salvar contagens</SubmitButton>
        </div>
      ) : null}
    </div>
  );
}
