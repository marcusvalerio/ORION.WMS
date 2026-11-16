import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import type { Queryable } from "../db/types";
import { DomainError, NotFoundError } from "../errors";
import { parse } from "../validation";
import { formatCep, formatCnpj, isValidCnpj, onlyDigits } from "@/lib/cnpj";
import {
  getAtlasCompany,
  getAtlasSource,
  listActiveAtlasCompanies,
  type AtlasCompany,
  type AtlasSource,
} from "../integrations/atlas/connector";
import { audit, runOperation, type OpOptions } from "./common";

export const COMPANY_FIELDS = ["name", "legal_name", "document", "email", "phone", "address", "city", "state", "zip_code"] as const;
export type CompanyField = (typeof COMPANY_FIELDS)[number];

export const COMPANY_FIELD_LABELS: Record<CompanyField, string> = {
  name: "Nome fantasia",
  legal_name: "Razão social",
  document: "CNPJ",
  email: "E-mail",
  phone: "Telefone",
  address: "Endereço",
  city: "Cidade",
  state: "UF",
  zip_code: "CEP",
};

type CompanyData = { name: string } & Record<Exclude<CompanyField, "name">, string | null>;

export interface CompanyProfile extends CompanyData {
  id: string;
  is_demo: boolean;
  source: "local" | "atlas";
  external_id: string | null;
  synced_at: string | null;
  updated_at: string;
  /** Nome para documentos: razão social, ou o nome fantasia se não houver. */
  display_name: string;
  document_formatted: string | null;
  /** Endereço em uma linha (logradouro — cidade/UF — CEP). */
  address_line: string | null;
}

/**
 * Dados cadastrais da empresa para cabeçalho, relatórios, CSV e etiquetas.
 * Não exige permissão: são os dados públicos da própria empresa do usuário.
 */
export async function getCompanyProfile(db: Queryable, companyId: string): Promise<CompanyProfile> {
  const [c] = await db.query<Omit<CompanyProfile, "display_name" | "document_formatted" | "address_line">>(
    `select id, name, legal_name, document, email, phone, address, city, state, zip_code, is_demo, source, external_id,
            synced_at::text as synced_at, updated_at::text as updated_at
     from erp.companies where id = $1`,
    [companyId],
  );
  if (!c) throw new NotFoundError("Empresa");
  const cityState = [c.city, c.state].filter(Boolean).join("/");
  const parts = [c.address, cityState, c.zip_code ? `CEP ${formatCep(c.zip_code)}` : null].filter(Boolean);
  return {
    ...c,
    display_name: c.legal_name || c.name,
    document_formatted: c.document ? formatCnpj(c.document) : null,
    address_line: parts.length ? parts.join(" — ") : null,
  };
}

/** Linhas de identificação da empresa para o topo de relatórios e arquivos CSV. */
export function companyHeaderLines(p: CompanyProfile): string[] {
  return [
    p.display_name + (p.document_formatted ? ` — CNPJ ${p.document_formatted}` : ""),
    ...(p.address_line ? [p.address_line] : []),
  ];
}

