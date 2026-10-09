import { requireCtx } from "@/server/auth/session";
import { listWarehouses } from "@/server/services/warehouse";
import { listProductOptions } from "@/server/services/products";
import { createOutboundAction } from "@/server/actions/outbound";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select } from "@/components/ui/fields";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { can } from "@/lib/permissions";

export const metadata = { title: "Novo pedido de saída" };

export default async function NewOrderPage() {
  const ctx = await requireCtx();
  if (!can(ctx.user.role, "outbound.create")) {
    return (
      <>
        <PageHeader title="Novo pedido de saída" />
        <Alert level="warning">Seu perfil não permite criar pedidos de saída.</Alert>
      </>
    );
  }
  const [warehouses, products] = await Promise.all([listWarehouses(ctx), listProductOptions(ctx)]);
  return (
    <>
      <PageHeader
        title="Novo pedido de saída (manual)"
        description="Para pedidos que não vieram do ERP (ex.: transferência entre unidades, amostras). Pedidos do ERP devem ser importados na tela de separação."
        breadcrumbs={[{ label: "Operações" }, { label: "Separação", href: "/separacao" }, { label: "Novo" }]}
      />
      <Card className="max-w-3xl">
        <CardBody>
          <ActionForm action={createOutboundAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Depósito" required>
              <Select name="warehouseId" required options={warehouses.filter((w) => w.active).map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }))} />
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
            <Field label="Cliente / destinatário" required className="sm:col-span-2">
              <Input name="customerName" required minLength={3} maxLength={160} />
            </Field>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="grid grid-cols-3 gap-3 sm:col-span-2">
                <Field label={`Item ${i + 1} — produto`} required={i === 0} className="col-span-2">
                  <Select name={`lines.${i}.productId`} required={i === 0} placeholder="—" options={products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.description}` }))} />
                </Field>
                <Field label="Quantidade" required={i === 0}>
                  <Input name={`lines.${i}.quantity`} type="number" min={0} step="any" required={i === 0} />
                </Field>
              </div>
            ))}
            <Field label="Observações" className="sm:col-span-2">
              <Input name="notes" maxLength={500} />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton>Criar pedido</SubmitButton>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
