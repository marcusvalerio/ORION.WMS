import Link from "next/link";
import { Download } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { listTasks, TASK_STATUSES, TASK_TYPES } from "@/server/services/tasks";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/fields";
import { Pagination } from "@/components/ui/table";
import { TaskTable } from "@/components/wms/task-table";
import { STATUS, TASK_TYPE_LABELS } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { pageNumber, readParams, type SearchParams } from "@/lib/params";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Tarefas" };

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  const result = await listTasks(ctx, {
    type: params.type,
    status: params.status,
    priority: params.priority,
    assigned: params.assigned as "me" | "none" | undefined,
    q: params.q,
    sort: params.sort,
    page: pageNumber(params.page),
  });
  const quick = [
    { label: "Abertas", qs: "status=pending,in_progress" },
    { label: "Minhas", qs: "status=pending,in_progress&assigned=me" },
    { label: "Sem responsável", qs: "status=pending&assigned=none" },
    { label: "Concluídas", qs: "status=completed&sort=-created" },
    { label: "Todas", qs: "" },
  ];
  const currentQs = new URLSearchParams(Object.entries({ status: params.status, assigned: params.assigned, sort: params.sort }).filter(([, v]) => v) as [string, string][]).toString();
  const exportQs = new URLSearchParams(Object.entries({ status: params.status, type: params.type, q: params.q }).filter(([, v]) => v) as [string, string][]);

  return (
    <>
      <PageHeader
        title="Central de tarefas"
        description="Armazenagem, transferência, inventário e separação. Abra uma tarefa para executar: tarefas concluídas não podem ser reexecutadas."
        breadcrumbs={[{ label: "Operações" }, { label: "Tarefas" }]}
        actions={
          can(ctx.user.role, "reports.export") ? (
            <ButtonLink href={`/api/relatorios/tarefas?${exportQs}`} size="sm" prefetch={false}>
              <Download className="size-4" /> CSV
            </ButtonLink>
          ) : null
        }
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {quick.map((q) => (
          <Link
            key={q.label}
            href={`/tarefas${q.qs ? `?${q.qs}` : ""}`}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              currentQs === q.qs ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            {q.label}
          </Link>
        ))}
      </div>
      <Card>
        <FilterBar resetHref="/tarefas">
          <FilterField label="Buscar" className="w-full sm:w-56">
            <Input name="q" defaultValue={params.q} placeholder="Código, SKU ou documento" />
          </FilterField>
          <FilterField label="Tipo" className="w-full sm:w-40">
            <Select name="type" defaultValue={params.type} placeholder="Todos" options={TASK_TYPES.map((t) => ({ value: t, label: TASK_TYPE_LABELS[t] }))} />
          </FilterField>
          <FilterField label="Status" className="w-full sm:w-44">
            <Select
              name="status"
              defaultValue={params.status}
              placeholder="Todos"
              options={[{ value: "pending,in_progress", label: "Abertas" }, ...TASK_STATUSES.map((s) => ({ value: s, label: STATUS.task[s].label }))]}
            />
          </FilterField>
          <FilterField label="Prioridade" className="w-full sm:w-32">
            <Select
              name="priority"
              defaultValue={params.priority}
              placeholder="Todas"
              options={[
                { value: "1", label: "Alta" },
                { value: "2", label: "Normal" },
                { value: "3", label: "Baixa" },
              ]}
            />
          </FilterField>
          <FilterField label="Ordenar" className="w-full sm:w-44">
            <Select
              name="sort"
              defaultValue={params.sort}
              options={[
                { value: "priority", label: "Prioridade" },
                { value: "created", label: "Mais antigas" },
                { value: "-created", label: "Mais recentes" },
                { value: "code", label: "Código" },
              ]}
            />
          </FilterField>
          {params.assigned ? <input type="hidden" name="assigned" value={params.assigned} /> : null}
        </FilterBar>
        <TaskTable rows={result.rows} />
        <Pagination page={result.page} pageSize={result.pageSize} total={result.total} params={params} />
      </Card>
    </>
  );
}
