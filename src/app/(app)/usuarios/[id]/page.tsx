import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getUser, listCompanyWarehouses } from "@/server/services/users";
import { entityHistory } from "@/server/services/audit";
import { setUserActiveAction, setUserWarehousesAction, updateUserAction } from "@/server/actions/users";
import { isDemoMode } from "@/server/demo-mode";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/fields";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { WarehouseChecklist } from "../warehouse-checklist";
import { ResetPassword } from "./reset-password";
import { AUDIT_ACTION_LABELS } from "@/lib/labels";
import { fmtDateTime } from "@/lib/format";
import { can, ROLE_LABELS, ROLES } from "@/lib/permissions";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Usuário" };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const crumbs = [{ label: "Gestão" }, { label: "Usuários", href: "/usuarios" }];
  if (!can(ctx.user.role, "users.manage")) {
    return (
      <>
        <PageHeader title="Usuário" breadcrumbs={crumbs} />
        <Alert level="warning">A gestão de usuários é restrita a administradores.</Alert>
      </>
    );
  }
  if (!isUuid(id)) notFound();
  const [user, warehouses, history] = await Promise.all([getUser(ctx, id), listCompanyWarehouses(ctx), entityHistory(ctx, "user", id)]);
  if (!user) notFound();
  const self = user.id === ctx.user.id;
  const atlasLocked = Boolean(user.atlas_user_id);
  const demoLocked = (isDemoMode() && user.is_demo) || atlasLocked;
  return (
    <>
      <PageHeader
        title={user.name}
        description={user.email}
        breadcrumbs={[...crumbs, { label: user.name }]}
        badges={
          <>
            <Badge tone={user.active ? "success" : "neutral"}>{user.active ? "Ativo" : "Inativo"}</Badge>
            {user.must_change_password ? <Badge tone="warning">Troca de senha pendente</Badge> : null}
            {user.is_demo ? <DemoBadge /> : null}
            {atlasLocked ? <Badge tone="info">Gerenciado pelo ATLAS</Badge> : null}
          </>
        }
      />
      {atlasLocked ? (
        <Alert level="info" className="mb-4">
          Usuário gerenciado pelo ATLAS.ERP (login único): nome, e-mail, perfil, ativação e senha são alterados no ATLAS. Aqui só é possível restringir
          depósitos quando o ATLAS não os define.
        </Alert>
      ) : demoLocked ? (
        <Alert level="info" className="mb-4">
          Modo demonstração: perfil, situação e senha dos usuários de demonstração estão protegidos (os atalhos da tela de login dependem deles). Crie um
          novo usuário para testar essas funções.
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Dados e perfil" />
          <CardBody>
            <ActionForm action={updateUserAction} className="space-y-4">
              <input type="hidden" name="_id" value={user.id} />
              <Field label="Nome" htmlFor="name" required>
                <Input id="name" name="name" defaultValue={user.name} required minLength={3} maxLength={120} />
              </Field>
              <Field label="Perfil" htmlFor="role" required hint={self ? "Você não pode deixar a empresa sem administrador ativo." : undefined}>
                <Select id="role" name="role" defaultValue={user.role} options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
              </Field>
              <SubmitButton disabled={atlasLocked}>Salvar</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Acesso" />
          <CardBody className="space-y-5">
            <DefinitionList
              items={[
                ["Criado em", fmtDateTime(user.created_at)],
                ["Último acesso", user.last_login_at ? fmtDateTime(user.last_login_at) : "—"],
                ["Senha alterada em", user.password_changed_at ? fmtDateTime(user.password_changed_at) : "—"],
              ]}
            />
            <ResetPassword userId={user.id} disabled={!user.active || demoLocked} />
            <ActionForm
              action={setUserActiveAction}
              confirm={user.active ? `Inativar ${user.name}? O acesso é bloqueado imediatamente.` : `Reativar ${user.name}?`}
            >
              <input type="hidden" name="_id" value={user.id} />
              <input type="hidden" name="active" value={user.active ? "false" : "true"} />
              <SubmitButton variant={user.active ? "danger" : "success"} size="sm" disabled={user.active && (self || demoLocked)}>
                {user.active ? "Inativar usuário" : "Reativar usuário"}
              </SubmitButton>
              {user.active && self ? <p className="mt-1 text-xs text-muted">Você não pode inativar o seu próprio usuário.</p> : null}
            </ActionForm>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader
            title="Depósitos permitidos"
            description="Sem nenhum depósito marcado, o usuário acessa todos. Com depósitos marcados, ele só vê e opera estoque, endereços, tarefas, recebimentos, pedidos e inventários desses depósitos."
          />
          <CardBody>
            <ActionForm action={setUserWarehousesAction} className="space-y-4">
              <input type="hidden" name="_id" value={user.id} />
              <WarehouseChecklist warehouses={warehouses} selected={user.warehouse_ids ?? []} />
              <SubmitButton>Salvar depósitos</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Histórico" />
          <CardBody>
            {history.length ? (
              <ul className="space-y-1.5 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-x-2">
                    <span className="text-muted">{fmtDateTime(h.created_at)}</span>
                    <span className="font-medium">{AUDIT_ACTION_LABELS[h.action] ?? h.action}</span>
                    <span className="text-muted">por {h.user_name ?? "Sistema"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Sem registros.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
