import { requireCtx } from "@/server/auth/session";
import { listQualityHolds } from "@/server/services/quality";
import { decideQualityHoldAction } from "@/server/actions/quality";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/fields";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";

export const metadata = { title: "Qualidade" };

const SOURCE: Record<string, string> = { production_output: "Produto acabado", customer_return: "Devolução de cliente" };
const STATUS: Record<string, { label: string; tone: "warning" | "info" | "success" | "danger" }> = {
  pending: { label: "Aguardando qualidade", tone: "warning" },
  rework: { label: "Em retrabalho", tone: "info" },
  approved: { label: "Aprovado", tone: "success" },
  rejected: { label: "Reprovado", tone: "danger" },
};

export default async function QualityPage() {
  const ctx = await requireCtx();
  if (!can(ctx.user.role, "quality.release")) return <Alert level="warning">Seu perfil não decide retenções da qualidade.</Alert>;
  const holds = await listQualityHolds(ctx);
  return (
    <>
      <PageHeader
        title="Qualidade"
        description="Produto acabado e devolução apta aguardam a qualidade com o saldo bloqueado. A armazenagem só é gerada depois da aprovação."
        breadcrumbs={[{ label: "Recebimento" }, { label: "Qualidade" }]}
      />
      {holds.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {holds.map((h) => (
            <Card key={h.id}>
              <CardHeader
                title={`${h.code} · ${SOURCE[h.source] ?? h.source}`}
                description={`${h.reference_code} · entrada em ${fmtDateTime(h.created_at)}`}
              />
              <CardBody className="space-y-3">
                <p className="text-sm">
                  <span className="font-mono whitespace-nowrap">{h.sku}</span> · {h.description}
                </p>
                <p className="text-sm text-fg-2 tabular-nums">
                  {fmtQty(h.quantity)} {h.uom} · lote <span className="font-mono">{h.lot_code || "—"}</span> · validade {fmtDate(h.expiry_date)} ·{" "}
                  <span className="font-mono whitespace-nowrap">{h.location_code ?? "—"}</span>
                </p>
                <Badge tone={STATUS[h.status].tone}>{STATUS[h.status].label}</Badge>
                {h.report ? <p className="text-xs text-muted">Último laudo: {h.report}</p> : null}
                <ActionForm action={decideQualityHoldAction} className="space-y-3 border-t border-line pt-3">
                  <input type="hidden" name="_id" value={h.id} />
                  <Field label="Laudo" required>
                    <Textarea name="report" required minLength={5} rows={2} />
                  </Field>
                  <Field label="Anexo (link)">
                    <Input name="attachmentUrl" type="url" maxLength={500} />
                  </Field>
                  <Field label="Decisão" required>
                    <Select
                      name="decision"
                      required
                      options={[
                        { value: "approved", label: "Aprovar" },
                        { value: "rejected", label: "Reprovar" },
                        { value: "rework", label: "Retrabalhar" },
                      ]}
                    />
                  </Field>
                  <SubmitButton>Registrar decisão</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="Nada aguardando a qualidade" description="Produto acabado e devoluções aptas aparecem aqui assim que entram." />
      )}
    </>
  );
}
