import { requireCtx } from "@/server/auth/session";
import { listReceipts } from "@/server/services/receiving";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { ReceiptTable } from "@/components/wms/receipt-table";

export const metadata = { title: "Conferência" };

export default async function CheckQueuePage() {
  const ctx = await requireCtx();
  const [checking, expected, checked] = await Promise.all([
    listReceipts(ctx, { status: "checking" }),
    listReceipts(ctx, { status: "expected" }),
    listReceipts(ctx, { status: "checked" }),
  ]);
  return (
    <>
      <PageHeader
        title="Fila de conferência"
        description="Recebimentos aguardando chegada/conferência e conferências finalizadas aguardando liberação do supervisor."
        breadcrumbs={[{ label: "Entrada" }, { label: "Conferência" }]}
      />
      <div className="space-y-5">
        <Card>
          <CardHeader title={`Em conferência (${checking.length})`} />
          <ReceiptTable rows={checking} emptyText="Nenhuma conferência em andamento" />
        </Card>
        <Card>
          <CardHeader title={`Aguardando chegada / início (${expected.length})`} />
          <ReceiptTable rows={expected} emptyText="Nenhum recebimento previsto" />
        </Card>
        <Card>
          <CardHeader title={`Conferidos, aguardando liberação (${checked.length})`} />
          <ReceiptTable rows={checked} emptyText="Nada aguardando liberação" />
        </Card>
      </div>
    </>
  );
}
