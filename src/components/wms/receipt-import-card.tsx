import type { Ctx } from "@/server/context";
import { getReceiptImport } from "@/server/services/comex";
import { clearCustomsAction, saveReceiptImportAction } from "@/server/actions/comex";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";
import { Checkbox, Field, Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { INCOTERMS_2020 } from "@/lib/comex";
import { CUSTOMS_CHANNEL_LABELS, CUSTOMS_CHANNELS, TRANSPORT_DOC_LABELS, TRANSPORT_MODE_LABELS, TRANSPORT_MODES, type CustomsChannel, type TransportMode } from "@/lib/comex-panel";
import { ImportTimelineFull } from "@/components/comex/import-timeline";
import { fmtDate } from "@/lib/format";
import { can } from "@/lib/permissions";

/** Dados de importação (DI/DUIMP, Incoterm, origem, contêiner, NCM) e retenção aduaneira do recebimento. */
export async function ReceiptImportCard({
  ctx,
  receiptId,
  receiptStatus,
  milestones,
}: {
  ctx: Ctx;
  receiptId: string;
  receiptStatus: string;
  milestones?: { arrived_at: string | null; checked_at: string | null; completed_at: string | null };
}) {
  const info = await getReceiptImport(ctx, receiptId);
  if (!info) return null;
  const role = ctx.user.role;
  const editable = ["expected", "checking", "checked"].includes(receiptStatus) && info.customs_status !== "cleared" && can(role, "comex.manage");
  const hasData = Boolean(
    info.import_doc_type || info.incoterm || info.origin_country || info.container_number || info.transport_doc || info.commercial_invoice || info.transport_mode,
  );
  const mode = info.transport_mode as TransportMode | null;
  const channel = info.customs_channel ? CUSTOMS_CHANNEL_LABELS[info.customs_channel as CustomsChannel] : null;
  if (!hasData && !editable) return null;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Card>
      <CardHeader
        title="Importação"
        description="Dados opcionais de comércio exterior. O país de origem acompanha o lote no estoque e na rastreabilidade."
        actions={<StatusBadge kind="customs" status={info.customs_status} />}
      />
      <CardBody className="space-y-4">
        {hasData ? (
          <DefinitionList
            items={[
              ["Declaração", info.import_doc_type ? `${info.import_doc_type} ${info.import_doc_number}` : null],
              ["Incoterm", info.incoterm],
              ["País de origem", info.origin_country],
              ["Contêiner / lacre", info.container_number ? `${info.container_number}${info.seal_number ? ` · lacre ${info.seal_number}` : ""}` : null],
              ["Modal", mode ? TRANSPORT_MODE_LABELS[mode] : null],
              [mode ? TRANSPORT_DOC_LABELS[mode] : "BL / AWB", info.transport_doc ? <span className="font-mono">{info.transport_doc}</span> : null],
              ["Invoice comercial", info.commercial_invoice ? <span className="font-mono">{info.commercial_invoice}</span> : null],
              ["Canal de parametrização", channel ? `${channel.label} — ${channel.hint}` : null],
              ["Desembaraço", info.customs_cleared_on ? `${fmtDate(info.customs_cleared_on)} por ${info.customs_cleared_by_name}` : null],
            ]}
          />
        ) : null}
        {hasData ? (
          <ImportTimelineFull
            row={{
              shipped_on: info.shipped_on,
              eta_on: info.eta_on,
              arrived_at: milestones?.arrived_at ?? null,
              import_registered_on: info.import_registered_on,
              customs_cleared_on: info.customs_cleared_on,
              checked_at: milestones?.checked_at ?? null,
              completed_at: milestones?.completed_at ?? null,
            }}
          />
        ) : null}

        {info.customs_status === "awaiting" ? (
          <Alert level="warning" title="Aguardando desembaraço aduaneiro">
            A conferência pode ser feita, mas a liberação para armazenagem fica bloqueada até o registro do desembaraço por um supervisor.
          </Alert>
        ) : null}

        {info.customs_status === "awaiting" && can(role, "customs.clear") ? (
          <ActionForm action={clearCustomsAction} confirm="Registrar o desembaraço e liberar o recebimento para armazenagem?" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="_id" value={receiptId} />
            <Field label="Data do desembaraço" required>
              <Input type="date" name="clearedOn" max={today} defaultValue={today} required />
            </Field>
            <SubmitButton>Registrar desembaraço</SubmitButton>
          </ActionForm>
        ) : null}

        {editable ? (
          <Disclosure title={hasData ? "Alterar dados de importação" : "Informar dados de importação"} defaultOpen={false}>
            <ActionForm action={saveReceiptImportAction} className="space-y-4">
              <input type="hidden" name="_id" value={receiptId} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Declaração">
                  <Select
                    name="importDocType"
                    defaultValue={info.import_doc_type ?? ""}
                    placeholder="—"
                    options={[
                      { value: "DI", label: "DI" },
                      { value: "DUIMP", label: "DUIMP" },
                    ]}
                  />
                </Field>
                <Field label="Número da declaração">
                  <Input name="importDocNumber" defaultValue={info.import_doc_number ?? ""} maxLength={30} />
                </Field>
                <Field label="Incoterm">
                  <Select
                    name="incoterm"
                    defaultValue={info.incoterm ?? ""}
                    placeholder="—"
                    options={INCOTERMS_2020.map((i) => ({ value: i.code, label: i.label }))}
                  />
                </Field>
                <Field label="País de origem" hint="ISO 3166 alfa-2 (ex.: CN)">
                  <Input name="originCountry" defaultValue={info.origin_country ?? ""} maxLength={2} className="uppercase" />
                </Field>
                <Field label="Contêiner" hint="ISO 6346, com dígito verificador">
                  <Input name="containerNumber" defaultValue={info.container_number ?? ""} maxLength={13} className="uppercase" />
                </Field>
                <Field label="Lacre">
                  <Input name="sealNumber" defaultValue={info.seal_number ?? ""} maxLength={30} />
                </Field>
                <Field label="Modal">
                  <Select name="transportMode" defaultValue={info.transport_mode ?? ""} placeholder="—" options={TRANSPORT_MODES.map((m) => ({ value: m, label: TRANSPORT_MODE_LABELS[m] }))} />
                </Field>
                <Field label="BL / AWB" hint="Conhecimento de transporte">
                  <Input name="transportDoc" defaultValue={info.transport_doc ?? ""} maxLength={40} className="uppercase" />
                </Field>
                <Field label="Invoice comercial">
                  <Input name="commercialInvoice" defaultValue={info.commercial_invoice ?? ""} maxLength={40} />
                </Field>
                <Field label="Canal de parametrização" hint="Após o registro da DI/DUIMP">
                  <Select
                    name="customsChannel"
                    defaultValue={info.customs_channel ?? ""}
                    placeholder="—"
                    options={CUSTOMS_CHANNELS.map((c) => ({ value: c, label: CUSTOMS_CHANNEL_LABELS[c].label }))}
                  />
                </Field>
                <Field label="Embarque">
                  <Input type="date" name="shippedOn" defaultValue={info.shipped_on ?? ""} />
                </Field>
                <Field label="Chegada prevista">
                  <Input type="date" name="etaOn" defaultValue={info.eta_on ?? ""} />
                </Field>
                <Field label="Registro da DI/DUIMP">
                  <Input type="date" name="registeredOn" defaultValue={info.import_registered_on ?? ""} max={today} />
                </Field>
                <div className="flex items-end sm:col-span-2">
                  <Checkbox
                    name="holdForClearance"
                    defaultChecked={info.customs_status === "awaiting" || !hasData}
                    label="Reter a armazenagem até o registro do desembaraço"
                  />
                </div>
              </div>
              <TableWrap>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th>Produto</th>
                      <th>NCM do item (8 dígitos)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {info.items.map((i, idx) => (
                      <tr key={i.id}>
                        <td>{i.line_no}</td>
                        <td>
                          <span className="font-medium">{i.sku}</span>
                          <span className="block text-xs text-muted">{i.description}</span>
                        </td>
                        <td>
                          <input type="hidden" name={`items.${idx}.id`} value={i.id} />
                          <Input name={`items.${idx}.ncm`} defaultValue={i.ncm ?? i.product_ncm ?? ""} maxLength={10} inputMode="numeric" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <SubmitButton>Salvar dados de importação</SubmitButton>
            </ActionForm>
          </Disclosure>
        ) : null}
      </CardBody>
    </Card>
  );
}
