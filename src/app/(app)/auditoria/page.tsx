import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { listAudit, listIntegrationEvents } from "@/server/services/audit";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/fields";
import { Pagination, TableWrap } from "@/components/ui/table";
import { AUDIT_ACTION_LABELS } from "@/lib/labels";
import { fmtDateTime } from "@/lib/format";
import { can, ROLE_LABELS, type Role } from "@/lib/permissions";
import { pageNumber, readParams, type SearchParams } from "@/lib/params";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Auditoria" };

const ENTITY_LABELS: Record<string, string> = {
  receipt: "Recebimento",
  outbound_order: "Pedido de saída",
  inventory: "Inventário",
  location: "Endereço",
  warehouse: "Depósito",
  zone: "Zona",
  product: "Produto",
  stock_movement: "Movimentação",
  stock_balance: "Saldo",
  divergence: "Divergência",
  task: "Tarefa",
  user: "Usuário",
};

const ENTITY_HREF: Record<string, string> = {
  receipt: "/recebimentos/",
  outbound_order: "/separacao/",
  inventory: "/inventario/",
  location: "/armazem/enderecos/",
  product: "/produtos/",
  task: "/tarefas/",
  stock_balance: "/estoque/saldo/",
};

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  if (!can(ctx.user.role, "audit.view")) {
    return (
      <>
        <PageHeader title="Auditoria" />
        <Alert level="warning">Acesso restrito a administradores, supervisores e auditores.</Alert>
      </>
    );
  }
  const tab = params.tab === "integracao" ? "integracao" : "log";
  const [audit, events] = await Promise.all([
    tab === "log" ? listAudit(ctx, { q: params.q, entityType: params.entityType, page: pageNumber(params.page) }) : Promise.resolve(null),
    tab === "integracao" ? listIntegrationEvents(ctx) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Registro imutável de alterações críticas, aprovações, ajustes, bloqueios e acessos. Eventos de integração mostram o que deve ser comunicado ao ERP."
        breadcrumbs={[{ label: "Gestão" }, { label: "Auditoria" }]}
      />
      <div className="mb-3 flex gap-1.5">
        {[
          ["log", "Trilha de auditoria"],
          ["integracao", "Eventos de integração (ERP)"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={`?tab=${key}`}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              tab === key ? "border-brand-300 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            {label}
          </Link>
        ))}
      </div>
      {audit ? (
        <Card>
          <FilterBar resetHref="/auditoria">
            <FilterField label="Buscar" className="w-full sm:w-64">
              <Input name="q" defaultValue={params.q} placeholder="Ação, código ou usuário" />
            </FilterField>
            <FilterField label="Entidade" className="w-full sm:w-48">
              <Select name="entityType" defaultValue={params.entityType} placeholder="Todas" options={Object.entries(ENTITY_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
            </FilterField>
          </FilterBar>
          {audit.rows.length ? (
            <TableWrap>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Data/hora</th>
                    <th>Usuário</th>
                    <th>Ação</th>
                    <th>Registro</th>
                    <th>Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.rows.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap">{fmtDateTime(a.created_at)}</td>
                      <td>
                        {a.user_name ?? "Sistema"}
                        {a.user_role ? <span className="block text-[11px] text-slate-500">{ROLE_LABELS[a.user_role as Role]}</span> : null}
                      </td>
                      <td className="font-medium">{AUDIT_ACTION_LABELS[a.action] ?? a.action}</td>
                      <td>
                        <span className="text-xs text-slate-500">{ENTITY_LABELS[a.entity_type] ?? a.entity_type}</span>
                        <span className="block">
                          {a.entity_id && ENTITY_HREF[a.entity_type] ? (
                            <Link href={`${ENTITY_HREF[a.entity_type]}${a.entity_id}`} className="link">
                              {a.entity_code ?? "abrir"}
                            </Link>
                          ) : (
                            (a.entity_code ?? "—")
                          )}
                        </span>
                      </td>
                      <td className="max-w-md">
                        <code className="line-clamp-2 text-[11px] break-all text-slate-600" title={JSON.stringify(a.details)}>
                          {Object.keys(a.details).length ? JSON.stringify(a.details) : "—"}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState title="Nenhum registro encontrado" />
          )}
          <Pagination page={audit.page} pageSize={audit.pageSize} total={audit.total} params={params} />
        </Card>
      ) : null}
      {events ? (
        <Card>
          <Alert level="info" className="m-4">
            Outbox de integração: cada evento é gravado na mesma transação da operação. O conector de envio para um ERP externo ainda não está configurado — os eventos
            permanecem “Na fila” até que um processador seja implantado (ver README). O status de pedidos de compra e de venda no ERP local já é atualizado diretamente.
          </Alert>
          {events.length ? (
            <TableWrap>
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Data/hora</th>
                    <th>Evento</th>
                    <th>Agregado</th>
                    <th>Status</th>
                    <th>Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap">{fmtDateTime(e.created_at)}</td>
                      <td className="font-mono text-xs">{e.event_type}</td>
                      <td>{e.aggregate_type}</td>
                      <td>
                        <StatusBadge kind="integration" status={e.status} />
                      </td>
                      <td className="max-w-lg">
                        <code className="line-clamp-2 text-[11px] break-all text-slate-600">{JSON.stringify(e.payload)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState title="Nenhum evento de integração" />
          )}
        </Card>
      ) : null}
    </>
  );
}
