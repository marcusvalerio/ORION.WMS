"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { buildLayoutAction } from "@/server/actions/warehouse";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { fmtQty } from "@/lib/format";
import {
  AREA_KINDS,
  AREA_KIND_SPECS,
  LIMITS,
  TEMPLATES,
  newArea,
  planLayout,
  type AreaKind,
  type LayoutPlan,
  type WizardArea,
} from "@/lib/layout-wizard";

/** Três tons [topo, frente, lateral] por tipo de área — mesma luz do mapa do inventário. */
const KIND_COLORS: Record<AreaKind, readonly [string, string, string]> = {
  rack: ["#BCD9F8", "#4E97E3", "#2D77CC"],
  shelf: ["#FDEFCB", "#E0A100", "#B58E2E"],
  cold: ["#D7F0E8", "#12A27A", "#0B6B4F"],
  floor: ["#E4E8F0", "#A6B3C6", "#7E8BA2"],
  receiving: ["#DCE8F3", "#7E8BA2", "#5E6A82"],
  shipping: ["#DCE8F3", "#46516A", "#2E3850"],
  quarantine: ["#FDECEC", "#E03A45", "#A3202A"],
};

export function LayoutWizard({
  warehouses,
  warehouseId,
  startAisle,
}: {
  warehouses: { id: string; code: string; name: string }[];
  warehouseId: string;
  startAisle: number;
}) {
  const router = useRouter();
  const [areas, setAreas] = useState<WizardArea[]>(() => TEMPLATES[1].areas.map(newArea));
  const plan = useMemo(() => planLayout(areas, startAisle), [areas, startAisle]);
  const wh = warehouses.find((w) => w.id === warehouseId)!;

  const set = (i: number, patch: Partial<WizardArea>) => setAreas((a) => a.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const add = (kind: AreaKind) =>
    setAreas((a) => {
      const base = newArea(kind);
      const used = new Set(a.map((x) => x.code));
      let code = base.code;
      for (let n = 2; used.has(code); n++) code = `${base.code}${n}`;
      return [...a, { ...base, code }];
    });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      <div className="space-y-4">
        <Card>
          <CardHeader title="1. Depósito e modelo" description="Escolha onde montar e comece por um modelo parecido com o seu armazém." />
          <CardBody className="space-y-4">
            <label className="block">
              <span className="label">Depósito</span>
              <select
                className="input"
                value={warehouseId}
                onChange={(e) => router.push(`/armazem/estrutura/montar?wh=${e.target.value}`)}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className="label">Modelo</span>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setAreas(t.areas.map(newArea))}
                    className="rounded-lg border border-line bg-surface p-3 text-left hover:border-accent"
                  >
                    <span className="block text-sm font-medium text-fg">{t.label}</span>
                    <span className="block text-xs text-muted">{t.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="2. Áreas" description="Ajuste ruas, módulos, níveis e posições de cada área. A prévia ao lado muda na hora." />
          <CardBody className="space-y-3">
            {areas.map((a, i) => (
              <AreaEditor key={i} area={a} count={plan.perArea[i] ?? 0} onChange={(p) => set(i, p)} onRemove={() => setAreas((x) => x.filter((_, k) => k !== i))} />
            ))}
            <div>
              <span className="label">Adicionar área</span>
              <div className="flex flex-wrap gap-2">
                {AREA_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => add(k)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-fg-2 hover:bg-canvas"
                  >
                    <Plus className="size-3.5" aria-hidden />
                    {AREA_KIND_SPECS[k].label}
                  </button>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="space-y-4 lg:sticky lg:top-4">
        <Card>
          <CardHeader title="3. Prévia em 3D" description="O mesmo desenho do inventário: cada rua vira uma fileira, os módulos ficam lado a lado e os níveis viram a altura." />
          <CardBody className="space-y-3">
            <LayoutPreview areas={areas} plan={plan} />
            <div className="flex flex-wrap gap-3 text-xs text-fg-2">
              {[...new Set(areas.map((a) => a.kind))].map((k) => (
                <span key={k} className="flex items-center gap-1.5">
                  <i className="size-2.5 rounded-sm" style={{ background: KIND_COLORS[k][1] }} aria-hidden />
                  {AREA_KIND_SPECS[k].label}
                </span>
              ))}
            </div>
            <dl className="grid grid-cols-3 gap-2">
              {[
                ["Zonas", areas.length],
                ["Ruas", plan.aisles.length],
                ["Endereços", plan.total],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-lg border border-line p-3">
                  <dt className="text-xs font-medium text-muted">{k}</dt>
                  <dd className="text-[28px] leading-8 font-medium text-fg tabular-nums">{fmtQty(v as number)}</dd>
                </div>
              ))}
            </dl>
            {plan.aisles.length ? (
              <p className="font-mono text-xs text-fg-2">
                Ruas {plan.aisles.map((x) => x.aisle).join(", ")} · ex.: {wh.code}/RUA-{plan.aisles[0].aisle}/MOD-01/NIV-01/POS-00
              </p>
            ) : null}
            {plan.errors.length ? (
              <ul className="space-y-1 rounded-lg bg-warn-bg p-3 text-sm text-warn-fg">
                {plan.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
            <ActionForm action={buildLayoutAction} confirm={`Criar ${fmtQty(plan.total)} endereços em ${wh.code}?`}>
              <input type="hidden" name="warehouseId" value={warehouseId} />
              <input type="hidden" name="areas" value={JSON.stringify(areas)} />
              <SubmitButton disabled={plan.errors.length > 0 || plan.total === 0} className="w-full">
                Criar {fmtQty(plan.total)} endereços
              </SubmitButton>
            </ActionForm>
            <p className="text-xs text-muted">
              Nada é gravado antes de confirmar. Zonas com o mesmo código são reaproveitadas, e endereços que já existem são mantidos. Limite de{" "}
              {fmtQty(LIMITS.total)} endereços por montagem.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        className="input tabular-nums"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
      />
    </label>
  );
}

function AreaEditor({ area, count, onChange, onRemove }: { area: WizardArea; count: number; onChange: (p: Partial<WizardArea>) => void; onRemove: () => void }) {
  const spec = AREA_KIND_SPECS[area.kind];
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-3 flex items-center gap-2">
        <i className="size-3 shrink-0 rounded-sm" style={{ background: KIND_COLORS[area.kind][1] }} aria-hidden />
        <span className="text-sm font-medium text-fg">{spec.label}</span>
        <span className="truncate text-xs text-muted">{spec.hint}</span>
        <span className="ml-auto shrink-0 text-xs text-fg-2 tabular-nums">{fmtQty(count)} end.</span>
        <button type="button" onClick={onRemove} aria-label={`Remover ${area.name}`} className="rounded-full p-1 text-muted hover:bg-subtle hover:text-crit-fg">
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
        <label className="block min-w-0">
          <span className="label">Código da zona</span>
          <input className="input font-mono uppercase" maxLength={20} value={area.code} onChange={(e) => onChange({ code: e.target.value.toUpperCase() })} />
        </label>
        <label className="block min-w-0">
          <span className="label">Nome</span>
          <input className="input" maxLength={80} value={area.name} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
      </div>
      <div className={cn("mt-2 grid gap-2", spec.flat ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-5")}>
        {spec.flat ? (
          <NumberField label={area.kind === "receiving" || area.kind === "shipping" ? "Docas" : "Posições"} value={area.bays} min={1} max={LIMITS.bays} onChange={(v) => onChange({ bays: v })} />
        ) : (
          <>
            <NumberField label="Ruas" value={area.aisles} min={1} max={LIMITS.aisles} onChange={(v) => onChange({ aisles: v })} />
            <NumberField label="Módulos por rua" value={area.bays} min={1} max={LIMITS.bays} onChange={(v) => onChange({ bays: v })} />
            <NumberField label="Níveis" value={area.levels} min={1} max={LIMITS.levels} onChange={(v) => onChange({ levels: v })} />
          </>
        )}
        <NumberField label="Posições por nível" value={area.positions} min={1} max={LIMITS.positions} onChange={(v) => onChange({ positions: v })} />
        <NumberField label="Capacidade (un)" value={area.capacity} min={1} max={10_000_000} onChange={(v) => onChange({ capacity: v })} />
      </div>
    </div>
  );
}

/** Prévia isométrica (30°), na mesma lógica do mapa do inventário. */
function LayoutPreview({ areas, plan }: { areas: WizardArea[]; plan: LayoutPlan }) {
  const svg = useMemo(() => {
    const COS = Math.cos(Math.PI / 6);
    const U = 10;
    const BH = 7;
    const P = (x: number, y: number, z: number): [number, number] => [(x - y) * U * COS, (x + y) * U * 0.5 - z];
    type Item = { x: number; y: number; z: number; c: readonly [string, string, string]; flat: boolean };
    const items: Item[] = [];
    let y = 0;
    let prevArea = -1;
    let dockX = 0;
    const dockRow: Item[] = [];
    for (const pa of plan.aisles) {
      const area = areas[pa.areaIndex];
      const spec = AREA_KIND_SPECS[area.kind];
      const c = KIND_COLORS[area.kind];
      if (spec.flat && spec.locationType === "dock") {
        for (let b = 0; b < Math.min(pa.bays, 30); b++) dockRow.push({ x: dockX + b * 1.4, y: 0, z: 0, c, flat: true });
        dockX += Math.min(pa.bays, 30) * 1.4 + 2;
        continue;
      }
      if (prevArea !== -1 && prevArea !== pa.areaIndex) y += 1;
      prevArea = pa.areaIndex;
      const bays = Math.min(pa.bays, 60);
      const levels = Math.min(pa.levels, 12);
      for (let b = 0; b < bays; b++) for (let l = 0; l < levels; l++) items.push({ x: b, y, z: l, c, flat: spec.flat });
      y += 2;
    }
    for (const d of dockRow) items.push({ ...d, y: y + 1 });
    if (!items.length) return null;
    items.sort((a, b) => a.x + a.y - (b.x + b.y) || a.z - b.z);
    const pts = (a: [number, number][]) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const polys = items.map((it, i) => {
      const g = 0.12, x0 = it.x + g, x1 = it.x + 1 - g, y0 = it.y + g, y1 = it.y + 1 - g;
      const b = it.z * BH, t = b + (it.flat ? 2 : BH - 1.5);
      const top: [number, number][] = [P(x0, y0, t), P(x1, y0, t), P(x1, y1, t), P(x0, y1, t)];
      const front: [number, number][] = [P(x0, y1, b), P(x1, y1, b), P(x1, y1, t), P(x0, y1, t)];
      const side: [number, number][] = [P(x1, y0, b), P(x1, y1, b), P(x1, y1, t), P(x1, y0, t)];
      for (const [px, py] of [...top, ...front, ...side]) {
        minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      }
      return (
        <g key={i}>
          <polygon points={pts(side)} fill={it.c[2]} />
          <polygon points={pts(front)} fill={it.c[1]} />
          <polygon points={pts(top)} fill={it.c[0]} />
        </g>
      );
    });
    return { polys, vb: `${minX - 6} ${minY - 6} ${maxX - minX + 12} ${maxY - minY + 12}` };
  }, [areas, plan]);

  return (
    <div className="flex min-h-56 items-center justify-center rounded-lg bg-canvas p-2">
      {svg ? (
        <svg viewBox={svg.vb} className="h-auto max-h-80 w-full" role="img" aria-label={`Prévia do armazém com ${plan.total} endereços`}>
          {svg.polys}
        </svg>
      ) : (
        <p className="text-sm text-muted">Adicione uma área para ver a prévia.</p>
      )}
    </div>
  );
}
