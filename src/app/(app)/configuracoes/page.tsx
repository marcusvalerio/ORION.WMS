import { requireCtx } from "@/server/auth/session";
import { listSettings } from "@/server/services/settings";
import { getInventoryConfig } from "@/server/services/inventory";
import { saveInventoryConfigAction } from "@/server/actions/inventory";
import { saveSettingsAction } from "@/server/actions/users";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/fields";
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
                    s.type === "boolean" ? (s.default ? "ligado" : "desligado") : s.type === "number"
                        ? `${s.default}${s.unit ?? ""}`
                        : s.type === "choice"
                          ? (s.options.find((o) => o.value === s.default)?.label ?? s.default).toLowerCase()
                          : "nenhum";
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
                      {s.type === "choice" ? (
                        <Select
                          id={`set-${s.key}`}
                          name={s.key}
                          defaultValue={String(s.value)}
                          className="mt-1.5 max-w-xs"
                          options={[...s.options]}
                        />
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
      <InventoryConfig config={await getInventoryConfig(ctx)} />
    </>
  );
}

/** Configurações › Inventário: tolerância e alçada por classe ABC e frequência do rotativo. */
function InventoryConfig({ config }: { config: Awaited<ReturnType<typeof getInventoryConfig>> }) {
  const classes = ["A", "B", "C"] as const;
  return (
    <ActionForm action={saveInventoryConfigAction} className="mt-8 max-w-3xl space-y-5">
      <Card>
        <CardHeader
          title="Inventário: tolerância, alçada e rotativo"
          description="Dentro da tolerância o ajuste é automático na aprovação. Vale o maior entre % e unidades. Diferença valorizada acima da alçada exige o perfil indicado."
        />
        <CardBody className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Classe</th>
                <th className="num">Tolerância %</th>
                <th className="num">Tolerância un.</th>
                <th className="num">Alçada R$</th>
                <th>Aprova acima</th>
                <th className="num">Rotativo (dias)</th>
              </tr>
            </thead>
            <tbody>
              {classes.map((c, k) => {
                const t = config.tolerances[c];
                return (
                  <tr key={c}>
                    <td className="font-display">
                      {c}
                      <input type="hidden" name={`tolerances.${k}.abcClass`} value={c} />
                      <input type="hidden" name={`plans.${k}.abcClass`} value={c} />
                    </td>
                    <td className="num">
                      <Input name={`tolerances.${k}.tolerancePct`} type="number" min={0} max={100} step={0.1} defaultValue={t.tolerance_pct} className="w-24 text-right tabular-nums" aria-label={`Tolerância % da classe ${c}`} />
                    </td>
                    <td className="num">
                      <Input name={`tolerances.${k}.toleranceUnits`} type="number" min={0} step="any" defaultValue={t.tolerance_units} className="w-24 text-right tabular-nums" aria-label={`Tolerância em unidades da classe ${c}`} />
                    </td>
                    <td className="num">
                      <Input name={`tolerances.${k}.approvalLimitValue`} type="number" min={0} step={1} defaultValue={t.approval_limit_value} className="w-28 text-right tabular-nums" aria-label={`Alçada em reais da classe ${c}`} />
                    </td>
                    <td>
                      <Select
                        name={`tolerances.${k}.approvalRole`}
                        defaultValue={t.approval_role}
                        aria-label={`Perfil que aprova acima da alçada na classe ${c}`}
                        options={[
                          { value: "admin", label: "Administrador" },
                          { value: "supervisor", label: "Supervisor" },
                        ]}
                      />
                    </td>
                    <td className="num">
                      <Input name={`plans.${k}.frequencyDays`} type="number" min={1} max={366} defaultValue={config.plans[c]} className="w-24 text-right tabular-nums" aria-label={`Frequência do rotativo da classe ${c}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">O modo de bloqueio e a fonte do custo ficam no grupo Inventário, acima.</p>
        </CardBody>
      </Card>
      <SubmitButton>Salvar parâmetros do inventário</SubmitButton>
    </ActionForm>
  );
}
