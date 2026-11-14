import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getPackingList } from "@/server/services/comex";
import { PrintToolbar } from "@/components/labels/print-toolbar";
import { PACKAGE_TYPE_LABELS } from "@/lib/labels";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Packing list" };

/** Packing list bilíngue (PT/EN) por volume, para impressão em A4. */
export default async function PackingListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const list = await getPackingList(ctx, id);
  if (!list || !list.order.is_export) notFound();
  const { order, company, packages, totals } = list;
  const bi = (pt: string, en: string) => (
    <>
      {pt} <span className="font-normal italic">/ {en}</span>
    </>
  );

  return (
    <>
      <PrintToolbar backHref={`/separacao/${id}`} title={`Packing list — ${order.code}`} count={packages.length} />
      <article className="mx-auto max-w-[190mm] bg-white p-[8mm] text-[9pt] text-black print:p-0">
        <header className="flex items-start justify-between gap-4 border-b-[0.5mm] border-black pb-2">
          <div>
            <p className="text-[14pt] font-bold">{company.legal_name ?? company.name}</p>
            <p>{[company.address, company.city, company.state].filter(Boolean).join(" — ")}</p>
            {company.document ? <p>CNPJ {company.document}</p> : null}
          </div>
          <div className="text-right">
            <p className="text-[16pt] font-bold">PACKING LIST</p>
            <p>{bi("Romaneio de embalagem", "Packing list")}</p>
            <p className="font-mono">{order.code}</p>
            {order.packed_at ? <p>{fmtDateTime(order.packed_at)}</p> : <p className="font-bold">{bi("RASCUNHO", "DRAFT")}</p>}
          </div>
        </header>

        <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-1">
          {(
            [
              [bi("Destinatário", "Consignee"), order.customer_name],
              [bi("País de destino", "Country of destination"), order.destination_country],
              [bi("Incoterm 2020", "Incoterm 2020"), order.export_incoterm],
              [bi("Fatura comercial", "Commercial invoice"), order.commercial_invoice],
              [bi("RE / DU-E", "Export declaration"), order.export_declaration],
              [bi("Contêiner / lacre", "Container / seal"), order.container_number ? `${order.container_number} / ${order.seal_number}` : null],
            ] as const
          ).map(([k, v], i) => (
            <div key={i}>
              <dt className="text-[7pt] uppercase">{k}</dt>
              <dd className="font-bold">{v ?? "—"}</dd>
            </div>
          ))}
        </dl>

        <table className="mt-3 w-full border-collapse text-left">
          <thead>
            <tr className="border-y-[0.4mm] border-black text-[7pt] uppercase">
              <th className="py-1 pr-2">{bi("Vol.", "Pkg")}</th>
              <th className="pr-2">{bi("Item", "Item")}</th>
              <th className="pr-2">{bi("Descrição", "Description")}</th>
              <th className="pr-2">NCM / HS</th>
              <th className="pr-2">{bi("Lote", "Lot")}</th>
              <th className="pr-2">{bi("Origem", "Origin")}</th>
              <th className="pr-2 text-right">{bi("Qtd.", "Qty")}</th>
              <th className="pr-2 text-right">{bi("Líq. kg", "Net kg")}</th>
              <th className="pr-2 text-right">{bi("Bruto kg", "Gross kg")}</th>
              <th className="text-right">{bi("Dimensões cm", "Dimensions cm")}</th>
            </tr>
          </thead>
          <tbody>
            {packages.map((p) =>
              p.items.map((i, idx) => (
                <tr key={`${p.id}${i.order_line_id}${i.lot_code}`} className={idx === p.items.length - 1 ? "border-b-[0.2mm] border-black" : ""}>
                  {idx === 0 ? (
                    <td rowSpan={p.items.length} className="py-1 pr-2 align-top font-bold">
                      {p.package_no}
                      <span className="block text-[7pt] font-normal">{PACKAGE_TYPE_LABELS[p.package_type]}</span>
                    </td>
                  ) : null}
                  <td className="pr-2 align-top font-mono">{i.sku}</td>
                  <td className="pr-2 align-top">{i.description}</td>
                  <td className="pr-2 align-top font-mono">{i.ncm ?? "—"}</td>
                  <td className="pr-2 align-top font-mono">{i.lot_code || "—"}</td>
                  <td className="pr-2 align-top">{i.origin_country ?? "—"}</td>
                  <td className="pr-2 text-right align-top">
                    {fmtQty(i.quantity)} {i.uom}
                  </td>
                  {idx === 0 ? (
                    <>
                      <td rowSpan={p.items.length} className="pr-2 text-right align-top">
                        {fmtQty(p.net_weight_kg)}
                      </td>
                      <td rowSpan={p.items.length} className="pr-2 text-right align-top">
                        {fmtQty(p.gross_weight_kg)}
                      </td>
                      <td rowSpan={p.items.length} className="text-right align-top whitespace-nowrap">
                        {fmtQty(p.length_cm)} × {fmtQty(p.width_cm)} × {fmtQty(p.height_cm)}
                      </td>
                    </>
                  ) : null}
                </tr>
              )),
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-[0.4mm] border-black font-bold">
              <td className="py-1" colSpan={6}>
                {bi("Total", "Total")}: {totals.packages} {bi("volume(s)", "package(s)")} · {totals.volumeM3} m³
              </td>
              <td className="pr-2 text-right">{fmtQty(totals.quantity)}</td>
              <td className="pr-2 text-right">{fmtQty(totals.netWeightKg)}</td>
              <td className="pr-2 text-right">{fmtQty(totals.grossWeightKg)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <p className="mt-3 text-[7pt]">
          {bi(
            "Origem: país de origem registrado na importação do lote; “—” quando o lote não tem origem registrada no WMS.",
            "Origin: country of origin recorded at lot import; “—” when not recorded in the WMS.",
          )}
        </p>
      </article>
    </>
  );
}
