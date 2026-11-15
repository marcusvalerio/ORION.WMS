import { requireCtx } from "@/server/auth/session";
import { listSettings } from "@/server/services/settings";
import { saveSettingsAction } from "@/server/actions/users";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Input, Textarea } from "@/components/ui/fields";
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
                .map((s) => {
                  const defaultText =
                    s.type === "boolean" ? (s.default ? "ligado" : "desligado") : s.type === "number" ? `${s.default}${s.unit ?? ""}` : "nenhum";
                  return (
                    <div key={s.key}>
                      {s.type === "boolean" ? (
                        <Checkbox name={s.key} defaultChecked={s.value as boolean} label={<span className="font-medium">{s.label}</span>} />
                      ) : (
                        <label className="block text-sm font-medium" htmlFor={`set-${s.key}`}>
                          {s.label}
                        </label>
                      )}
                      {s.type === "number" ? (
                        <div className="mt-1.5 flex items-center gap-2">
                          <Input
                            id={`set-${s.key}`}
                            name={s.key}
                            type="number"
                            min={s.min}
                            max={s.max}
                            step={s.step ?? 1}
                            required
                            inputMode="decimal"
                            defaultValue={String(s.value)}
                            className="w-28 font-mono"
                          />
                          {s.unit ? <span className="text-sm text-fg-2">{s.unit}</span> : null}
                        </div>
                      ) : null}
                      {s.type === "emails" ? (
                        <Textarea
                          id={`set-${s.key}`}
                          name={s.key}
                          rows={3}
                          defaultValue={(s.value as string[]).join("\n")}
                          placeholder={"estoque@empresa.com.br\nsupervisao@empresa.com.br"}
                          className="mt-1.5 font-mono text-sm"
                        />
                      ) : null}
                      <p className={`mt-1 text-xs text-muted ${s.type === "boolean" ? "ml-6" : ""}`}>
                        {s.description} Padrão: {defaultText}.
                        {s.customized && s.updatedAt ? ` Alterado em ${fmtDateTime(s.updatedAt)} por ${s.updatedByName ?? "—"}.` : null}
                      </p>
                      {!s.isDefault ? (
                        <Badge tone="warning" className={`mt-1 ${s.type === "boolean" ? "ml-6" : ""}`}>
                          Diferente do padrão
                        </Badge>
                      ) : null}
                    </div>
                  );
                })}
            </CardBody>
          </Card>
        ))}
        <SubmitButton>Salvar configurações</SubmitButton>
      </ActionForm>
    </>
  );
}
