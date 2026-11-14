"use client";

import { useState } from "react";
import { lookupAction } from "@/server/actions/collector";
import type { LookupResult } from "@/server/services/collector";
import { FeedbackBanner, ScanField, useFeedback } from "./kit";

const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/** Consulta rápida: endereço → conteúdo; produto → onde está e quanto. */
export function Lookup() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const { feedback, show } = useFeedback({ tone: "info", text: "Leia um endereço ou um produto." });

  async function scan(code: string) {
    setBusy(true);
    const r = await lookupAction(code);
    setBusy(false);
    if (!r.ok) {
      setResult(null);
      return show("error", r.message);
    }
    setResult(r.data);
    show("ok", r.message);
  }

  return (
    <div className="space-y-4">
      <ScanField label="Endereço ou produto" onScan={scan} busy={busy} submitLabel="Consultar" />
      <FeedbackBanner feedback={feedback} />
      {result ? (
        <section className="rounded-xl border-2 border-line-strong bg-surface">
          <header className="border-b-2 border-line p-3">
            {result.kind === "location" ? (
              <p className="font-mono text-xl font-bold">{result.location.code}</p>
            ) : (
              <>
                <p className="text-lg">
                  <strong className="font-mono">{result.product.sku}</strong> — {result.product.description}
                </p>
                <p className="mt-1 text-xl font-bold">
                  Físico {fmt(result.total)} · Disponível {fmt(result.available)} {result.product.uom}
                </p>
              </>
            )}
          </header>
          {result.balances.length === 0 ? (
            <p className="p-3 text-lg text-fg-2">{result.kind === "location" ? "Endereço vazio." : "Sem saldo em nenhum endereço."}</p>
          ) : (
            <ul className="divide-y divide-line">
              {result.balances.map((b, i) => (
                <li key={i} className="p-3">
                  <p className="font-mono text-lg font-bold break-all">{result.kind === "location" ? b.sku : b.location_code}</p>
                  {result.kind === "location" ? <p className="text-sm text-fg-2">{b.description}</p> : null}
                  <p className="text-base text-fg">
                    {b.lot_code ? `Lote ${b.lot_code} · ` : ""}
                    {b.expiry_date ? `Val. ${b.expiry_date.split("-").reverse().join("/")} · ` : ""}
                    Físico <strong>{fmt(b.quantity)}</strong> · Disp. <strong>{fmt(b.available_qty)}</strong>
                    {b.reserved_qty ? ` · Res. ${fmt(b.reserved_qty)}` : ""}
                    {b.blocked_qty ? ` · Bloq. ${fmt(b.blocked_qty)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
