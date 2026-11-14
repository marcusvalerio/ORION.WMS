import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb } from "@/server/db/drivers";
import type { Db } from "@/server/db/types";
import { atlasFromDb, type AtlasSource } from "@/server/integrations/atlas/connector";
import {
  getCompanyProfile,
  linkAtlasCompany,
  listAtlasCompanies,
  previewCompanySync,
  syncCompany,
  unlinkAtlasCompany,
  updateCompanyProfile,
} from "@/server/services/company";
import { formatCnpj, isValidCnpj } from "@/lib/cnpj";
import { createTestEnv, key, type TestEnv } from "./helpers";

const ACME = "8f1c2d3e-0000-4000-8000-000000000001";
const INATIVA = "8f1c2d3e-0000-4000-8000-000000000002";
const CNPJ_RUIM = "8f1c2d3e-0000-4000-8000-000000000003";

/** Segundo banco PGlite simulando o schema do ATLAS.ERP. */
async function createAtlas(): Promise<Db> {
  const db = await createPgliteDb();
  await db.exec(`
    create table public.companies (
      id uuid primary key, name text not null, legal_name text, document text, email text, phone text,
      address text, city text, state text, zip_code text, status text not null default 'active',
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    insert into public.companies (id, name, legal_name, document, email, phone, address, city, state, zip_code, status) values
      ('${ACME}', 'Acme Peças', 'Acme Peças Industriais Ltda.', '11.222.333/0001-81', 'Fiscal@Acme.com.br', '(11) 4000-0000',
       'Rua das Indústrias, 100', 'São Paulo', 'sp', '01310-100', 'active'),
      ('${INATIVA}', 'Antiga Filial', 'Antiga Filial Ltda.', '12.345.678/0001-95', null, null, null, null, null, null, 'inactive'),
      ('${CNPJ_RUIM}', 'Cadastro Errado', 'Cadastro Errado SA', '11.111.111/1111-11', null, null, null, null, null, null, 'active');
  `);
  return db;
}

describe("CNPJ", () => {
  it("valida dígitos verificadores e formata", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000180")).toBe(false);
    expect(isValidCnpj("11111111111111")).toBe(false);
    expect(isValidCnpj("123")).toBe(false);
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });
});

