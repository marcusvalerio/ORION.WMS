import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getPackingList } from "@/server/services/comex";
import { Barcode128 } from "@/components/labels/barcode";
import { PrintToolbar } from "@/components/labels/print-toolbar";
import { fmtQty } from "@/lib/format";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Etiquetas de volume (exportação)" };

/** Etiqueta bilíngue (PT/EN) 100×150 mm por volume de exportação. */
export default async function ExportPackageLabelsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const list = await getPackingList(ctx, id);
  if (!list || !list.order.is_export) notFound();
  const { order, company, packages, totals } = list;
  return (
    <>
      <PrintToolbar backHref={`/separacao/${id}`} title={`Etiquetas de volume — ${order.code}`} count={packages.length} />
      <div className="label-sheet">
        {packages.map((p) => (
          <div key={p.id} className="label label-break flex flex-col text-[9pt]" style={{ width: "100mm", height: "150mm", padding: "5mm" }}>
            <p className="font-bold">{company.legal_name ?? company.name}</p>
            <p className="mt-2 text-[7pt] uppercase">Destinatário / Consignee</p>
            <p className="text-[14pt] leading-tight font-bold">{order.customer_name}</p>
            <p>
              País de destino / Destination: <b>{order.destination_country ?? "—"}</b>
            </p>
            <p>
              Invoice: <b>{order.commercial_invoice ?? "—"}</b> · Incoterm: <b>{order.export_incoterm ?? "—"}</b>
            </p>
            <div className="mt-3 flex items-end justify-between border-y-[0.6mm] border-black py-2">
              <div>
                <p className="text-[7pt] uppercase">Volume / Package</p>
                <p className="text-[32pt] leading-none font-bold">
                  {p.package_no}
                  <span className="text-[14pt] font-normal"> de/of {totals.packages}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-[7pt] uppercase">Peso bruto / Gross</p>
                <p className="text-[14pt] font-bold">{fmtQty(p.gross_weight_kg)} kg</p>
                <p className="text-[7pt] uppercase">Peso líquido / Net</p>
                <p className="font-bold">{fmtQty(p.net_weight_kg)} kg</p>
              </div>
            </div>
            <p className="mt-1">
              Dimensões / Dimensions: {fmtQty(p.length_cm)} × {fmtQty(p.width_cm)} × {fmtQty(p.height_cm)} cm
            </p>
            <p className="mt-1 text-[7pt] uppercase">Conteúdo / Contents</p>
            <ul className="text-[8pt]">
              {p.items.slice(0, 5).map((i) => (
                <li key={`${i.order_line_id}${i.lot_code}`}>
                  {i.sku} — {fmtQty(i.quantity)} {i.uom}
                  {i.lot_code ? ` · lote/lot ${i.lot_code}` : ""}
                  {i.origin_country ? ` · origem/origin ${i.origin_country}` : ""}
                </li>
              ))}
              {p.items.length > 5 ? <li>+{p.items.length - 5} item(ns)/item(s)</li> : null}
            </ul>
            <Barcode128 value={`${order.code}-${String(p.package_no).padStart(3, "0")}`} className="mt-auto" barHeight="22mm" />
          </div>
        ))}
      </div>
    </>
  );
}
