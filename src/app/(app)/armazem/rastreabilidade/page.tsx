import { requireCtx } from "@/server/auth/session";
import { traceBackward, traceForward } from "@/server/services/traceability";
import { listProductOptions } from "@/server/services/products";
import { startRecallAction } from "@/server/actions/quality";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Rastreabilidade" };

export default async function TraceabilityPage({ searchParams }: { searchParams: Promise<{ produto?: string; lote?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx.user.role, "reports.view")) return <Alert level="warning">Seu perfil não consulta a rastreabilidade.</Alert>;
  const sp = await searchParams;
  const products = await listProductOptions(ctx);
  const productId = sp.produto && isUuid(sp.produto) ? sp.produto : null;
  const lotCode = (sp.lote ?? "").trim().toUpperCase();
  const [back, fwd] = productId
    ? await Promise.all([traceBackward(ctx, { productId, lotCode }), traceForward(ctx, { productId, lotCode }).catch(() => null)])
    : [[], null];
  return (
    <>
      <PageHeader
        title="Rastreabilidade"
        description="Para trás: acabado → componentes. Para frente: componente → acabados → pedidos e clientes."
        breadcrumbs={[{ label: "Armazém" }, { label: "Rastreabilidade" }]}
      />
      <Card className="mb-5">
        <CardBody>
          <form className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end" role="search">
            <Field label="Produto" required>
              <Select name="produto" required defaultValue={productId ?? ""} placeholder="Selecione…" options={products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.description}` }))} />
            </Field>
            <Field label="Lote">
              <Input name="lote" defaultValue={lotCode} className="font-mono" />
            </Field>
            <button type="submit" className="min-h-11 rounded-full bg-action px-5 font-semibold text-on-action">
              Rastrear
            </button>
          </form>
        </CardBody>
      </Card>
      {productId ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Para trás (componentes)" />
            <TraceTable rows={back} />
          </Card>
          <Card>
            <CardHeader title="Para frente (acabados e lotes afetados)" />
            <TraceTable rows={fwd?.lots ?? []} />
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Pedidos e clientes" />
            {fwd?.orders.length ? (
              <TableWrap>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Cliente</th>
                      <th>Produto / lote</th>
                      <th className="num">Quantidade</th>
                      <th>Expedido em</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fwd.orders.map((o, k) => (
                      <tr key={k}>
                        <td className="font-mono whitespace-nowrap">
                          {o.code}
                          {o.sales_order ? <span className="block text-xs text-muted">PV {o.sales_order}</span> : null}
                        </td>
                        <td>{o.customer}</td>
                        <td className="font-mono whitespace-nowrap">
                          {o.sku} · {o.lot || "—"}
                        </td>
                        <td className="num">{fmtQty(o.qty)}</td>
                        <td className="whitespace-nowrap">{fmtDateTime(o.shipped_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <p className="p-4 text-sm text-muted">Nenhum pedido separado com estes lotes.</p>
            )}
          </Card>
          {can(ctx.user.role, "quality.release") ? (
            <Card className="lg:col-span-2">
              <CardHeader title="Iniciar recall" description="Bloqueia todo o saldo dos lotes afetados, gera a lista de clientes e pedidos e registra na auditoria." />
              <CardBody>
                <ActionForm action={startRecallAction} confirm="Iniciar o recall e bloquear o saldo dos lotes afetados?" className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="productId" value={productId} />
                  <input type="hidden" name="lotCode" value={lotCode} />
                  <Field label="Motivo" required className="min-w-64 flex-1">
                    <Input name="reason" required minLength={5} />
                  </Field>
                  <SubmitButton variant="danger">Iniciar recall</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function TraceTable({ rows }: { rows: { sku: string; description: string; lot: string; qty: number; depth: number }[] }) {
  if (!rows.length) return <p className="p-4 text-sm text-muted">Sem vínculos registrados.</p>;
  return (
    <TableWrap>
      <table className="table-base">
        <thead>
          <tr>
            <th>Nível</th>
            <th>Produto</th>
            <th>Lote</th>
            <th className="num">Quantidade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={k}>
              <td className="num">{r.depth}</td>
              <td>
                <span className="font-mono whitespace-nowrap">{r.sku}</span>
                <span className="block text-xs text-muted">{r.description}</span>
              </td>
              <td className="font-mono whitespace-nowrap">{r.lot || "—"}</td>
              <td className="num">{Number(r.qty) ? fmtQty(r.qty) : <span className="text-muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
