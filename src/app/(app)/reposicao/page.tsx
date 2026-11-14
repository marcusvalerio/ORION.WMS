import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { listPickingLocations, listReplenishmentSettings } from "@/server/services/replenishment";
import { listProducts } from "@/server/services/products";
import { listTasks } from "@/server/services/tasks";
import { runReplenishmentCheckAction, saveReplenishmentSettingAction } from "@/server/actions/fulfillment";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { TaskTable } from "@/components/wms/task-table";
import { fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";

export const metadata = { title: "Reposição de picking" };

export default async function ReplenishmentPage() {
  const ctx = await requireCtx();
  const manage = can(ctx.user.role, "replenishment.manage");
  const [settings, locations, products, open] = await Promise.all([
    listReplenishmentSettings(ctx),
    manage ? listPickingLocations(ctx) : Promise.resolve([]),
    manage ? listProducts(ctx, { status: "active" }) : Promise.resolve([]),
    listTasks(ctx, { type: "replenishment", status: "pending,in_progress", pageSize: 100 }),
  ]);

  return (
    <>
      <PageHeader
        title="Reposição de picking"
        description="Mínimo e máximo por produto em endereços da zona de picking. Quando o disponível cai abaixo do mínimo (após separação, ajuste ou expedição, ou pelo botão abaixo), é gerada uma tarefa de reposição a partir do pulmão (FEFO) até o máximo — nunca duas abertas para o mesmo endereço. Falta encontrada na separação gera reposição de emergência com prioridade alta."
        breadcrumbs={[{ label: "Operações" }, { label: "Reposição" }]}
        actions={
          manage ? (
            <ActionForm action={runReplenishmentCheckAction}>
              <SubmitButton size="sm">Verificar reposição</SubmitButton>
            </ActionForm>
          ) : null
        }
      />

      <Card className="mb-5">
        <CardHeader title={`Endereços de picking configurados (${settings.length})`} />
        {settings.length ? (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Endereço</th>
                  <th>Produto</th>
                  <th className="num">Mínimo</th>
                  <th className="num">Máximo</th>
                  <th className="num">Físico</th>
                  <th className="num">Disponível</th>
                  <th>Situação</th>
                  <th>Tarefa aberta</th>
                </tr>
              </thead>
              <tbody>
                {settings.map((s) => (
                  <tr key={s.id}>
                    <td className="font-mono text-[11px] whitespace-nowrap">{s.location_code}</td>
                    <td>
                      <span className="font-medium">{s.sku}</span>
                      <span className="block text-xs text-slate-500">{s.description}</span>
                    </td>
                    <td className="num">{fmtQty(s.min_qty)}</td>
                    <td className="num">{fmtQty(s.max_qty)}</td>
                    <td className="num">{fmtQty(s.current_qty)}</td>
                    <td className="num">{fmtQty(s.available_qty)}</td>
                    <td>
                      {!s.active ? (
                        <Badge tone="neutral">Inativa</Badge>
                      ) : s.available_qty < s.min_qty ? (
                        <Badge tone="danger">Abaixo do mínimo</Badge>
                      ) : (
                        <Badge tone="success">Abastecido</Badge>
                      )}
                    </td>
                    <td>
                      {s.open_task_id ? (
                        <Link href={`/tarefas/${s.open_task_id}`} className="link">
                          {s.open_task_code} ({fmtQty(s.open_task_qty)}){s.open_task_emergency ? " · emergência" : ""}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <EmptyState title="Nenhum endereço configurado" description="Cadastre o mínimo e o máximo de um produto em um endereço da zona de picking." />
        )}
      </Card>

      {manage ? (
        <Card className="mb-5">
          <CardHeader title="Configurar mínimo/máximo" description="Salvar um endereço/produto já configurado atualiza os valores. Cada endereço abastece um único produto ativo." />
          <CardBody>
            {locations.length ? (
              <ActionForm action={saveReplenishmentSettingAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <Field label="Endereço de picking" required className="lg:col-span-2">
                  <Select name="locationId" required options={locations.map((l) => ({ value: l.id, label: `${l.code} (cap. ${fmtQty(l.capacity_units)})` }))} />
                </Field>
                <Field label="Produto" required className="lg:col-span-2">
                  <Select name="productId" required options={products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.description}` }))} />
                </Field>
                <Field label="Mínimo" required>
                  <Input name="minQty" type="number" min={0} step="any" required />
                </Field>
                <Field label="Máximo" required>
                  <Input name="maxQty" type="number" min={0} step="any" required />
                </Field>
                <Field label="Situação">
                  <Select
                    name="active"
                    defaultValue="on"
                    options={[
                      { value: "on", label: "Ativa" },
                      { value: "off", label: "Inativa" },
                    ]}
                  />
                </Field>
                <div className="flex items-end sm:col-span-2 lg:col-span-5">
                  <SubmitButton>Salvar configuração</SubmitButton>
                </div>
              </ActionForm>
            ) : (
              <p className="text-sm text-slate-500">
                Não há endereços ativos em zona de picking. Cadastre uma zona do tipo Picking em{" "}
                <Link href="/armazem/estrutura" className="link">
                  Estrutura física
                </Link>
                .
              </p>
            )}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={`Tarefas de reposição abertas (${open.total})`} />
        <TaskTable rows={open.rows} />
      </Card>
    </>
  );
}
