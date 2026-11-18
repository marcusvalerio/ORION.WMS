import { requireCtx } from "@/server/auth/session";
import { getKpis, getPerformance } from "@/server/services/dashboard";
import { listZones } from "@/server/services/warehouse";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { BlockBar } from "@/components/charts/block-bar";
import { GlyphGauge } from "@/components/charts/glyph-gauge";
import { TableWrap } from "@/components/ui/table";
import { ZONE_TYPE_LABELS } from "@/lib/labels";
import { fmtPct, fmtQty } from "@/lib/format";

export const metadata = { title: "Indicadores" };

export default async function IndicatorsPage() {
  const ctx = await requireCtx();
  const [performance, kpis, zones] = await Promise.all([getPerformance(ctx), getKpis(ctx), listZones(ctx)]);
  const occupancy = kpis.find((k) => k.key === "occupancy");
  return (
    <>
      <PageHeader
        title="Indicadores"
        description="Indicadores de desempenho calculados a partir dos registros. Quando ainda não há base de cálculo (ex.: nenhum pedido expedido), o valor aparece como “—”."
        breadcrumbs={[{ label: "Gestão" }, { label: "Indicadores" }]}
      />
      {occupancy ? (
        <div className="mb-3 rounded-lg border border-line bg-surface p-4">
          <GlyphGauge value={occupancy.value} label={occupancy.label} detail={`${occupancy.hint} · ${occupancy.definition}`} size={96} />
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {performance.map((p) => (
          <div key={p.label} className="rounded-lg border border-line bg-surface p-4">
            <p className="text-xs font-medium text-muted">{p.label}</p>
            <p className="mt-1 text-2xl font-semibold text-fg tabular-nums">
              {p.value === null ? "—" : p.unit === "%" ? fmtPct(p.value) : `${fmtQty(Math.round(p.value * 10) / 10)}${p.unit ? ` ${p.unit}` : ""}`}
            </p>
            <p className="mt-2 text-xs text-muted">{p.definition}</p>
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
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
                      <BlockBar used={z.occupied} capacity={z.capacity} label={`Zona ${z.code}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
        <Card>
          <CardHeader title="Definições dos indicadores do dashboard" />
          <dl className="divide-y divide-line">
            {kpis.map((k) => (
              <div key={k.key} className="grid grid-cols-1 gap-1 px-4 py-2.5 sm:grid-cols-3">
                <dt className="text-sm font-medium text-fg">{k.label}</dt>
                <dd className="text-xs text-fg-2 sm:col-span-2">{k.definition}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
