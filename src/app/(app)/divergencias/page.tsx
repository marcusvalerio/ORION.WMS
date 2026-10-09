import { Download } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { listDivergences } from "@/server/services/divergences";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Select } from "@/components/ui/fields";
import { DivergenceList } from "@/components/wms/divergence-list";
import { DIVERGENCE_SOURCE_LABELS } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Divergências" };

export default async function DivergencesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  const rows = await listDivergences(ctx, { status: params.status, source: params.source });
  const qs = new URLSearchParams(Object.entries({ status: params.status, source: params.source }).filter(([, v]) => v) as [string, string][]);
  return (
    <>
      <PageHeader
        title="Divergências"
        description="Faltas, sobras, avarias, retenções, separações a menor e diferenças de inventário. Divergências de inventário são tratadas pela aprovação do inventário."
        breadcrumbs={[{ label: "Entrada" }, { label: "Divergências" }]}
        actions={
          can(ctx.user.role, "reports.export") ? (
            <ButtonLink href={`/api/relatorios/divergencias?${qs}`} size="sm" prefetch={false}>
              <Download className="size-4" /> CSV
            </ButtonLink>
          ) : null
        }
      />
      <Card>
        <FilterBar resetHref="/divergencias">
          <FilterField label="Status" className="w-full sm:w-40">
            <Select
              name="status"
              defaultValue={params.status}
              placeholder="Todas"
              options={[
                { value: "open", label: "Em aberto" },
                { value: "resolved", label: "Tratadas" },
              ]}
            />
          </FilterField>
          <FilterField label="Origem" className="w-full sm:w-52">
            <Select name="source" defaultValue={params.source} placeholder="Todas" options={Object.entries(DIVERGENCE_SOURCE_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
          </FilterField>
        </FilterBar>
        <DivergenceList rows={rows} canResolve={can(ctx.user.role, "divergence.resolve")} showDocument />
      </Card>
    </>
  );
}
