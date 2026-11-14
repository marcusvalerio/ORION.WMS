import { requireCtx } from "@/server/auth/session";
import { listSettings } from "@/server/services/settings";
import { saveSettingsAction } from "@/server/actions/users";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/fields";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { fmtDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";

export const metadata = { title: "Configurações do WMS" };

export default async function SettingsPage() {
  const ctx = await requireCtx();
  const crumbs = [{ label: "Gestão" }, { label: "Configurações" }];
  if (!can(ctx.user.role, "settings.manage")) {
    return (
      <>
        <PageHeader title="Configurações do WMS" breadcrumbs={crumbs} />
        <Alert level="warning">As configurações do WMS são restritas a administradores.</Alert>
      </>
    );
  }
  const settings = await listSettings(ctx);
  const groups = [...new Set(settings.map((s) => s.group))];
  return (
    <>
      <PageHeader
        title="Configurações do WMS"
        description={`Parâmetros de ${ctx.user.companyName}. Valem para todos os usuários da empresa; cada alteração fica registrada na auditoria.`}
        breadcrumbs={crumbs}
      />
      <ActionForm action={saveSettingsAction} className="max-w-3xl space-y-5">
        {groups.map((group) => (
          <Card key={group}>
            <CardHeader title={group} />
            <CardBody className="space-y-4">
              {settings
                .filter((s) => s.group === group)
                .map((s) => (
                  <div key={s.key}>
                    <Checkbox name={s.key} defaultChecked={s.value} label={<span className="font-medium">{s.label}</span>} />
                    <p className="mt-1 ml-6 text-xs text-muted">
                      {s.description} Padrão: {s.default ? "ligado" : "desligado"}.
                      {s.customized && s.updatedAt ? ` Alterado em ${fmtDateTime(s.updatedAt)} por ${s.updatedByName ?? "—"}.` : null}
                    </p>
                    {s.value !== s.default ? (
                      <Badge tone="warning" className="mt-1 ml-6">
                        Diferente do padrão
                      </Badge>
                    ) : null}
                  </div>
                ))}
            </CardBody>
          </Card>
        ))}
        <SubmitButton>Salvar configurações</SubmitButton>
      </ActionForm>
    </>
  );
}
