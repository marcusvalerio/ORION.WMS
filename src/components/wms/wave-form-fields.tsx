"use client";

import { useState, type ReactNode } from "react";
import { Field, Input, Select } from "@/components/ui/fields";
import { SubmitButton } from "@/components/forms/action-form";
import { WAVE_GROUPING_LABELS } from "@/lib/labels";

/**
 * Campos do formulário de nova onda: a lista de docas acompanha o depósito escolhido.
 * Sem doca ativa no depósito, avisa e desabilita o envio. É só conveniência de interface —
 * o servidor continua validando a doca (ativa, de expedição e do mesmo depósito).
 */
export function WaveFormFields({
  warehouses,
  docks,
  children,
}: {
  warehouses: { id: string; label: string }[];
  docks: { id: string; code: string; warehouse_id: string }[];
  children?: ReactNode;
}) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [dockId, setDockId] = useState("");
  const options = docks.filter((d) => d.warehouse_id === warehouseId);
  const noDock = Boolean(warehouseId) && options.length === 0;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Depósito" required>
          <Select
            name="warehouseId"
            required
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setDockId("");
            }}
            options={warehouses.map((w) => ({ value: w.id, label: w.label }))}
          />
        </Field>
        <Field label="Agrupar por" required>
          <Select name="grouping" defaultValue="manual" options={Object.entries(WAVE_GROUPING_LABELS).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="Doca" hint="Destino dos volumes; também é o critério no agrupamento por doca.">
          <Select
            name="dockLocationId"
            value={dockId}
            onChange={(e) => setDockId(e.target.value)}
            disabled={noDock}
            placeholder={noDock ? "Nenhuma doca ativa" : "Primeira doca ativa"}
            options={options.map((d) => ({ value: d.id, label: d.code }))}
          />
        </Field>
        <Field label="Transportadora">
          <Input name="carrier" maxLength={120} />
        </Field>
        <Field label="Data prevista">
          <Input name="plannedDate" type="date" />
        </Field>
      </div>
      {children}
      {noDock ? (
        <p role="status" className="text-sm text-warn-fg">
          O depósito selecionado não tem doca de expedição ativa. Cadastre um endereço em zona de expedição (Armazém › Estrutura) para montar ondas.
        </p>
      ) : null}
      <SubmitButton disabled={noDock}>Criar onda</SubmitButton>
    </>
  );
}
