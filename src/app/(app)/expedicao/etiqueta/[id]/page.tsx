import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getShippingLabel } from "@/server/services/shipping-label";
import { PageHeader } from "@/components/ui/page-header";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { PrintButton } from "@/components/ui/print-button";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Etiqueta de expedição" };

export default async function ShippingLabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const { company, shipment, lines } = await getShippingLabel(ctx, id).catch(() => notFound());
  const total = lines.reduce((s, l) => s + l.shipped_qty, 0);
  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`Etiqueta ${shipment.code}`}
          description="Etiqueta de volume com os dados do remetente (razão social, CNPJ e endereço cadastrados em Dados da empresa)."
          breadcrumbs={[{ label: "Operações" }, { label: "Expedição", href: "/expedicao" }, { label: shipment.code }]}
          actions={
            <>
              <ButtonLink href="/expedicao">Voltar</ButtonLink>
              <PrintButton label="Imprimir etiqueta" />
            </>
          }
        />
        {!company.document_formatted || !company.address_line ? (
          <Alert level="warning" className="mb-4">
            Cadastro da empresa incompleto (CNPJ ou endereço). Um administrador pode completar em Gestão › Dados da empresa.
          </Alert>
        ) : null}
      </div>
      <article className="mx-auto max-w-[420px] rounded-md border-2 border-slate-900 bg-white p-4 text-slate-900 print:max-w-none print:border-black">
        <section className="border-b border-slate-900 pb-2">
          <p className="text-[10px] font-semibold tracking-wider uppercase">Remetente</p>
          <p className="text-sm font-bold">{company.display_name}</p>
          {company.document_formatted ? <p className="text-xs">CNPJ {company.document_formatted}</p> : null}
          {company.address_line ? <p className="text-xs">{company.address_line}</p> : null}
          {company.phone ? <p className="text-xs">Tel. {company.phone}</p> : null}
        </section>
        <section className="border-b border-slate-900 py-2">
          <p className="text-[10px] font-semibold tracking-wider uppercase">Destinatário</p>
          <p className="text-base font-bold">{shipment.customer_name}</p>
          {shipment.sales_order_number ? <p className="text-xs">Pedido ERP {shipment.sales_order_number}</p> : null}
        </section>
        <section className="grid grid-cols-2 gap-2 border-b border-slate-900 py-2 text-xs">
          <div>
            <p className="text-[10px] uppercase">Expedição</p>
            <p className="font-mono text-lg font-bold">{shipment.code}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase">Pedido WMS</p>
            <p className="font-mono text-sm font-semibold">{shipment.order_code}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase">Transportadora / placa</p>
            <p>
              {shipment.carrier ?? "—"} {shipment.vehicle_plate ? `· ${shipment.vehicle_plate}` : ""}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase">Documento</p>
            <p>{shipment.document_ref ?? "—"}</p>
          </div>
        </section>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-left">
              <th className="font-semibold">SKU</th>
              <th className="font-semibold">Descrição</th>
              <th className="text-right font-semibold">Qtd.</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.sku}>
                <td className="font-mono">{l.sku}</td>
                <td>{l.description}</td>
                <td className="text-right">
                  {fmtQty(l.shipped_qty)} {l.uom}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 flex justify-between border-t border-slate-900 pt-1 text-[11px]">
          <span>
            {shipment.warehouse_name} · {fmtDateTime(shipment.shipped_at)}
          </span>
          <span className="font-semibold">Total {fmtQty(total)}</span>
        </p>
      </article>
    </>
  );
}
