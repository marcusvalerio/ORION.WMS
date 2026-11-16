import Link from "next/link";
import { Building2, Link2, RefreshCw, Search, Unlink } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import {
  COMPANY_FIELD_LABELS,
  getCompanyProfile,
  listAtlasCompanies,
  previewCompanySync,
  type AtlasCompanyOption,
  type SyncPreview,
} from "@/server/services/company";
import { entityHistory } from "@/server/services/audit";
import { isAtlasManaged } from "@/server/services/atlas-sync";
import { isAtlasConfigured } from "@/server/integrations/atlas/connector";
import { linkAtlasCompanyAction, syncCompanyAction, unlinkAtlasCompanyAction, updateCompanyAction } from "@/server/actions/company";
import { toUserMessage } from "@/server/errors";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/states";
import { Field, Input } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { HistoryList } from "@/components/wms/history";
import { formatCep, formatCnpj } from "@/lib/cnpj";
import { fmtDateTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Dados da empresa" };

const ATLAS_SQL = `-- No banco do ATLAS.ERP (como superusuário):
create role orion_wms_reader login password '<senha forte>';
grant connect on database <banco_atlas> to orion_wms_reader;
grant usage on schema public to orion_wms_reader;
grant select on public.companies to orion_wms_reader;
alter role orion_wms_reader set default_transaction_read_only = on;`;

export default async function CompanyPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  if (!can(ctx.user.role, "company.manage")) {
    return (
      <>
        <PageHeader title="Dados da empresa" breadcrumbs={[{ label: "Gestão" }, { label: "Dados da empresa" }]} />
        <Alert level="warning">Acesso restrito a administradores.</Alert>
      </>
    );
  }
  const company = await getCompanyProfile(ctx.db, ctx.user.companyId);
  const managed = await isAtlasManaged(ctx.db, ctx.user.companyId);
  // Conector legado (ATLAS_DATABASE_URL): só para empresas sem vínculo pela API do ATLAS.
  const configured = isAtlasConfigured() && !managed;
  const linked = company.source === "atlas";

  let options: AtlasCompanyOption[] | null = null;
  let preview: SyncPreview | null = null;
  const errors: string[] = [];
  if (configured && params.buscar === "1") {
    options = await listAtlasCompanies(ctx).catch((e) => {
      errors.push(toUserMessage(e));
      return null;
    });
  }
  if (configured && linked && params.sincronizar === "1") {
    preview = await previewCompanySync(ctx).catch((e) => {
      errors.push(toUserMessage(e));
      return null;
    });
  }
  const history = await entityHistory(ctx, "company", company.id);

  return (
    <>
      <PageHeader
        title="Dados da empresa"
        description="Razão social, CNPJ e endereço usados no cabeçalho, nos relatórios/CSV e nas etiquetas de expedição. Podem ser importados do ATLAS.ERP (somente leitura) ou editados aqui."
        breadcrumbs={[{ label: "Gestão" }, { label: "Dados da empresa" }]}
        badges={
          <>
            {managed ? <Badge tone="info">Gerenciado pelo ATLAS</Badge> : linked ? <Badge tone="info">Origem: ATLAS.ERP</Badge> : <Badge>Origem: cadastro local</Badge>}
            {company.is_demo ? <DemoBadge /> : null}
          </>
        }
        actions={
          configured ? (
            <>
              <Link href="/empresa?buscar=1" className={buttonClass("secondary")}>
                <Search className="size-4" aria-hidden />
                Buscar no ERP
              </Link>
              {linked ? (
                <Link href="/empresa?sincronizar=1" className={buttonClass("primary")}>
                  <RefreshCw className="size-4" aria-hidden />
                  Sincronizar agora
                </Link>
              ) : null}
            </>
          ) : null
        }
      />

      <div className="space-y-5">
        {!configured ? (
          <Alert level="info" title="Conexão com o ATLAS.ERP não configurada">
            <p>
              Para importar os dados da empresa do ERP, defina no servidor a variável <code>ATLAS_DATABASE_URL</code> com a string de conexão Postgres de um
              usuário <strong>somente leitura</strong> do ATLAS (nunca use o prefixo <code>NEXT_PUBLIC_</code>) e reinicie a aplicação. Enquanto isso, edite os dados
              manualmente abaixo.
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-surface/70 p-2 text-[11px] leading-relaxed text-fg-2">{ATLAS_SQL}</pre>
          </Alert>
        ) : null}
        {errors.length ? (
          <Card>
            <ErrorState
              title="Não conseguimos falar com o ATLAS"
              description="Os dados da empresa podem estar desatualizados. O armazém continua funcionando normalmente."
              detail={errors.join(" ")}
              actions={
                <Link href={params.sincronizar === "1" ? "/empresa?sincronizar=1" : "/empresa?buscar=1"} className={buttonClass("primary", "md", "rounded-full")}>
                  Tentar de novo
                </Link>
              }
            />
          </Card>
        ) : null}

        {options ? (
          <Card>
            <CardHeader
              title="Empresas ativas no ATLAS.ERP"
              description="Escolha o registro que corresponde a esta empresa. O vínculo copia os dados e registra auditoria; o ATLAS nunca é alterado."
              actions={
                <Link href="/empresa" className={buttonClass("ghost", "sm")}>
                  Fechar
                </Link>
              }
            />
            {options.length ? (
              <TableWrap>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Razão social</th>
                      <th>CNPJ</th>
                      <th>Cidade/UF</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {options.map((o) => (
                      <tr key={o.id}>
                        <td className="font-medium">{o.name}</td>
                        <td>{o.legal_name ?? "—"}</td>
                        <td className="whitespace-nowrap">
                          {o.document ? formatCnpj(o.document) : "—"}
                          {!o.document_valid ? (
                            <Badge tone="danger" className="ml-1">
                              CNPJ inválido
                            </Badge>
                          ) : null}
                        </td>
                        <td>{[o.city, o.state].filter(Boolean).join("/") || "—"}</td>
                        <td className="text-right">
                          {o.linked_here ? (
                            <Badge tone="success">Vinculada</Badge>
                          ) : (
                            <ActionForm
                              action={linkAtlasCompanyAction}
                              confirm={`Vincular a “${o.name}” e substituir os dados atuais pelos do ATLAS.ERP?`}
                            >
                              <input type="hidden" name="externalId" value={o.id} />
                              <SubmitButton size="sm" variant="secondary" disabled={!o.document_valid}>
                                <Link2 className="size-3.5" aria-hidden />
                                Vincular
                              </SubmitButton>
                            </ActionForm>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState title="Nenhuma empresa ativa no ATLAS.ERP" />
            )}
          </Card>
        ) : null}

        {preview ? (
          <Card>
            <CardHeader
              title="Sincronizar com o ATLAS.ERP"
              description={`Registro vinculado ${preview.external_id}${preview.atlas_updated_at ? ` · alterado no ERP em ${fmtDateTime(preview.atlas_updated_at)}` : ""}. Confira as mudanças antes de confirmar.`}
              actions={
                <Link href="/empresa" className={buttonClass("ghost", "sm")}>
                  Cancelar
                </Link>
              }
            />
            <CardBody className="space-y-3">
              {preview.warnings.length ? <Alert level="warning">{preview.warnings.join(" ")}</Alert> : null}
              {preview.changes.length ? (
                <TableWrap>
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>Campo</th>
                        <th>Atual no WMS</th>
                        <th>No ATLAS.ERP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.changes.map((c) => (
                        <tr key={c.field}>
                          <td className="font-medium">{c.label}</td>
                          <td className="text-muted line-through">{show(c.field, c.current)}</td>
                          <td className="font-medium text-ok-fg">{show(c.field, c.incoming)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              ) : (
                <Alert level="success">Os dados já estão iguais aos do ATLAS.ERP. Confirmar apenas registra a data da sincronização.</Alert>
              )}
              <ActionForm action={syncCompanyAction}>
                <input type="hidden" name="expected" value={preview.fingerprint} />
                <SubmitButton>
                  <RefreshCw className="size-4" aria-hidden />
                  Confirmar sincronização{preview.changes.length ? ` (${preview.changes.length} campo(s))` : ""}
                </SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Dados atuais"
              description={
                linked
                  ? `Vinculada ao ATLAS.ERP (id ${company.external_id}) · última sincronização ${company.synced_at ? fmtDateTime(company.synced_at) : "—"}`
                  : "Cadastro local (não vinculado ao ERP)."
              }
              actions={
                linked ? (
                  <ActionForm action={unlinkAtlasCompanyAction} confirm="Remover o vínculo com o ATLAS.ERP? Os dados atuais são mantidos.">
                    <SubmitButton size="sm" variant="ghost">
                      <Unlink className="size-3.5" aria-hidden />
                      Desvincular
                    </SubmitButton>
                  </ActionForm>
                ) : null
              }
            />
            <CardBody>
              <DefinitionList
                items={[
                  [COMPANY_FIELD_LABELS.name, company.name],
                  [COMPANY_FIELD_LABELS.legal_name, company.legal_name],
                  [COMPANY_FIELD_LABELS.document, company.document_formatted],
                  [COMPANY_FIELD_LABELS.email, company.email],
                  [COMPANY_FIELD_LABELS.phone, company.phone],
                  ["Endereço completo", company.address_line],
                  ["Atualizado em", fmtDateTime(company.updated_at)],
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Histórico" description="Alterações, vínculos e sincronizações." />
            <HistoryList rows={history.slice().reverse()} />
          </Card>
        </div>

        {managed ? (
          <Alert level="info" title="Gerenciado pelo ATLAS">
            Esta empresa está vinculada ao ATLAS.ERP pela integração: razão social, CNPJ, contato e endereço são atualizados automaticamente
            (evento company.upserted) e não podem ser editados aqui.
          </Alert>
        ) : (
        <Card>
          <CardHeader
            title="Editar manualmente"
            description={
              linked
                ? "A empresa está vinculada ao ATLAS.ERP: edições aqui serão sobrescritas na próxima sincronização. Prefira corrigir no ERP."
                : "CNPJ é validado pelos dígitos verificadores. Campos em branco ficam vazios."
            }
          />
          <CardBody>
            <ActionForm action={updateCompanyAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Nome fantasia" required htmlFor="c-name">
                <Input id="c-name" name="name" defaultValue={company.name} required minLength={2} maxLength={160} />
              </Field>
              <Field label="Razão social" htmlFor="c-legal">
                <Input id="c-legal" name="legal_name" defaultValue={company.legal_name ?? ""} maxLength={200} />
              </Field>
              <Field label="CNPJ" htmlFor="c-doc" hint="00.000.000/0000-00">
                <Input id="c-doc" name="document" defaultValue={company.document_formatted ?? ""} inputMode="numeric" maxLength={20} />
              </Field>
              <Field label="E-mail" htmlFor="c-email">
                <Input id="c-email" name="email" type="email" defaultValue={company.email ?? ""} maxLength={200} />
              </Field>
              <Field label="Telefone" htmlFor="c-phone">
                <Input id="c-phone" name="phone" defaultValue={company.phone ?? ""} maxLength={40} />
              </Field>
              <Field label="Endereço" htmlFor="c-address" className="lg:col-span-1">
                <Input id="c-address" name="address" defaultValue={company.address ?? ""} maxLength={300} placeholder="Rua, número, complemento, bairro" />
              </Field>
              <Field label="Cidade" htmlFor="c-city">
                <Input id="c-city" name="city" defaultValue={company.city ?? ""} maxLength={120} />
              </Field>
              <Field label="UF" htmlFor="c-state">
                <Input id="c-state" name="state" defaultValue={company.state ?? ""} maxLength={2} className="uppercase" />
              </Field>
              <Field label="CEP" htmlFor="c-zip">
                <Input id="c-zip" name="zip_code" defaultValue={company.zip_code ? formatCep(company.zip_code) : ""} inputMode="numeric" maxLength={10} />
              </Field>
              <div className="sm:col-span-2 lg:col-span-3">
                <SubmitButton>
                  <Building2 className="size-4" aria-hidden />
                  Salvar dados da empresa
                </SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
        )}
      </div>
    </>
  );
}

function show(field: string, value: string | null): string {
  if (!value) return "—";
  if (field === "document") return formatCnpj(value);
  if (field === "zip_code") return formatCep(value);
  return value;
}