describe("Dados da empresa e conector ATLAS.ERP", () => {
  let env: TestEnv;
  let atlasDb: Db;
  let atlas: AtlasSource;

  beforeAll(async () => {
    atlasDb = await createAtlas();
    atlas = atlasFromDb(atlasDb);
  });
  beforeEach(async () => {
    env = await createTestEnv();
  });

  it("edição manual valida CNPJ, UF e CEP, audita e só o admin pode", async () => {
    const admin = env.as("admin");
    await expect(updateCompanyProfile(admin, { name: "MetalSupply", document: "11.222.333/0001-80" })).rejects.toThrow(/CNPJ inválido/);
    await expect(updateCompanyProfile(admin, { name: "MetalSupply", state: "São Paulo" })).rejects.toThrow(/UF/);
    await expect(updateCompanyProfile(env.as("supervisor"), { name: "MetalSupply" })).rejects.toThrow(/permissão/);
    const r = await updateCompanyProfile(admin, {
      name: "MetalSupply Componentes",
      legal_name: "MetalSupply Componentes Ltda.",
      document: "11.222.333/0001-81",
      zip_code: "01310-100",
      state: "sp",
      city: "São Paulo",
      address: "Av. Paulista, 1000",
    });
    expect(r.changed).toBeGreaterThan(0);
    const p = await getCompanyProfile(env.db, admin.user.companyId);
    expect(p).toMatchObject({ document: "11222333000181", state: "SP", zip_code: "01310100", source: "local" });
    expect(p.display_name).toBe("MetalSupply Componentes Ltda.");
    expect(p.document_formatted).toBe("11.222.333/0001-81");
    expect(p.address_line).toBe("Av. Paulista, 1000 — São Paulo/SP — CEP 01310-100");
    const audit = await env.one<{ n: number }>(`select count(*) as n from wms.audit_log where action = 'company.updated'`);
    expect(audit.n).toBe(1);
  });

  it("sem ATLAS_DATABASE_URL a busca explica como configurar", async () => {
    await expect(listAtlasCompanies(env.as("admin"), { atlas: null })).rejects.toThrow(/ATLAS_DATABASE_URL/);
    await expect(linkAtlasCompany(env.as("admin"), ACME, { atlas: null })).rejects.toThrow(/ATLAS_DATABASE_URL/);
  });

  it("lista só empresas ativas, sinalizando CNPJ inválido", async () => {
    const rows = await listAtlasCompanies(env.as("admin"), { atlas });
    expect(rows.map((r) => r.name)).toEqual(["Acme Peças", "Cadastro Errado"]);
    expect(rows.find((r) => r.id === ACME)?.document_valid).toBe(true);
    expect(rows.find((r) => r.id === CNPJ_RUIM)?.document_valid).toBe(false);
    await expect(listAtlasCompanies(env.as("auditor"), { atlas })).rejects.toThrow(/permissão/);
  });

  it("vincula, normaliza os campos e audita; recusa inativa e CNPJ inválido", async () => {
    const admin = env.as("admin");
    await expect(linkAtlasCompany(admin, INATIVA, { atlas })).rejects.toThrow(/inativa/);
    await expect(linkAtlasCompany(admin, CNPJ_RUIM, { atlas })).rejects.toThrow(/CNPJ .* inválido/);
    await expect(linkAtlasCompany(admin, "nao-existe", { atlas })).rejects.toThrow(/não encontrada/);
    await linkAtlasCompany(admin, ACME, { atlas }, { idempotencyKey: key() });
    const p = await getCompanyProfile(env.db, admin.user.companyId);
    expect(p).toMatchObject({
      name: "Acme Peças",
      legal_name: "Acme Peças Industriais Ltda.",
      document: "11222333000181",
      email: "fiscal@acme.com.br",
      state: "SP",
      zip_code: "01310100",
      source: "atlas",
      external_id: ACME,
    });
    expect(p.synced_at).not.toBeNull();
    const a = await env.one<{ details: { external_id: string } }>(`select details from wms.audit_log where action = 'company.atlas_linked'`);
    expect(a.details.external_id).toBe(ACME);
    // O cabeçalho da sessão passa a mostrar o nome vindo do ERP.
    const s = await env.one<{ name: string }>(`select name from erp.companies where id = $1`, [admin.user.companyId]);
    expect(s.name).toBe("Acme Peças");
  });

  it("sincronização mostra o que mudou, exige confirmação do mesmo conteúdo e nunca escreve no ATLAS", async () => {
    const admin = env.as("admin");
    await linkAtlasCompany(admin, ACME, { atlas });
    let preview = await previewCompanySync(admin, { atlas });
    expect(preview.changes).toEqual([]);

    await atlasDb.query(`update public.companies set phone = '(11) 5000-1234', city = 'Guarulhos', updated_at = now() where id = $1`, [ACME]);
    preview = await previewCompanySync(admin, { atlas });
    expect(preview.changes.map((c) => [c.label, c.current, c.incoming])).toEqual([
      ["Telefone", "(11) 4000-0000", "(11) 5000-1234"],
      ["Cidade", "São Paulo", "Guarulhos"],
    ]);
    // A pré-visualização não grava nada.
    expect((await getCompanyProfile(env.db, admin.user.companyId)).city).toBe("São Paulo");

    // Dados mudaram de novo depois da pré-visualização: confirmação recusada.
    await atlasDb.query(`update public.companies set city = 'Osasco' where id = $1`, [ACME]);
    await expect(syncCompany(admin, { expected: preview.fingerprint }, { atlas })).rejects.toThrow(/mudaram no ATLAS/);

    const fresh = await previewCompanySync(admin, { atlas });
    const r = await syncCompany(admin, { expected: fresh.fingerprint }, { atlas });
    expect(r.changed).toBe(2);
    expect(await getCompanyProfile(env.db, admin.user.companyId)).toMatchObject({ city: "Osasco", phone: "(11) 5000-1234" });
    const audit = await env.one<{ details: { changes: { field: string }[] } }>(
      `select details from wms.audit_log where action = 'company.atlas_synced'`,
    );
    expect(audit.details.changes.map((c) => c.field)).toEqual(["phone", "city"]);

    // Empresa inativada no ERP: sincronização recusada, dados preservados.
    await atlasDb.query(`update public.companies set status = 'inactive' where id = $1`, [ACME]);
    await expect(syncCompany(admin, {}, { atlas })).rejects.toThrow(/inativa/);
    await atlasDb.query(`update public.companies set status = 'active', city = 'São Paulo', phone = '(11) 4000-0000' where id = $1`, [ACME]);

    await unlinkAtlasCompany(admin);
    expect((await getCompanyProfile(env.db, admin.user.companyId)).source).toBe("local");
    await expect(previewCompanySync(admin, { atlas })).rejects.toThrow(/não está vinculada/);
  });

  it("o conector roda em transação READ ONLY", async () => {
    await expect(atlas.readOnly((q) => q.query(`update public.companies set name = 'x'`))).rejects.toThrow(/read-only/);
    const [row] = await atlasDb.query<{ name: string }>(`select name from public.companies where id = $1`, [ACME]);
    expect(row.name).toBe("Acme Peças");
  });

  it("o banco recusa CNPJ fora do formato e vínculo sem id externo", async () => {
    const id = env.as("admin").user.companyId;
    await expect(env.db.query(`update erp.companies set document = '11.222.333/0001-81' where id = $1`, [id])).rejects.toThrow();
    await expect(env.db.query(`update erp.companies set source = 'atlas' where id = $1`, [id])).rejects.toThrow();
  });
});
