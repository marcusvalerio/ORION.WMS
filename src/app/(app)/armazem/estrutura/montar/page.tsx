import { requireCtx } from "@/server/auth/session";
import { assertCan } from "@/server/context";
import { layoutStartAisle, listWarehouses } from "@/server/services/warehouse";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { LayoutWizard } from "@/components/wms/layout-wizard";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MontarArmazemPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  assertCan(ctx, "warehouse.manage");
  const sp = await searchParams;
  const warehouses = (await listWarehouses(ctx)).filter((w) => w.active);
  const current = warehouses.find((w) => w.id === sp.wh) ?? warehouses[0];
  const startAisle = current ? await layoutStartAisle(ctx, current.id) : 1;

  return (
    <>
      <PageHeader
        title="Montar armazém"
        description="Descreva o armazém por áreas: o sistema cria as zonas e todos os endereços de uma vez, e o mesmo desenho aparece em 3D no inventário."
        breadcrumbs={[{ label: "Armazém" }, { label: "Estrutura física", href: "/armazem/estrutura" }, { label: "Montar armazém" }]}
      />
      {current ? (
        <LayoutWizard
          warehouses={warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
          warehouseId={current.id}
          startAisle={startAisle}
        />
      ) : (
        <EmptyState
          title="Cadastre um depósito primeiro"
          description="O assistente monta zonas e endereços dentro de um depósito."
          action={<ButtonLink href="/armazem/estrutura">Ir para Estrutura física</ButtonLink>}
        />
      )}
    </>
  );
}
