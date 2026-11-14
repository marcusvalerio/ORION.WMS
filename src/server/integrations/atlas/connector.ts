import "server-only";
import type { Db, Queryable } from "../../db/types";

/**
 * Conector SOMENTE LEITURA com o banco do ATLAS.ERP.
 *
 * - Configurado por `ATLAS_DATABASE_URL` (variável só do servidor; nunca use o
 *   prefixo NEXT_PUBLIC_). Recomenda-se um usuário do Postgres com GRANT SELECT
 *   apenas em public.companies (ver README).
 * - Toda leitura roda em `SET TRANSACTION READ ONLY`: mesmo que a credencial
 *   tivesse permissão de escrita, o Postgres recusa qualquer INSERT/UPDATE/DELETE.
 * - Só a tabela de empresas é lida (pedido do usuário: apenas dados da empresa).
 */

export interface AtlasCompany {
  id: string;
  name: string;
  legal_name: string | null;
  document: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  status: string;
  updated_at: string | null;
}

export interface AtlasSource {
  /** Executa `fn` numa transação READ ONLY no banco do ATLAS. */
  readOnly<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

/** Cria a fonte a partir de qualquer conexão (Postgres real ou PGlite nos testes). */
export function atlasFromDb(db: Db): AtlasSource {
  return {
    readOnly: (fn) =>
      db.transaction(async (tx) => {
        await tx.query("set transaction read only");
        return fn(tx);
      }),
  };
}

export function isAtlasConfigured(): boolean {
  return Boolean(process.env.ATLAS_DATABASE_URL?.trim());
}

type GlobalWithAtlas = typeof globalThis & { __orionAtlas?: { url: string; source: Promise<AtlasSource> } };
const g = globalThis as GlobalWithAtlas;

/** Fonte configurada pelo ambiente, ou null quando ATLAS_DATABASE_URL não existe. */
export async function getAtlasSource(): Promise<AtlasSource | null> {
  const url = process.env.ATLAS_DATABASE_URL?.trim();
  if (!url) return null;
  if (!g.__orionAtlas || g.__orionAtlas.url !== url) {
    const source = import("../../db/drivers")
      .then(({ createPostgresDb }) => createPostgresDb(url, { max: 2, statementTimeoutMs: 10_000 }))
      .then(atlasFromDb);
    source.catch(() => {
      g.__orionAtlas = undefined;
    });
    g.__orionAtlas = { url, source };
  }
  return g.__orionAtlas.source;
}

const COLUMNS = `id::text as id, name, legal_name, document, email, phone, address, city, state, zip_code, status,
  updated_at::text as updated_at`;

export async function listActiveAtlasCompanies(source: AtlasSource): Promise<AtlasCompany[]> {
  return source.readOnly((q) =>
    q.query<AtlasCompany>(`select ${COLUMNS} from public.companies where status = 'active' order by name limit 200`),
  );
}

export async function getAtlasCompany(source: AtlasSource, id: string): Promise<AtlasCompany | null> {
  const [row] = await source.readOnly((q) =>
    q.query<AtlasCompany>(`select ${COLUMNS} from public.companies where id::text = $1`, [id]),
  );
  return row ?? null;
}
