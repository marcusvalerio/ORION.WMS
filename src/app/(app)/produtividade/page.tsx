import { Download } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { fmtDuration, productivityByUser } from "@/server/services/productivity";
import { listWarehouses } from "@/server/services/warehouse";
import { TASK_TYPES } from "@/server/services/tasks";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { BlockBar } from "@/components/charts/block-bar";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { TASK_TYPE_LABELS } from "@/lib/labels";
import { fmtPct, fmtQty } from "@/lib/format";
import { can, ROLE_LABELS, type Role } from "@/lib/permissions";
import { isUuid, readParams, type SearchParams } from "@/lib/params";
import { toUserMessage } from "@/server/errors";

export const metadata = { title: "Produtividade" };

export default async function ProductivityPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  const crumbs = [{ label: "Gestão" }, { label: "Produtividade" }];
  if (!can(ctx.user.role, "productivity.view")) {
    return (
      <>
        <PageHeader title="Produtividade" breadcrumbs={crumbs} />
        <Alert level="warning">A produtividade por operador está disponível para administradores, supervisores e auditores.</Alert>
      </>
    );
  }
  const filters = { from: params.from, to: params.to, warehouseId: isUuid(params.warehouseId) ? params.warehouseId : null };
  const warehouses = await listWarehouses(ctx);
  let data: Awaited<ReturnType<typeof productivityByUser>> | null = null;
  let error: string | null = null;
  try {
    data = await productivityByUser(ctx, filters);
  } catch (e) {
    error = toUserMessage(e);
  }
  const csv = new URLSearchParams(Object.entries(filters).filter((e): e is [string, string] => Boolean(e[1])));
  return (
    <>
      <PageHeader
        title="Produtividade por operador"
        description="Calculada dos registros operacionais: tarefas concluídas (por quem concluiu), movimentações de estoque, contagens e divergências de separação."
        breadcrumbs={crumbs}
        actions={
          can(ctx.user.role, "reports.export") ? (
            <a href={`/api/relatorios/produtividade?${csv}`} className={buttonClass("primary", "sm")}>
              <Download className="size-4" /> Exportar CSV
            </a>
          ) : null
        }
      />
      {data && data.rows.length ? (
        <Card className="mb-5">
          <CardHeader title="Tarefas por operador" description="Blocos cheios = tarefas do operador em relação ao mais produtivo do período." />
          <CardBody>
            <ul className="space-y-2.5" aria-label="Tarefas por operador">
              {(() => {
                const max = Math.max(1, ...data.rows.map((r) => r.tasks_total));
                return [...data.rows]
                  .sort((a, b) => b.tasks_total - a.tasks_total)
                  .map((r) => (
                    <li key={r.user_id} className="grid grid-cols-[minmax(0,10rem)_1fr_5.5rem] items-center gap-3 text-xs">
                      <span className="truncate font-medium text-fg">{r.user_name}</span>
                      <BlockBar used={r.tasks_total} capacity={max} label={`${r.user_name}: ${r.tasks_total} tarefa(s)`} blocks={16} warnAt={101} showLabel={false} />
                      <span className="text-right text-muted tabular-nums">
                        {r.tasks_total} · {r.accuracy === null ? "—" : fmtPct(r.accuracy * 100)}
                      </span>
                    </li>
                  ));
              })()}
            </ul>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <FilterBar resetHref="/produtividade">
          <FilterField label="De" className="w-full sm:w-40">
            <Input type="date" name="from" defaultValue={data?.period.from ?? params.from} />
          </FilterField>
          <FilterField label="Até" className="w-full sm:w-40">
            <Input type="date" name="to" defaultValue={data?.period.to ?? params.to} />
          </FilterField>
          <FilterField label="Depósito" className="w-full sm:w-48">
            <Select name="warehouseId" defaultValue={params.warehouseId} placeholder="Todos" options={warehouses.map((w) => ({ value: w.id, label: w.code }))} />
          </FilterField>
        </FilterBar>
        {error ? <Alert level="warning" className="m-4">{error}</Alert> : null}
        {data && data.rows.length ? (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Operador</th>
                  <th className="num">Tarefas</th>
                  {TASK_TYPES.map((t) => (
                    <th key={t} className="num">
                      {TASK_TYPE_LABELS[t]}
                    </th>
                  ))}
                  <th className="num" title="Média de início → conclusão das tarefas concluídas">Tempo médio</th>
                  <th className="num" title="Armazenagem, transferência, separação e expedição">Unid. movimentadas</th>
                  <th className="num">Itens separados</th>
                  <th className="num" title="Itens de recebimento e de inventário contados">Linhas conferidas</th>
                  <th className="num" title="Separações concluídas sem divergência / total">Acuracidade</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.user_id}>
                    <td>
                      <span className="font-medium">{r.user_name}</span>
                      <span className="block text-[11px] text-muted">
                        {ROLE_LABELS[r.role as Role] ?? r.role}
                        {!r.active ? " · inativo" : ""}
                      </span>
                    </td>
                    <td className="num font-medium">{r.tasks_total}</td>
                    {TASK_TYPES.map((t) => (
                      <td key={t} className="num">
                        {r.tasks_by_type[t] || "—"}
                      </td>
                    ))}
                    <td className="num">{fmtDuration(r.avg_task_seconds)}</td>
                    <td className="num">{fmtQty(r.units_moved)}</td>
                    <td className="num">{fmtQty(r.units_picked)}</td>
                    <td className="num">{r.lines_checked}</td>
                    <td className="num">
                      {r.accuracy === null ? "—" : fmtPct(r.accuracy * 100)}
                      {r.picks_total ? (
                        <span className="block text-[11px] text-muted">
                          {r.picks_accurate}/{r.picks_total}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : !error ? (
          <EmptyState title="Sem atividade no período" description="Nenhuma tarefa, movimentação ou contagem registrada para os filtros escolhidos." />
        ) : null}
      </Card>
    </>
  );
}
