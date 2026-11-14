import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getProductLabel } from "@/server/services/labels";
import { Barcode128 } from "@/components/labels/barcode";
import { PrintToolbar } from "@/components/labels/print-toolbar";
import { isUuid, readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Etiqueta de produto" };

export default async function ProductLabelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const product = await getProductLabel(ctx, id);
  if (!product) notFound();
  const q = await readParams(searchParams);
  const copies = Math.min(Math.max(Number(q.copias) || 1, 1), 100);
  const withPackaging = q.embalagens === "1";
  const labels = [
    ...Array.from({ length: copies }, () => ({ title: product.uom, code: product.barcode ?? product.sku, units: null as number | null })),
    ...(withPackaging
      ? product.packaging.map((p) => ({ title: `${p.code} — ${p.description}`, code: p.barcode ?? `${product.sku}-${p.code}`, units: p.units_per_package }))
      : []),
  ];
  return (
    <>
      <PrintToolbar backHref={`/produtos/${product.id}`} title={`Etiqueta de produto ${product.sku}`} count={labels.length}>
        <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-600">Cópias</span>
            <input type="number" name="copias" min={1} max={100} defaultValue={copies} className="h-9 w-24 rounded-md border border-slate-300 px-2" />
          </label>
          {product.packaging.length ? (
            <label className="flex h-9 items-center gap-2">
              <input type="checkbox" name="embalagens" value="1" defaultChecked={withPackaging} /> Incluir embalagens ({product.packaging.length})
            </label>
          ) : null}
          <button type="submit" className="h-9 rounded-md border border-slate-300 bg-white px-3 font-medium hover:bg-slate-50">
            Atualizar
          </button>
          {!product.barcode ? <span className="text-xs text-amber-700">Produto sem EAN no ERP: o código de barras usa o SKU.</span> : null}
        </form>
      </PrintToolbar>
      <div className="label-sheet">
        {labels.map((l, i) => (
          <div key={i} className="label flex flex-col" style={{ width: "100mm", height: "50mm", padding: "3mm" }}>
            <p className="font-mono text-[18pt] leading-none font-bold">{product.sku}</p>
            <p className="mt-1 line-clamp-2 text-[10pt] leading-tight">{product.description}</p>
            <p className="text-[8pt]">
              {l.units ? `Embalagem ${l.title} · ${l.units} ${product.uom}` : `Unidade: ${l.title}`}
              {product.category ? ` · ${product.category}` : ""}
            </p>
            <Barcode128 value={l.code} className="mt-auto" barHeight="16mm" />
          </div>
        ))}
      </div>
    </>
  );
}
