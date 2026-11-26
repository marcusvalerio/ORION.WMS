"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  countFromCollectorAction,
  inventoryLocationAction,
  inventorySummaryAction,
  resolveProductAction,
  submitFromCollectorAction,
} from "@/server/actions/collector";
import { BigButton, FeedbackBanner, ScanField, StepDots, useFeedback } from "./kit";
import { plural } from "@/lib/inventory-rules";

type Step = "location" | "product" | "quantity";

interface Summary {
  code: string;
  done: number;
  total: number;
  recount: { id: string; location_code: string; sku: string; round: number }[];
  canSubmit: boolean;
}

/** Progresso em barras (o traço do símbolo) com "42 de 72". */
function ProgressBars({ done, total }: { done: number; total: number }) {
  const bars = 24;
  const filled = total ? Math.round((done / total) * bars) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold tracking-wide text-fg-2 uppercase">Progresso</span>
        <span className="font-mono text-lg tabular-nums text-fg">
          {done.toLocaleString("pt-BR")} de {total.toLocaleString("pt-BR")}
        </span>
      </div>
      <div className="flex h-5 items-end gap-[3px]" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Itens contados">
        {Array.from({ length: bars }, (_, i) => (
          <span key={i} className={i < filled ? "h-full flex-1 rounded-[2px] bg-accent" : "h-2 flex-1 rounded-[2px] bg-line-strong"} />
        ))}
      </div>
    </div>
  );
}

/**
 * Contagem de inventário no coletor: endereço → produto → quantidade. Contagem
 * cega de verdade: o servidor não informa os SKUs previstos nem o saldo. Itens
 * fora da tolerância voltam em "A recontar" (2ª por outro operador, 3ª pelo
 * supervisor). Quando tudo fecha, aparece "Submeter para aprovação".
 */
export function CountRunner({ inventoryId, inventoryCode }: { inventoryId: string; inventoryCode: string }) {
  const [step, setStep] = useState<Step>("location");
  const [busy, setBusy] = useState(false);
  const [location, setLocation] = useState<{ code: string; recount: number } | null>(null);
  const [product, setProduct] = useState<{ code: string; sku: string; description: string; uom: string } | null>(null);
  const [lot, setLot] = useState("");
  const [needLot, setNeedLot] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const { feedback, show } = useFeedback({ tone: "info", text: `Inventário ${inventoryCode}: leia a etiqueta do endereço.` });
  const keyRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await inventorySummaryAction(inventoryId);
    if (r.ok) setSummary(r.data);
  }, [inventoryId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial do resumo vinda do servidor
    void refresh();
  }, [refresh]);

  async function scanLocation(code: string) {
    setBusy(true);
    const r = await inventoryLocationAction(inventoryId, code);
    setBusy(false);
    if (!r.ok) return show("error", r.message);
    setLocation({ code: r.data.code, recount: r.data.recount });
    show("ok", `${r.message} Leia um produto.`);
    setStep("product");
  }

  async function scanProduct(code: string) {
    setBusy(true);
    const r = await resolveProductAction(code);
    setBusy(false);
    if (!r.ok) return show("error", r.message);
    setProduct({ code, sku: r.data.sku, description: r.data.description, uom: r.data.uom });
    setNeedLot(false);
    setLot("");
    show("info", `${r.data.sku} · ${r.data.description}. Informe a quantidade contada.`);
    setStep("quantity");
  }

  async function confirm(value: string) {
    if (!location || !product) return;
    keyRef.current ??= crypto.randomUUID();
    setBusy(true);
    const qty = value.replace(",", ".");
    const r = await countFromCollectorAction(
      inventoryId,
      { locationCode: location.code, productCode: product.code, lotCode: lot.trim() || null, quantity: qty },
      keyRef.current,
    );
    setBusy(false);
    keyRef.current = null;
    if (!r.ok) {
      if (r.code === "LOT_REQUIRED") setNeedLot(true);
      return show("error", r.message);
    }
    const n = Number(qty);
    if (r.data.recount) show("error", r.message);
    else show("ok", `✓ ${n.toLocaleString("pt-BR")} ${product.uom} registradas. Leia o próximo produto ou troque de endereço.`);
    setProduct(null);
    setStep("product");
    void refresh();
  }

  async function submit() {
    setBusy(true);
    const r = await submitFromCollectorAction(inventoryId, crypto.randomUUID());
    setBusy(false);
    if (!r.ok) return show("error", r.message);
    setSubmitted(true);
    show("ok", "Inventário submetido para aprovação.");
  }

  if (submitted) {
    return (
      <div className="space-y-4">
        <FeedbackBanner feedback={feedback} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {summary ? <ProgressBars done={summary.done} total={summary.total} /> : null}
      {summary && summary.recount.length ? (
        <section aria-labelledby="recount-title" className="rounded-lg border border-warn-solid bg-warn-bg p-3 text-warn-fg">
          <h2 id="recount-title" className="flex items-center gap-2 font-display text-lg font-semibold">
            <RotateCcw className="size-5" aria-hidden /> A recontar · {plural(summary.recount.length, "item", "itens")}
          </h2>
          <ul className="mt-2 space-y-1">
            {summary.recount.slice(0, 8).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 text-base">
                <span className="font-mono whitespace-nowrap">{i.location_code}</span>
                <span className="text-sm">{i.round}ª contagem</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <StepDots steps={["Endereço", "Produto", "Qtd."]} current={step === "location" ? 0 : step === "product" ? 1 : 2} />
      <FeedbackBanner feedback={feedback} />
      {step === "location" ? <ScanField key="loc" label="Endereço" onScan={scanLocation} busy={busy} /> : null}
      {step === "product" && location ? (
        <>
          <p className="font-mono text-2xl text-fg">{location.code}</p>
          <p className="text-base text-fg-2">Contagem cega: leia cada produto que encontrar neste endereço.</p>
          <ScanField key="prod" label="Produto (EAN ou SKU)" onScan={scanProduct} busy={busy} />
          <BigButton variant="secondary" type="button" onClick={() => setStep("location")}>
            Trocar endereço
          </BigButton>
        </>
      ) : null}
      {step === "quantity" && product ? (
        <>
          <p className="text-lg text-fg">
            <strong className="font-mono">{product.sku}</strong> · {product.description}
          </p>
          {needLot ? (
            <label className="block">
              <span className="mb-1 block font-display text-lg font-semibold text-fg">Lote</span>
              <input
                value={lot}
                onChange={(e) => setLot(e.target.value.toUpperCase())}
                className="h-14 w-full rounded-lg border border-fg bg-surface px-3 font-mono text-xl text-fg"
              />
            </label>
          ) : null}
          <ScanField key="qty" label={`Quantidade contada (${product.uom})`} numeric onScan={confirm} busy={busy} submitLabel="Registrar contagem" />
          <BigButton variant="secondary" type="button" onClick={() => setStep("product")}>
            Voltar
          </BigButton>
        </>
      ) : null}
      {summary?.canSubmit ? (
        <BigButton variant="success" type="button" onClick={submit} disabled={busy}>
          Submeter para aprovação
        </BigButton>
      ) : null}
      {summary ? (
        <p className="text-center text-base text-fg-2">{plural(summary.done, "item contado", "itens contados")}</p>
      ) : null}
    </div>
  );
}
