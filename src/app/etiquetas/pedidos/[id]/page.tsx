import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getShippingLabels, MAX_VOLUMES } from "@/server/services/labels";
import { Barcode128 } from "@/components/labels/barcode";
import { PrintToolbar } from "@/components/labels/print-toolbar";
import { DomainError } from "@/server/errors";
import { isUuid, readParams, type SearchParams } from "@/lib/params";
import { fmtQty } from "@/lib/format";

export const metadata = { title: "Etiquetas de volume" };

export default async function ShippingLabelsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const q = await readParams(searchParams);
  const volumes = Number(q.volumes ?? 1);
  let data: Awaited<ReturnType<typeof getShippingLabels>> = null;
  let error: string | null = null;
  try {
    data = await getShippingLabels(ctx, id, volumes);
    if (!data) notFound();
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    error = e.message;
  }
  return (
    <>
      <PrintToolbar backHref={`/separacao/${id}`} title={`Etiquetas de volume${data ? ` — ${data.order.code}` : ""}`} count={data?.labels.length ?? 0}>
        <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-fg-2">Quantidade de volumes</span>
            <input
              type="number"
              name="volumes"
              min={1}
              max={MAX_VOLUMES}
              step={1}
              defaultValue={Number.isFinite(volumes) ? volumes : 1}
              className="h-9 w-28 rounded-md border border-line-strong px-2"
            />
          </label>
          <button type="submit" className="h-9 rounded-md border border-line-strong bg-surface px-3 font-medium hover:bg-canvas">
            Gerar
          </button>
          {error ? <span className="text-sm text-crit-fg">{error}</span> : null}
        </form>
      </PrintToolbar>
      {data ? (
        <div className="label-sheet">
          {data.labels.map((l) => (
            <div key={l.index} className="label label-break flex flex-col" style={{ width: "100mm", height: "150mm", padding: "5mm" }}>
              <p className="text-[9pt]">
                {data.order.warehouse_code} — {data.order.warehouse_name}
              </p>
              <p className="mt-2 text-[8pt] uppercase">Pedido</p>
              <p className="font-mono text-[24pt] leading-none font-bold">{data.order.code}</p>
              {data.order.so_number ? <p className="text-[10pt]">Pedido de venda ERP: {data.order.so_number}</p> : null}
              <p className="mt-3 text-[8pt] uppercase">Cliente</p>
              <p className="text-[16pt] leading-tight font-bold">{data.order.customer_name}</p>
              <div className="mt-4 flex items-end justify-between border-y-[0.6mm] border-black py-2">
                <div>
                  <p className="text-[8pt] uppercase">Volume</p>
                  <p className="text-[36pt] leading-none font-bold">
                    {l.index}
                    <span className="text-[16pt] font-normal"> de {l.total}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[8pt] uppercase">Doca</p>
                  <p className="font-mono text-[11pt] font-bold break-all">{data.order.staging_code ?? "a definir"}</p>
                </div>
              </div>
              <p className="mt-2 text-[9pt]">
                {data.order.lines} item(ns) · {fmtQty(data.order.total_qty)} un no pedido
                {data.order.carrier ? ` · Transportadora: ${data.order.carrier}` : ""}
              </p>
              <Barcode128 value={l.barcode} className="mt-auto" barHeight="28mm" />
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
