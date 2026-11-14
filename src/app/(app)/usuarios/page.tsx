import Link from "next/link";
import { UserPlus } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { listUsers } from "@/server/services/users";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/format";
import { can, ROLE_LABELS, ROLES } from "@/lib/permissions";
import { readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Usuários" };

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  if (!can(ctx.user.role, "users.manage")) {
    return (
      <>
        <PageHeader title="Usuários" breadcrumbs={[{ label: "Gestão" }, { label: "Usuários" }]} />
        <Alert level="warning">A gestão de usuários é restrita a administradores.</Alert>
      </>
    );
  }
  const users = await listUsers(ctx, { q: params.q, role: params.role, status: params.status });
  return (
    <>
      <PageHeader
        title="Usuários"
        description="Cadastro de acesso ao WMS: perfil, situação, depósitos permitidos e senha. Todas as alterações ficam na auditoria."
        breadcrumbs={[{ label: "Gestão" }, { label: "Usuários" }]}
        actions={
          <ButtonLink href="/usuarios/novo">
            <UserPlus className="size-4" /> Novo usuário
          </ButtonLink>
        }
      />
      <Card>
        <FilterBar resetHref="/usuarios">
          <FilterField label="Buscar" className="w-full sm:w-64">
            <Input name="q" defaultValue={params.q} placeholder="Nome ou e-mail" />
          </FilterField>
          <FilterField label="Perfil" className="w-full sm:w-48">
            <Select name="role" defaultValue={params.role} placeholder="Todos" options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
          </FilterField>
          <FilterField label="Situação" className="w-full sm:w-40">
            <Select
              name="status"
              defaultValue={params.status}
              placeholder="Todas"
              options={[
                { value: "active", label: "Ativos" },
                { value: "inactive", label: "Inativos" },
              ]}
            />
          </FilterField>
        </FilterBar>
        {users.length ? (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Perfil</th>
                  <th>Depósitos</th>
                  <th>Situação</th>
                  <th>Último acesso</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link href={`/usuarios/${u.id}`} className="link font-medium">
                        {u.name}
                      </Link>
                      {u.id === ctx.user.id ? <span className="ml-1.5 text-[11px] text-slate-500">(você)</span> : null}
                      {u.is_demo ? <DemoBadge className="ml-1.5" /> : null}
                    </td>
                    <td className="text-slate-600">{u.email}</td>
                    <td>{ROLE_LABELS[u.role]}</td>
                    <td>{u.warehouse_codes?.length ? u.warehouse_codes.join(", ") : <span className="text-slate-500">Todos</span>}</td>
                    <td className="space-x-1">
                      <Badge tone={u.active ? "success" : "neutral"}>{u.active ? "Ativo" : "Inativo"}</Badge>
                      {u.must_change_password ? <Badge tone="warning">Troca de senha pendente</Badge> : null}
                    </td>
                    <td className="whitespace-nowrap">{u.last_login_at ? fmtDateTime(u.last_login_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState title="Nenhum usuário encontrado" />
        )}
      </Card>
    </>
  );
}
