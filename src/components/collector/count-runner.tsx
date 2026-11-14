"use client";

import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { countFromCollectorAction, inventoryLocationAction, resolveProductAction } from "@/server/actions/collector";
import { BigButton, FeedbackBanner, ScanField, StepDots, useFeedback } from "./kit";

interface LocItem {
  id: string;
  sku: string;
  description: string;
  uom: string;
  lot_code: string;
  counted: boolean;
}

type Step = "location" | "product" | "quantity";

/**
 * Contagem de inventário no coletor: lê o endereço, depois produtos e quantidades
 * em sequência. Contagem cega: o saldo esperado não é mostrado.
 */
export function CountRunner({ inventoryId, inventoryCode }: { inventoryId: string; inventoryCode: string }) {
  const [step, setStep] = useState<Step>("location");
  const [busy, setBusy] = useState(false);
  const [location, setLocation] = useState<{ code: string; items: LocItem[] } | null>(null);
  const [product, setProduct] = useState<{ code: string; sku: string; description: string; uom: string } | null>(null);
  const [lot, setLot] = useState("");
  const [needLot, setNeedLot] = useState(false);
  const { feedback, show } = useFeedback({ tone: "info", text: `Inventário ${inventoryCode}: leia a etiqueta do endereço.` });
  const keyRef = useRef<string | null>(null);

  async function scanLocation(code: string) {
    setBusy(true);
    const r = await inventoryLocationAction(inventoryId, code);
    setBusy(false);
    if (!r.ok) return show("error", r.message);
    setLocation(r.data);
    show("ok", `${r.message} Leia um produto.`);
    setStep("product");
  }

  async function scanProduct(code: string) {
    setBusy(true);
    const r = await resolveProductAction(code);
    setBusy(false);
    if (!r.ok) return show("error", r.message);
    setProduct({ code, sku: r.data.sku, description: r.data.description, uom: r.data.uom });
    const lots = location?.items.filter((i) => i.sku === r.data.sku).map((i) => i.lot_code) ?? [];
    setNeedLot(lots.length > 1);
    setLot(lots.length === 1 ? lots[0] : "");
    show("ok", `${r.data.sku} — ${r.data.description}. Informe a quantidade contada.`);
    setStep("quantity");
  }

  async function confirm(value: string) {
    if (!location || !product) return;
    keyRef.current ??= crypto.randomUUID();
    setBusy(true);
    const r = await countFromCollectorAction(
      inventoryId,
      { locationCode: location.code, productCode: product.code, lotCode: lot.trim() || (needLot ? "" : null), quantity: value.replace(",", ".") },
      keyRef.current,
    );
    setBusy(false);
    keyRef.current = null;
    if (!r.ok) {
      if (r.code === "LOT_REQUIRED") setNeedLot(true);
      return show("error", r.message);
    }
    show("ok", `${r.message} Leia o próximo produto.`);
    setLocation((l) =>
      l
        ? {
            ...l,
            items: l.items.some((i) => i.id === r.data.itemId)
              ? l.items.map((i) => (i.id === r.data.itemId ? { ...i, counted: true } : i))
              : [...l.items, { id: r.data.itemId, sku: r.data.sku, description: product.description, uom: product.uom, lot_code: r.data.lotCode, counted: true }],
          }
        : l,
    );
    setProduct(null);
    setStep("product");
  }

  const lotsHere = location?.items.filter((i) => product && i.sku === product.sku).map((i) => i.lot_code) ?? [];

  return (
    <div className="space-y-4">
      <StepDots steps={["Endereço", "Produto", "Qtd."]} current={step === "location" ? 0 : step === "product" ? 1 : 2} />
      <FeedbackBanner feedback={feedback} />
      {step === "location" ? <ScanField key="loc" label="Endereço" onScan={scanLocation} busy={busy} /> : null}
      {step === "product" && location ? (
        <>
          <p className="font-mono text-xl font-bold text-slate-950">{location.code}</p>
          <ScanField key="prod" label="Produto (EAN ou SKU)" onScan={scanProduct} busy={busy} />
          <ul className="divide-y divide-slate-200 rounded-xl border-2 border-slate-300 bg-white">
            {location.items.length === 0 ? <li className="p-3 text-base text-slate-700">Nenhum item previsto neste endereço.</li> : null}
            {location.items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 p-3 text-base">
                <span>
                  <strong className="font-mono">{i.sku}</strong> {i.lot_code ? `· lote ${i.lot_code}` : ""}
                  <span className="block text-sm text-slate-600">{i.description}</span>
                </span>
                {i.counted ? (
                  <span className="flex items-center gap-1 font-bold text-emerald-800">
                    <Check className="size-5" aria-hidden /> contado
                  </span>
                ) : (
                  <span className="font-semibold text-amber-800">a contar</span>
                )}
              </li>
            ))}
          </ul>
          <BigButton variant="secondary" type="button" onClick={() => setStep("location")}>
            Trocar endereço
          </BigButton>
        </>
      ) : null}
      {step === "quantity" && product ? (
        <>
          <p className="text-lg text-slate-900">
            <strong className="font-mono">{product.sku}</strong> — {product.description}
          </p>
          {needLot || lotsHere.length > 1 ? (
            <label className="block">
              <span className="mb-1 block text-lg font-bold text-slate-900">Lote</span>
              <input
                list="lots-here"
                value={lot}
                onChange={(e) => setLot(e.target.value.toUpperCase())}
                className="h-14 w-full rounded-xl border-2 border-slate-900 px-3 font-mono text-xl"
              />
              <datalist id="lots-here">
                {lotsHere.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </label>
          ) : null}
          <ScanField key="qty" label={`Quantidade contada (${product.uom})`} numeric onScan={confirm} busy={busy} submitLabel="Registrar contagem" />
          <BigButton variant="secondary" type="button" onClick={() => setStep("product")}>
            Voltar
          </BigButton>
        </>
      ) : null}
    </div>
  );
}
