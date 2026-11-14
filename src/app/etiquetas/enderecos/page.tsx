import { ArrowBigDown, ArrowBigUp } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { listWarehouses, listZones } from "@/server/services/warehouse";
import { listAisles, listLocationLabels, levelArrow, MAX_LOCATION_LABELS } from "@/server/services/labels";
import { Barcode128 } from "@/components/labels/barcode";
import { PrintToolbar } from "@/components/labels/print-toolbar";
import { isUuid, readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Etiquetas de endereço" };

export default async function LocationLabelsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const p = await readParams(searchParams);
  const ids = (p.ids ?? "").split(",").filter((x) => isUuid(x));
  const warehouseId = isUuid(p.warehouseId) ? p.warehouseId : null;
  const arrowMode = p.seta === "up" || p.seta === "down" || p.seta === "none" ? p.seta : "auto";
  const [warehouses, zones, aisles, result] = await Promise.all([
    listWarehouses(ctx),
    listZones(ctx, warehouseId),
    listAisles(ctx, warehouseId),
    listLocationLabels(ctx, {
      warehouseId,
      zoneId: isUuid(p.zoneId) ? p.zoneId : null,
      aisle: p.aisle ?? null,
      q: p.q ?? null,
      ids: ids.length ? ids : null,
    }),
  ]);
  const select = "h-9 rounded-md border border-line-strong bg-surface px-2 text-sm";
  return (
    <>
      <PrintToolbar backHref="/armazem/enderecos" title="Etiquetas de endereço" count={result.rows.length}>
        <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
          {ids.length ? <input type="hidden" name="ids" value={ids.join(",")} /> : null}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-2">Depósito</span>
            <select name="warehouseId" defaultValue={warehouseId ?? ""} className={select}>
              <option value="">Todos</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-2">Zona</span>
            <select name="zoneId" defaultValue={p.zoneId ?? ""} className={select}>
              <option value="">Todas</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.code} — {z.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-2">Rua</span>
            <select name="aisle" defaultValue={p.aisle ?? ""} className={select}>
              <option value="">Todas</option>
              {aisles.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-2">Código contém</span>
            <input name="q" defaultValue={p.q ?? ""} className={`${select} w-40`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-2">Seta</span>
            <select name="seta" defaultValue={arrowMode} className={select}>
              <option value="auto">Automática pelo nível</option>
              <option value="up">Para cima</option>
              <option value="down">Para baixo</option>
              <option value="none">Sem seta</option>
            </select>
          </label>
          <button type="submit" className="h-9 rounded-md border border-line-strong bg-surface px-3 font-medium hover:bg-canvas">
            Filtrar
          </button>
          {ids.length ? <span className="text-xs text-fg-2">Seleção: {ids.length} endereço(s)</span> : null}
        </form>
        {result.truncated ? (
          <p className="mt-2 text-sm text-warn-fg">Mostrando os primeiros {MAX_LOCATION_LABELS}. Refine o filtro para imprimir o restante.</p>
        ) : null}
      </PrintToolbar>
      {result.rows.length === 0 ? <p className="no-print text-center text-fg-2">Nenhum endereço no filtro.</p> : null}
      <div className="label-sheet">
        {result.rows.map((l) => {
          const arrow = arrowMode === "auto" ? levelArrow(l.level) : arrowMode;
          return (
            <div key={l.id} className="label flex" style={{ width: "100mm", height: "50mm", padding: "3mm" }}>
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="text-[8pt] leading-tight">
                  {l.warehouse_code} · Zona {l.zone_code} — {l.zone_name}
                </p>
                <p className="mt-0.5 flex gap-[3mm] font-mono leading-none font-bold">
                  <Seg k="RUA" v={l.aisle} />
                  <Seg k="MÓD" v={l.bay} />
                  <Seg k="NÍV" v={l.level} />
                  <Seg k="POS" v={l.position} />
                </p>
                <Barcode128 value={l.code} className="mt-auto" barHeight="17mm" />
              </div>
              {arrow !== "none" ? (
                <div className="ml-[2mm] flex w-[16mm] items-center justify-center" aria-label={arrow === "up" ? "Nível acima" : "Nível abaixo"}>
                  {arrow === "up" ? <ArrowBigUp className="size-[16mm]" fill="#000" /> : <ArrowBigDown className="size-[16mm]" fill="#000" />}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Seg({ k, v }: { k: string; v: string }) {
  return (
    <span className="flex flex-col items-center">
      <span className="text-[6pt] font-normal">{k}</span>
      <span className="text-[20pt]">{v}</span>
    </span>
  );
}
