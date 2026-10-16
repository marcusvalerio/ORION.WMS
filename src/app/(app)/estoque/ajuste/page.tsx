import { requireCtx } from "@/server/auth/session";
import { listLocations } from "@/server/services/warehouse";
import { listProductOptions } from "@/server/services/products";
import { adjustStockAction } from "@/server/actions/stock";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select, Textarea } from "@/components/ui/fields";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { can } from "@/lib/permissions";

export const metadata = { title: "Ajuste manual" };

export default async function AdjustPage() {
  const ctx = await requireCtx();
  if (!can(ctx.user.role, "stock.adjust")) {
    return (
      <>
        <PageHeader title="Ajuste manual de estoque" breadcrumbs={[{ label: "Estoque", href: "/estoque" }, { label: "Ajuste" }]} />
        <Alert level="warning" title="Acesso restrito">
          Ajustes manuais exigem permissão específica (supervisor ou administrador). Divergências físicas devem ser tratadas por inventário.
        </Alert>
      </>
    );
  }
  const [locations, products] = await Promise.all([listLocations(ctx, { status: "active", pageSize: 2000 }), listProductOptions(ctx)]);
  return (
    <>
      <PageHeader
        title="Ajuste manual de estoque"
        description="Use apenas para correções excepcionais. O saldo nunca é editado diretamente: o ajuste gera uma movimentação de entrada/saída com justificativa e registro de auditoria."
        breadcrumbs={[{ label: "Armazém" }, { label: "Estoque", href: "/estoque" }, { label: "Ajuste manual" }]}
      />
      <Card className="max-w-3xl">
        <CardBody>
          <ActionForm action={adjustStockAction} resetOnSuccess confirm="Confirmar o ajuste de estoque? A operação será auditada." className="grid gap-3 sm:grid-cols-2">
            <Field label="Endereço" required className="sm:col-span-2">
              <Select name="locationId" required placeholder="Selecione…" options={locations.rows.map((l) => ({ value: l.id, label: l.code }))} />
            </Field>
            <Field label="Produto" required className="sm:col-span-2">
              <Select name="productId" required placeholder="Selecione…" options={products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.description}` }))} />
            </Field>
            <Field label="Lote" hint="Obrigatório para produtos com controle de lote.">
              <Input name="lotCode" maxLength={40} />
            </Field>
            <Field label="Validade (entradas)">
              <Input name="expiryDate" type="date" />
            </Field>
            <Field label="Tipo" required>
              <Select
                name="direction"
                options={[
                  { value: "in", label: "Entrada (+)" },
                  { value: "out", label: "Saída (−)" },
                ]}
              />
            </Field>
            <Field label="Quantidade" required>
              <Input name="quantity" type="number" min={0} step="any" required />
            </Field>
            <Field label="Justificativa" required className="sm:col-span-2" hint="Mínimo de 10 caracteres. Ficará registrada na movimentação e na auditoria.">
              <Textarea name="reason" required minLength={10} />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton>Registrar ajuste</SubmitButton>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
