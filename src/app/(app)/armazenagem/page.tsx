import { requireCtx } from "@/server/auth/session";
import { listTasks } from "@/server/services/tasks";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { TaskTable } from "@/components/wms/task-table";

export const metadata = { title: "Armazenagem" };

export default async function PutawayPage() {
  const ctx = await requireCtx();
  const [open, done] = await Promise.all([
    listTasks(ctx, { type: "putaway", status: "pending,in_progress", sort: "priority", pageSize: 100 }),
    listTasks(ctx, { type: "putaway", status: "completed", sort: "-created", pageSize: 20 }),
  ]);
  return (
    <>
      <PageHeader
        title="Armazenagem"
        description="Mercadorias conferidas e liberadas aguardando endereçamento. O estoque é atualizado somente após a confirmação física do endereço."
        breadcrumbs={[{ label: "Entrada" }, { label: "Armazenagem" }]}
      />
      <div className="space-y-5">
        <Card>
          <CardHeader title={`Aguardando armazenagem (${open.total})`} description="Abra a tarefa para ver a sugestão de endereço e confirmar." />
          <TaskTable rows={open.rows} />
        </Card>
        <Card>
          <CardHeader title="Armazenagens concluídas recentemente" />
          <TaskTable rows={done.rows} />
        </Card>
      </div>
    </>
  );
}