// ---------------------------------------------------------------------------
// Edição manual
// ---------------------------------------------------------------------------

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres.`)
    .nullish()
    .transform((v) => (v ? v : null));

const companySchema = z.object({
  name: z.string({ error: "Nome fantasia é obrigatório." }).trim().min(2, "Nome fantasia é obrigatório.").max(160),
  legal_name: text(200),
  document: text(20)
    .transform((v) => (v ? onlyDigits(v) : null))
    .refine((v) => v === null || isValidCnpj(v), "CNPJ inválido (confira os dígitos verificadores)."),
  email: text(200)
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || z.email().safeParse(v).success, "E-mail inválido."),
  phone: text(40),
  address: text(300),
  city: text(120),
  state: text(40)
    .transform((v) => (v ? v.toUpperCase() : null))
    .refine((v) => v === null || /^[A-Z]{2}$/.test(v), "UF deve ter 2 letras."),
  zip_code: text(20)
    .transform((v) => (v ? onlyDigits(v) : null))
    .refine((v) => v === null || v.length === 8, "CEP deve ter 8 dígitos."),
});

function diff(before: CompanyData, after: CompanyData) {
  return COMPANY_FIELDS.filter((f) => (before[f] ?? null) !== (after[f] ?? null)).map((f) => ({
    field: f,
    label: COMPANY_FIELD_LABELS[f],
    current: before[f] ?? null,
    incoming: after[f] ?? null,
  }));
}
export type CompanyChange = ReturnType<typeof diff>[number];

/** Empresa vinculada pela API do ATLAS: dados mestres chegam por company.upserted (somente leitura no ORION). */
async function assertNotApiLinked(tx: Queryable, companyId: string) {
  const [l] = await tx.query<{ status: string }>(`select status from wms.atlas_links where company_id = $1`, [companyId]);
  if (l && l.status !== "disabled") {
    throw new DomainError("Empresa gerenciada pelo ATLAS: os dados mestres são atualizados automaticamente pela integração.", "ATLAS_MANAGED");
  }
}

async function lockCompany(tx: Queryable, companyId: string): Promise<CompanyProfile> {
  await assertNotApiLinked(tx, companyId);
  await tx.query(`select id from erp.companies where id = $1 for update`, [companyId]);
  return getCompanyProfile(tx, companyId);
}

async function writeCompany(
  tx: Queryable,
  companyId: string,
  d: CompanyData,
  link: { source: "local" | "atlas"; externalId: string | null; synced: boolean },
) {
  await tx.query(
    `update erp.companies set name = $2, legal_name = $3, document = $4, email = $5, phone = $6, address = $7, city = $8,
       state = $9, zip_code = $10, source = $11, external_id = $12,
       synced_at = case when $13::boolean then now() else synced_at end, updated_at = now()
     where id = $1`,
    [companyId, d.name, d.legal_name, d.document, d.email, d.phone, d.address, d.city, d.state, d.zip_code, link.source, link.externalId, link.synced],
  );
}

export async function updateCompanyProfile(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "company.manage");
  const d = parse(companySchema, input);
  return runOperation(ctx, "company.update", opts, async (tx) => {
    const before = await lockCompany(tx, ctx.user.companyId);
    const changes = diff(before, d);
    if (!changes.length) return { changed: 0 };
    await writeCompany(tx, ctx.user.companyId, d, { source: before.source, externalId: before.external_id, synced: false });
    await audit(tx, ctx, "company.updated", "company", ctx.user.companyId, d.name, { changes });
    return { changed: changes.length };
  });
}

// ---------------------------------------------------------------------------
// ATLAS.ERP (somente leitura)
// ---------------------------------------------------------------------------

export interface AtlasDeps {
  /** Fonte do ATLAS; omitida, usa ATLAS_DATABASE_URL. `null` simula variável ausente. */
  atlas?: AtlasSource | null;
}

async function requireAtlas(deps?: AtlasDeps): Promise<AtlasSource> {
  const source = deps && "atlas" in deps ? deps.atlas : await getAtlasSource();
  if (!source) {
    throw new DomainError(
      "Conexão com o ATLAS.ERP não configurada: defina ATLAS_DATABASE_URL no servidor (ver README).",
      "ATLAS_NOT_CONFIGURED",
    );
  }
  return source;
}

async function atlasCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DomainError) throw error;
    console.error("[atlas]", (error as Error)?.message);
    throw new DomainError("Não foi possível consultar o ATLAS.ERP. Verifique a conexão e as permissões do usuário somente leitura.", "ATLAS_UNAVAILABLE");
  }
}

/** Converte o registro do ATLAS no formato do WMS; recusa CNPJ inválido e empresa inativa. */
export function normalizeAtlasCompany(a: AtlasCompany): { data: CompanyData; warnings: string[] } {
  if (a.status !== "active") throw new DomainError(`A empresa “${a.name}” está inativa no ATLAS.ERP e não pode ser vinculada/sincronizada.`, "ATLAS_INACTIVE");
  const document = onlyDigits(a.document);
  if (!isValidCnpj(document)) throw new DomainError(`O CNPJ da empresa “${a.name}” no ATLAS.ERP é inválido (${a.document ?? "vazio"}). Corrija o cadastro no ERP.`, "ATLAS_INVALID_CNPJ");
  const warnings: string[] = [];
  const clean = (v: string | null) => (v && v.trim() ? v.trim() : null);
  const state = clean(a.state)?.toUpperCase() ?? null;
  const zip = a.zip_code ? onlyDigits(a.zip_code) : null;
  const email = clean(a.email)?.toLowerCase() ?? null;
  if (state && !/^[A-Z]{2}$/.test(state)) warnings.push(`UF “${a.state}” ignorada (formato inválido).`);
  if (zip && zip.length !== 8) warnings.push(`CEP “${a.zip_code}” ignorado (formato inválido).`);
  if (email && !z.email().safeParse(email).success) warnings.push(`E-mail “${a.email}” ignorado (formato inválido).`);
  return {
    data: {
      name: clean(a.name) ?? clean(a.legal_name) ?? "Empresa",
      legal_name: clean(a.legal_name),
      document,
      email: email && z.email().safeParse(email).success ? email : null,
      phone: clean(a.phone),
      address: clean(a.address),
      city: clean(a.city),
      state: state && /^[A-Z]{2}$/.test(state) ? state : null,
      zip_code: zip && zip.length === 8 ? zip : null,
    },
    warnings,
  };
}

/** Impressão digital dos dados lidos do ATLAS (garante que o que foi confirmado é o que será gravado). */
export function fingerprint(d: CompanyData): string {
  return createHash("sha256")
    .update(JSON.stringify(COMPANY_FIELDS.map((f) => d[f])))
    .digest("hex")
    .slice(0, 16);
}

export interface AtlasCompanyOption {
  id: string;
  name: string;
  legal_name: string | null;
  document: string | null;
  document_valid: boolean;
  city: string | null;
  state: string | null;
  linked_here: boolean;
}

export async function listAtlasCompanies(ctx: Ctx, deps?: AtlasDeps): Promise<AtlasCompanyOption[]> {
  assertCan(ctx, "company.manage");
  const source = await requireAtlas(deps);
  const [rows, current] = await Promise.all([atlasCall(() => listActiveAtlasCompanies(source)), getCompanyProfile(ctx.db, ctx.user.companyId)]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    legal_name: r.legal_name,
    document: r.document,
    document_valid: isValidCnpj(r.document),
    city: r.city,
    state: r.state,
    linked_here: current.source === "atlas" && current.external_id === r.id,
  }));
}

export async function linkAtlasCompany(ctx: Ctx, externalId: unknown, deps?: AtlasDeps, opts?: OpOptions) {
  assertCan(ctx, "company.manage");
  const id = parse(z.string({ error: "Selecione a empresa do ERP." }).trim().min(1, "Selecione a empresa do ERP.").max(64), externalId);
  const source = await requireAtlas(deps);
  const atlas = await atlasCall(() => getAtlasCompany(source, id));
  if (!atlas) throw new DomainError("Empresa não encontrada no ATLAS.ERP.", "ATLAS_NOT_FOUND");
  const { data, warnings } = normalizeAtlasCompany(atlas);
  return runOperation(ctx, "company.atlas_link", opts, async (tx) => {
    const before = await lockCompany(tx, ctx.user.companyId);
    const [taken] = await tx.query<{ id: string }>(
      `select id from erp.companies where source = 'atlas' and external_id = $1 and id <> $2`,
      [id, ctx.user.companyId],
    );
    if (taken) throw new DomainError("Esta empresa do ATLAS.ERP já está vinculada a outra empresa do WMS.", "ATLAS_ALREADY_LINKED");
    const changes = diff(before, data);
    await writeCompany(tx, ctx.user.companyId, data, { source: "atlas", externalId: id, synced: true });
    await audit(tx, ctx, "company.atlas_linked", "company", ctx.user.companyId, data.name, { external_id: id, changes, warnings });
    return { changed: changes.length, warnings };
  });
}

export interface SyncPreview {
  external_id: string;
  changes: CompanyChange[];
  warnings: string[];
  fingerprint: string;
  atlas_updated_at: string | null;
}

async function readLinked(ctx: Ctx, deps?: AtlasDeps) {
  const current = await getCompanyProfile(ctx.db, ctx.user.companyId);
  if (current.source !== "atlas" || !current.external_id) {
    throw new DomainError("A empresa não está vinculada ao ATLAS.ERP. Use “Buscar no ERP” para vincular.", "ATLAS_NOT_LINKED");
  }
  const source = await requireAtlas(deps);
  const externalId = current.external_id;
  const atlas = await atlasCall(() => getAtlasCompany(source, externalId));
  if (!atlas) throw new DomainError("O registro vinculado não existe mais no ATLAS.ERP. Desvincule e escolha outra empresa.", "ATLAS_NOT_FOUND");
  return { current, atlas, ...normalizeAtlasCompany(atlas) };
}

/** Mostra o que mudaria na sincronização, sem gravar nada. */
export async function previewCompanySync(ctx: Ctx, deps?: AtlasDeps): Promise<SyncPreview> {
  assertCan(ctx, "company.manage");
  const { current, atlas, data, warnings } = await readLinked(ctx, deps);
  return {
    external_id: current.external_id!,
    changes: diff(current, data),
    warnings,
    fingerprint: fingerprint(data),
    atlas_updated_at: atlas.updated_at,
  };
}

/**
 * Aplica os dados do registro vinculado. Se `expected` (impressão digital da
 * pré-visualização) for informado e os dados do ATLAS tiverem mudado depois
 * dela, recusa para que o usuário revise o que realmente será gravado.
 */
export async function syncCompany(ctx: Ctx, input: { expected?: string | null } = {}, deps?: AtlasDeps, opts?: OpOptions) {
  assertCan(ctx, "company.manage");
  const { current, data, warnings } = await readLinked(ctx, deps);
  if (input.expected && input.expected !== fingerprint(data)) {
    throw new DomainError("Os dados da empresa mudaram no ATLAS.ERP depois da pré-visualização. Revise as alterações e confirme novamente.", "ATLAS_CHANGED");
  }
  return runOperation(ctx, "company.atlas_sync", opts, async (tx) => {
    const before = await lockCompany(tx, ctx.user.companyId);
    if (before.external_id !== current.external_id) throw new DomainError("O vínculo com o ATLAS.ERP foi alterado. Atualize a página.", "ATLAS_CHANGED");
    const changes = diff(before, data);
    await writeCompany(tx, ctx.user.companyId, data, { source: "atlas", externalId: before.external_id, synced: true });
    await audit(tx, ctx, "company.atlas_synced", "company", ctx.user.companyId, data.name, {
      external_id: before.external_id,
      changes,
      warnings,
    });
    return { changed: changes.length, warnings };
  });
}

/** Desfaz o vínculo; os dados atuais permanecem e passam a ser editados localmente. */
export async function unlinkAtlasCompany(ctx: Ctx, opts?: OpOptions) {
  assertCan(ctx, "company.manage");
  return runOperation(ctx, "company.atlas_unlink", opts, async (tx) => {
    const before = await lockCompany(tx, ctx.user.companyId);
    if (before.source !== "atlas") throw new DomainError("A empresa já não está vinculada ao ATLAS.ERP.", "ATLAS_NOT_LINKED");
    await tx.query(`update erp.companies set source = 'local', external_id = null, updated_at = now() where id = $1`, [ctx.user.companyId]);
    await audit(tx, ctx, "company.atlas_unlinked", "company", ctx.user.companyId, before.name, { external_id: before.external_id });
    return { ok: true };
  });
}
