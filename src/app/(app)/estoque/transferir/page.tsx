import { requireCtx } from "@/server/auth/session";
import { getBalance, listStock } from "@/server/services/stock";
import { listLocations } from "@/server/services/warehouse";
import { createTransferAction } from "@/server/actions/tasks";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Checkbox, Field, Input, Select } from "@/components/ui/fields";
import { buttonClass } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { fmtDate, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { isUuid, readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Transferência" };

export default async function TransferPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  if (!can(ctx.user.role, "stock.transfer")) {
    return (
      <>
        <PageHeader title="Transferência interna" />
        <Alert level="warning">Seu perfil não permite transferir estoque.</Alert>
      </>
    );
  }
  const balance = isUuid(params.balance) ? await getBalance(ctx, params.balance) : null;
  const [options, destinations] = await Promise.all([
    balance ? Promise.resolve(null) : listStock(ctx, { status: "available", pageSize: 500, sort: "product" }),
    balance ? listLocations(ctx, { warehouseId: balance.warehouse_id, status: "active", pageSize: 1000 }) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader
        title="Transferência interna"
        description="Move saldo disponível entre endereços. A operação valida disponibilidade na origem e capacidade/compatibilidade no destino, em transação única."
        breadcrumbs={[{ label: "Armazém" }, { label: "Estoque", href: "/estoque" }, { label: "Transferência" }]}
      />
      <div className="grid max-w-4xl gap-5">
        <Card>
          <CardHeader title="1. Origem" description="Selecione o saldo (produto/lote/endereço) a transferir." />
          <CardBody>
            {balance ? (
              <DefinitionList
                items={[
                  ["Endereço de origem", balance.location_code],
                  ["Produto", `${balance.sku} — ${balance.description}`],
                  ["Lote / validade", `${balance.lot_code || "—"} / ${fmtDate(balance.expiry_date)}`],
                  ["Disponível para transferir", `${fmtQty(balance.available_qty)} ${balance.uom}`],
                ]}
              />
            ) : (
              <form method="get" className="flex flex-wrap items-end gap-3">
                <Field label="Saldo de origem" className="w-full sm:flex-1">
                  <Select
                    name="balance"
                    required
                    placeholder="Selecione…"
                    options={(options?.rows ?? []).map((b) => ({
                      value: b.id,
                      label: `${b.sku} · ${b.location_code}${b.lot_code ? ` · lote ${b.lot_code}` : ""} · disp. ${fmtQty(b.available_qty)}`,
                    }))}
                  />
                </Field>
                <button type="submit" className={buttonClass("secondary")}>
                  Continuar
                </button>
              </form>
            )}
          </CardBody>
        </Card>
        {balance ? (
          <Card>
            <CardHeader title="2. Destino e quantidade" />
            <CardBody>
              {balance.available_qty <= 0 ? (
                <Alert level="warning">Este saldo não possui quantidade disponível (está reservado ou bloqueado).</Alert>
              ) : (
                <ActionForm action={createTransferAction} className="grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="fromLocationId" value={balance.location_id} />
                  <input type="hidden" name="productId" value={balance.product_id} />
                  <input type="hidden" name="lotCode" value={balance.lot_code} />
                  <Field label={`Quantidade (máx. ${fmtQty(balance.available_qty)})`} required>
                    <Input name="quantity" type="number" min={0} step="any" max={balance.available_qty} required />
                  </Field>
                  <Field label="Endereço de destino" hint="Em branco: o sistema sugere um endereço elegível.">
                    <Select
                      name="toLocationId"
                      placeholder="Sugestão automática"
                      options={(destinations?.rows ?? [])
                        .filter((l) => l.id !== balance.location_id && ["storage", "picking"].includes(l.zone_type))
                        .map((l) => ({ value: l.id, label: `${l.code} · livre ${fmtQty(l.capacity_units - l.occupied)}` }))}
                    />
                  </Field>
                  <Field label="Prioridade">
                    <Select
                      name="priority"
                      defaultValue="2"
                      options={[
                        { value: "1", label: "Alta" },
                        { value: "2", label: "Normal" },
                        { value: "3", label: "Baixa" },
                      ]}
                    />
                  </Field>
                  <div className="flex items-end">
                    <Checkbox name="executeNow" label="Executar agora (movimentação física já realizada)" />
                  </div>
                  <div className="sm:col-span-2">
                    <SubmitButton>Registrar transferência</SubmitButton>
                  </div>
                </ActionForm>
              )}
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
