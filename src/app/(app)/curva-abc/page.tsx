import { requireCtx } from "@/server/auth/session";
import { computeAbc, slottingSuggestions } from "@/server/services/slotting";
import { createSlottingTransferAction, saveSlottingSettingsAction } from "@/server/actions/fulfillment";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";

export const metadata = { title: "Curva ABC e slotting" };

const TONE = { A: "success", B: "warning", C: "neutral" } as const;
const BAR = { A: "bg-ok-solid", B: "bg-warn-solid", C: "bg-line-strong" } as const;

export default async function AbcPage() {
  const ctx = await requireCtx();
  const manage = can(ctx.user.role, "slotting.manage");
  const [{ settings, rows }, suggestions] = await Promise.all([computeAbc(ctx), slottingSuggestions(ctx)]);
  const counts = { A: 0, B: 0, C: 0 };
  rows.forEach((r) => counts[r.abc]++);
  const max = Math.max(...rows.map((r) => r.metric), 0);
  const basisLabel = settings.basis === "units" ? "unidades separadas" : "linhas separadas";

  return (
    <>
      <PageHeader
        title="Curva ABC e slotting"
        description={`Giro por ${basisLabel} nos últimos ${settings.days} dias. Cortes: A até ${settings.a_pct}% acumulado, B até ${settings.a_pct + settings.b_pct}%, C no restante (inclui estoque sem giro).`}
        breadcrumbs={[{ label: "Gestão" }, { label: "Curva ABC" }]}
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Distribuição do giro" description={`A: ${counts.A} · B: ${counts.B} · C: ${counts.C} produto(s)`} />
          <CardBody>
            {rows.length ? (
              <ul className="space-y-2" aria-label="Gráfico de giro por produto">
                {rows.map((r) => (
                  <li key={r.product_id} className="grid grid-cols-[88px_1fr_120px] items-center gap-2 text-xs">
                    <span className="truncate font-medium text-fg-2">{r.sku}</span>
                    <span className="flex h-3 overflow-hidden rounded bg-subtle">
                      <span className={BAR[r.abc]} style={{ width: `${max ? (r.metric / max) * 100 : 0}%` }} />
                    </span>
                    <span className="text-right text-muted tabular-nums">
                      {fmtQty(r.metric)} · {r.cumulative.toFixed(1)}% acum.
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Sem dados" description="Não há separações no período nem estoque." />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Parâmetros" />
          <CardBody>
            {manage ? (
              <ActionForm action={saveSlottingSettingsAction} className="grid gap-3 sm:grid-cols-2">
                <Field label="Período (dias)" required>
                  <Input name="days" type="number" min={7} max={730} defaultValue={settings.days} required />
                </Field>
                <Field label="Base do giro" required>
                  <Select
                    name="basis"
                    defaultValue={settings.basis}
                    options={[
                      { value: "units", label: "Unidades separadas" },
                      { value: "lines", label: "Linhas separadas" },
                    ]}
                  />
                </Field>
                <Field label="Corte A (%)" required>
                  <Input name="aPct" type="number" min={1} max={98} step="any" defaultValue={settings.a_pct} required />
                </Field>
                <Field label="Faixa B (%)" required hint="C = 100 − A − B">
                  <Input name="bPct" type="number" min={1} max={98} step="any" defaultValue={settings.b_pct} required />
                </Field>
                <div className="sm:col-span-2">
                  <SubmitButton size="sm">Salvar e recalcular</SubmitButton>
                </div>
              </ActionForm>
            ) : (
              <p className="text-sm text-fg-2">
                {settings.days} dias · {basisLabel} · {settings.a_pct}/{settings.b_pct}/{Math.round((100 - settings.a_pct - settings.b_pct) * 100) / 100}
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Classificação" />
        <TableWrap>
          <table className="table-base">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Classe</th>
                <th className="num">Unidades</th>
                <th className="num">Linhas</th>
                <th className="num">Participação</th>
                <th className="num">Acumulado</th>
                <th className="num">Estoque</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product_id}>
                  <td>
                    <span className="font-medium">{r.sku}</span>
                    <span className="block text-xs text-muted">{r.description}</span>
                  </td>
                  <td>
                    <Badge tone={TONE[r.abc]}>{r.abc}</Badge>
                  </td>
                  <td className="num">{fmtQty(r.units)}</td>
                  <td className="num">{r.lines}</td>
                  <td className="num">{r.share.toFixed(1)}%</td>
                  <td className="num">{r.cumulative.toFixed(1)}%</td>
                  <td className="num">{fmtQty(r.stock)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Card className="mt-5">
        <CardHeader
          title={`Sugestões de reendereçamento (${suggestions.length})`}
          description="Itens A em endereços de acesso caro (fora do picking, níveis altos, ruas distantes) → endereços compatíveis, livres e mais próximos/baixos. Distância estimada pela ordem de rua/módulo (rua de menor número = mais perto da expedição). Só o saldo disponível é movido."
        />
        {suggestions.length ? (
          <TableWrap>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>De</th>
                  <th>Para</th>
                  <th className="num">Qtd.</th>
                  <th>Motivo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={s.balance_id}>
                    <td>
                      {s.sku} <Badge tone={TONE[s.abc]}>{s.abc}</Badge>
                      {s.lot_code ? <span className="block text-[11px] text-muted">Lote {s.lot_code}</span> : null}
                    </td>
                    <td className="font-mono text-[11px] whitespace-nowrap">{s.from_code}</td>
                    <td className="font-mono text-[11px] whitespace-nowrap">{s.to_code}</td>
                    <td className="num">{fmtQty(s.available)}</td>
                    <td className="text-xs">{s.reason}</td>
                    <td className="text-right">
                      {manage ? (
                        <ActionForm action={createSlottingTransferAction}>
                          <input type="hidden" name="fromLocationId" value={s.from_location_id} />
                          <input type="hidden" name="toLocationId" value={s.to_location_id} />
                          <input type="hidden" name="productId" value={s.product_id} />
                          <input type="hidden" name="lotCode" value={s.lot_code} />
                          <input type="hidden" name="quantity" value={s.available} />
                          <SubmitButton size="sm" variant="secondary">
                            Gerar transferência
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <CardBody>
            <p className="text-sm text-muted">Nenhuma sugestão: os itens A já estão em endereços de acesso fácil (ou não há destino compatível livre).</p>
          </CardBody>
        )}
      </Card>
    </>
  );
}
