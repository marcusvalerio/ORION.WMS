"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { CheckCircle2, Truck } from "lucide-react";
import {
  checkDestinationAction,
  checkOriginAction,
  checkProductAction,
  completeFromCollectorAction,
} from "@/server/actions/collector";
import { BigButton, FeedbackBanner, InfoRow, ScanField, StepDots, useFeedback } from "./kit";

export interface RunnerTask {
  id: string;
  code: string;
  task_type: "putaway" | "picking" | "transfer";
  sku: string | null;
  description: string | null;
  uom: string | null;
  lot_code: string;
  quantity: number | null;
  from_code: string | null;
  target_code: string | null;
  order_code: string | null;
}

type Step = "origin" | "destination" | "product" | "quantity" | "done";

const FLOWS: Record<RunnerTask["task_type"], Step[]> = {
  putaway: ["destination", "product", "quantity", "done"],
  transfer: ["origin", "destination", "product", "quantity", "done"],
  picking: ["origin", "product", "quantity", "done"],
};

const STEP_LABELS: Record<Step, string> = {
  origin: "Origem",
  destination: "Destino",
  product: "Produto",
  quantity: "Qtd.",
  done: "Fim",
};

/** Execução de uma tarefa no coletor, uma leitura por tela. */
export function TaskRunner({ task }: { task: RunnerTask }) {
  const flow = FLOWS[task.task_type];
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [scans, setScans] = useState<{ origin?: string; destination?: string; product?: string; productLabel?: string }>({});
  const [result, setResult] = useState<{ message: string; destination: string | null } | null>(null);
  const [notes, setNotes] = useState("");
  const { feedback, show } = useFeedback({
    tone: "info",
    text: task.task_type === "putaway" ? "Leia a etiqueta do endereço de destino." : "Leia a etiqueta do endereço de origem.",
  });
  const keyRef = useRef<string | null>(null);
  const step = flow[index];
  const next = () => setIndex((i) => i + 1);

  async function scanOrigin(code: string) {
    setBusy(true);
    const r = await checkOriginAction(task.id, code);
    setBusy(false);
    if (!r.ok) return show("error", r.message);
    setScans((s) => ({ ...s, origin: r.data.code }));
    show("ok", `${r.message} ${task.task_type === "transfer" ? "Leia o destino." : "Leia o produto."}`);
    next();
  }

  async function scanDestination(code: string) {
    setBusy(true);
    const r = await checkDestinationAction(task.id, code);
    setBusy(false);
    if (!r.ok) return show("error", r.message);
    setScans((s) => ({ ...s, destination: r.data.code }));
    show("ok", `${r.message} Leia o produto.`);
    next();
  }

  async function scanProduct(code: string) {
    setBusy(true);
    const r = await checkProductAction(task.id, code);
    setBusy(false);
    if (!r.ok) return show("error", r.message);
    setScans((s) => ({ ...s, product: r.data.code, productLabel: `${r.data.sku} — ${r.data.description}` }));
    show("ok", `${r.message} Confirme a quantidade.`);
    next();
  }

  async function confirmQuantity(value: string) {
    keyRef.current ??= crypto.randomUUID();
    setBusy(true);
    const r = await completeFromCollectorAction(
      task.id,
      {
        originCode: scans.origin,
        locationCode: scans.destination,
        productCode: scans.product!,
        quantity: value.replace(",", "."),
        notes: notes || undefined,
      },
      keyRef.current!,
    );
    setBusy(false);
    if (!r.ok) {
      keyRef.current = null;
      return show("error", r.message);
    }
    setResult({ message: r.message, destination: r.data.destinationCode });
    show("ok", r.message);
    next();
  }

  return (
    <div className="space-y-4">
      <StepDots steps={flow.map((s) => STEP_LABELS[s])} current={index} />
      <section className="rounded-xl border-2 border-line-strong bg-surface px-4 py-2">
        <InfoRow label="Produto">
          <strong className="font-mono">{task.sku}</strong> — {task.description}
          {task.lot_code ? <span className="block text-base text-fg-2">Lote {task.lot_code}</span> : null}
        </InfoRow>
        <InfoRow label="Quantidade" strong>
          {task.quantity} {task.uom}
        </InfoRow>
        {task.from_code ? (
          <InfoRow label="Origem" strong>
            {task.from_code}
          </InfoRow>
        ) : null}
        {task.task_type !== "picking" ? (
          <InfoRow label={task.task_type === "putaway" ? "Destino sugerido" : "Destino"} strong>
            {task.target_code ?? "sem sugestão elegível — leia um endereço"}
          </InfoRow>
        ) : (
          <InfoRow label="Levar para (doca)" strong>
            {task.target_code ?? "—"}
          </InfoRow>
        )}
      </section>

      <FeedbackBanner feedback={feedback} />

      {step === "origin" ? (
        <ScanField key="origin" label="Endereço de origem" hint={`Esperado: ${task.from_code}`} onScan={scanOrigin} busy={busy} />
      ) : null}
      {step === "destination" ? (
        <ScanField
          key="destination"
          label="Endereço de destino"
          hint={task.target_code ? `Sugerido: ${task.target_code}` : "Leia um endereço elegível"}
          onScan={scanDestination}
          busy={busy}
        />
      ) : null}
      {step === "product" ? (
        <ScanField key="product" label="Produto (EAN ou SKU)" hint={`Esperado: ${task.sku}`} onScan={scanProduct} busy={busy} />
      ) : null}
      {step === "quantity" ? (
        <div className="space-y-3">
          <p className="text-base text-fg-2">{scans.productLabel}</p>
          <ScanField
            key="quantity"
            label={`Quantidade (${task.uom ?? "un"})`}
            hint={
              task.task_type === "picking"
                ? "Informe o que foi separado. Menos que o pedido gera divergência e libera o restante da reserva."
                : "Confirme a quantidade total da tarefa."
            }
            numeric
            initial={String(task.quantity ?? "")}
            onScan={confirmQuantity}
            busy={busy}
            submitLabel={task.task_type === "picking" ? "Confirmar separação" : "Concluir tarefa"}
          />
          {task.task_type === "picking" ? (
            <label className="block">
              <span className="mb-1 block text-base font-semibold text-fg">Observação (se faltar)</span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-14 w-full rounded-xl border-2 border-line-strong px-3 text-lg"
                maxLength={300}
              />
            </label>
          ) : null}
          <BigButton variant="secondary" type="button" onClick={() => setIndex(0)}>
            Recomeçar leituras
          </BigButton>
        </div>
      ) : null}
      {step === "done" && result ? (
        <div className="space-y-4">
          {task.task_type === "picking" ? (
            <div className="flex items-center gap-3 rounded-xl border-2 border-fg bg-warn-solid p-4 text-fg">
              <Truck className="size-10 shrink-0" aria-hidden />
              <p className="text-xl font-bold">
                Leve à doca <span className="block font-mono text-2xl">{result.destination}</span>
                {task.order_code ? <span className="block text-base font-semibold">Pedido {task.order_code}</span> : null}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border-2 border-ok-solid bg-ok-bg p-4 text-ok-fg">
              <CheckCircle2 className="size-10 shrink-0" aria-hidden />
              <p className="text-xl font-bold">
                Guardado em <span className="block font-mono text-2xl">{result.destination}</span>
              </p>
            </div>
          )}
          <Link
            href="/coletor/tarefas"
            className="flex min-h-14 w-full items-center justify-center rounded-xl bg-action px-4 text-xl font-bold text-on-action"
          >
            Próxima tarefa
          </Link>
        </div>
      ) : null}
    </div>
  );
}
