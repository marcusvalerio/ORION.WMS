import { requireCtx } from "@/server/auth/session";
import { getKpis, getPerformance } from "@/server/services/dashboard";
import { listZones } from "@/server/services/warehouse";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { OccupancyBar } from "@/components/ui/occupancy";
import { TableWrap } from "@/components/ui/table";
import { ZONE_TYPE_LABELS } from "@/lib/labels";
import { fmtPct, fmtQty } from "@/lib/format";

export const metadata = { title: "Indicadores" };

export default async function IndicatorsPage() {
  const ctx = await requireCtx();
  const [performance, kpis, zones] = await Promise.all([getPerformance(ctx), getKpis(ctx), listZones(ctx)]);
  return (
    <>
      <PageHeader
        title="Indicadores"
        description="Indicadores de desempenho calculados a partir dos registros. Quando ainda não há base de cálculo (ex.: nenhum pedido expedido), o valor aparece como “—”."
        breadcrumbs={[{ label: "Gestão" }, { label: "Indicadores" }]}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {performance.map((p) => (
          <div key={p.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
            <p className="text-xs font-medium text-slate-500">{p.label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
              {p.value === null ? "—" : p.unit === "%" ? fmtPct(p.value) : `${fmtQty(Math.round(p.value * 10) / 10)}${p.unit ? ` ${p.unit}` : ""}`}
            </p>
            <p className="mt-2 text-xs text-slate-500">{p.definition}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Ocupação por zona" />
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Zona</th>
                  <th>Tipo</th>
                  <th className="num">Endereços</th>
                  <th>Ocupação</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.id}>
                    <td>
                      {z.warehouse_code} · <span className="font-medium">{z.code}</span> — {z.name}
                    </td>
                    <td>{ZONE_TYPE_LABELS[z.zone_type]}</td>
                    <td className="num">{z.location_count}</td>
                    <td>
                      <OccupancyBar used={z.occupied} capacity={z.capacity} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
        <Card>
          <CardHeader title="Definições dos indicadores do dashboard" />
          <dl className="divide-y divide-slate-100">
            {kpis.map((k) => (
              <div key={k.key} className="grid gap-1 px-4 py-2.5 sm:grid-cols-3">
                <dt className="text-sm font-medium text-slate-800">{k.label}</dt>
                <dd className="text-xs text-slate-600 sm:col-span-2">{k.definition}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
