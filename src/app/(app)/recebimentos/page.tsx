import { Download, PackagePlus } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { listReceipts, RECEIPT_STATUSES } from "@/server/services/receiving";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/fields";
import { ReceiptTable } from "@/components/wms/receipt-table";
import { STATUS } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Recebimentos" };

export default async function ReceiptsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  const rows = await listReceipts(ctx, { status: params.status, q: params.q });
  const qs = new URLSearchParams(Object.entries({ status: params.status, q: params.q }).filter(([, v]) => v) as [string, string][]);
  return (
    <>
      <PageHeader
        title="Recebimentos"
        description="Chegada física, conferência e liberação de mercadorias. Chegar não é liberar: o estoque só é criado quando a armazenagem é confirmada."
        breadcrumbs={[{ label: "Entrada" }, { label: "Recebimentos" }]}
        actions={
          <>
            {can(ctx.user.role, "receipt.create") ? (
              <ButtonLink href="/recebimentos/novo" variant="primary" size="sm">
                <PackagePlus className="size-4" /> Novo recebimento
              </ButtonLink>
            ) : null}
            {can(ctx.user.role, "reports.export") ? (
              <ButtonLink href={`/api/relatorios/recebimentos?${qs}`} size="sm" prefetch={false}>
                <Download className="size-4" /> CSV
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <Card>
        <FilterBar resetHref="/recebimentos">
          <FilterField label="Buscar" className="w-full sm:w-64">
            <Input name="q" defaultValue={params.q} placeholder="Código, fornecedor, pedido ou NF" />
          </FilterField>
          <FilterField label="Status">
            <Select name="status" defaultValue={params.status} placeholder="Todos" options={RECEIPT_STATUSES.map((s) => ({ value: s, label: STATUS.receipt[s].label }))} />
          </FilterField>
        </FilterBar>
        <ReceiptTable rows={rows} />
      </Card>
    </>
  );
}
