import { requireCtx } from "@/server/auth/session";
import { listCompanyWarehouses, PASSWORD_RULE } from "@/server/services/users";
import { createUserAction } from "@/server/actions/users";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select } from "@/components/ui/fields";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { WarehouseChecklist } from "../warehouse-checklist";
import { can, ROLE_LABELS, ROLES } from "@/lib/permissions";

export const metadata = { title: "Novo usuário" };

export default async function NewUserPage() {
  const ctx = await requireCtx();
  const crumbs = [{ label: "Gestão" }, { label: "Usuários", href: "/usuarios" }, { label: "Novo" }];
  if (!can(ctx.user.role, "users.manage")) {
    return (
      <>
        <PageHeader title="Novo usuário" breadcrumbs={crumbs} />
        <Alert level="warning">A gestão de usuários é restrita a administradores.</Alert>
      </>
    );
  }
  const warehouses = await listCompanyWarehouses(ctx);
  return (
    <>
      <PageHeader title="Novo usuário" breadcrumbs={crumbs} />
      <Card className="max-w-3xl">
        <CardHeader title="Dados de acesso" description="A senha inicial é provisória: o usuário deverá trocá-la no primeiro acesso." />
        <CardBody>
          <ActionForm action={createUserAction} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Nome" htmlFor="name" required>
                <Input id="name" name="name" required minLength={3} maxLength={120} />
              </Field>
              <Field label="E-mail" htmlFor="email" required>
                <Input id="email" name="email" type="email" required autoComplete="off" />
              </Field>
              <Field label="Perfil" htmlFor="role" required>
                <Select id="role" name="role" defaultValue="operator" options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
              </Field>
              <Field label="Senha inicial" htmlFor="password" required hint={PASSWORD_RULE}>
                <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
              </Field>
            </div>
            <Field label="Depósitos permitidos" hint="Nenhum marcado = acesso a todos os depósitos da empresa.">
              <WarehouseChecklist warehouses={warehouses} selected={[]} />
            </Field>
            <SubmitButton>Criar usuário</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
