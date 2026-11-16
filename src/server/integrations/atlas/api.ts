import "server-only";
import type { Db } from "../../db/types";
import { atlasEnv, type AtlasEnv } from "./config";
import { KEY_ID_HEADER, SIG_HEADER, TS_HEADER, verifySignature } from "./crypto";
import { linkRequestSchema } from "./contract";
import {
  AtlasApplyError,
  balanceItems,
  capabilities,
  disableLink,
  documentStatus,
  findLinkByKey,
  receiveAtlasBatch,
  receiveAtlasEvent,
  rejected,
  upsertLink,
  type ApiResult,
  type LinkRow,
} from "../../services/atlas-sync";

/**
 * API servidor-a-servidor /api/atlas/v1 (contrato 3.4). As rotas do Next só
 * adaptam a requisição para estas funções, que os testes chamam diretamente.
 * Nenhuma delas usa cookies: a empresa vem SOMENTE do key_id assinado.
 */

export interface ApiRequest {
  method: string;
  /** pathname + query exatamente como chamados (entra na assinatura). */
  pathWithQuery: string;
  headers: Headers;
  body: string;
}

export const MAX_EVENT_BYTES = 1_048_576;
export const MAX_BATCH_BYTES = 10 * 1_048_576;
const RATE_PER_MINUTE = 600;

type GlobalRate = typeof globalThis & { __orionAtlasRate?: Map<string, { minute: number; n: number }> };
const g = globalThis as GlobalRate;

function rateLimited(companyId: string): boolean {
  const map = (g.__orionAtlasRate ??= new Map());
  const minute = Math.floor(Date.now() / 60_000);
  const cur = map.get(companyId);
  if (!cur || cur.minute !== minute) {
    map.set(companyId, { minute, n: 1 });
    return false;
  }
  cur.n++;
  return cur.n > RATE_PER_MINUTE;
}

function eventIdOf(body: string): string | null {
  try {
    const id = (JSON.parse(body) as { id?: unknown })?.id;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/** Autentica pela credencial HMAC da empresa (X-Astraeus-*). */
export async function authenticateCompany(db: Db, req: ApiRequest): Promise<{ ok: true; link: LinkRow } | { ok: false; result: ApiResult }> {
  const keyId = req.headers.get(KEY_ID_HEADER)?.trim();
  const eventId = req.method === "POST" ? eventIdOf(req.body) : null;
  if (!keyId) return { ok: false, result: rejected(eventId, "unknown_key", "Cabeçalho X-Astraeus-Key-Id ausente.", 401, false) };
  const found = await findLinkByKey(db, keyId);
  if (!found) return { ok: false, result: rejected(eventId, "unknown_key", "key_id desconhecido.", 401, false) };
  const check = verifySignature(
    { timestamp: req.headers.get(TS_HEADER), signature: req.headers.get(SIG_HEADER), method: req.method, pathWithQuery: req.pathWithQuery, body: req.body },
    found.secrets,
  );
  if (!check.ok) return { ok: false, result: rejected(eventId, check.code, check.message, 401, false) };
  if (rateLimited(found.link.company_id)) return { ok: false, result: rejected(eventId, "rate_limited", "Limite de 600 requisições por minuto.", 429, true) };
  return { ok: true, link: found.link };
}

/** Autentica pela credencial de instalação (só para /links). */
export function authenticateInstall(req: ApiRequest, env: AtlasEnv = atlasEnv()): ApiResult | null {
  if (!env.installKeyId || !env.installSecret) {
    return rejected(null, "unknown_key", "Credencial de instalação não configurada (ORION_INSTALL_KEY_ID/ORION_INSTALL_SECRET).", 503, false);
  }
  const keyId = req.headers.get(KEY_ID_HEADER)?.trim();
  if (keyId !== env.installKeyId) return rejected(null, "unknown_key", "Credencial de instalação desconhecida.", 401, false);
  const check = verifySignature(
    { timestamp: req.headers.get(TS_HEADER), signature: req.headers.get(SIG_HEADER), method: req.method, pathWithQuery: req.pathWithQuery, body: req.body },
    [env.installSecret],
  );
  return check.ok ? null : rejected(null, check.code, check.message, 401, false);
}

function parseJson(body: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

export async function handlePostLink(db: Db, req: ApiRequest, env?: AtlasEnv): Promise<ApiResult> {
  const denied = authenticateInstall(req, env);
  if (denied) return denied;
  const json = parseJson(req.body);
  if (!json.ok) return rejected(null, "invalid_envelope", "Corpo não é JSON.", 400, false);
  const parsed = linkRequestSchema.safeParse(json.value);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return rejected(null, "validation_failed", `${i.path.join(".")}: ${i.message}`, 400, false);
  }
  try {
    const r = await upsertLink(db, parsed.data);
    return { status: r.created ? 201 : 200, body: { status: r.status, atlas_company_id: parsed.data.atlas_company_id, orion_company_id: r.orion_company_id, key_id: parsed.data.key_id } };
  } catch (error) {
    if (error instanceof AtlasApplyError) return rejected(null, error.code, error.message, error.http, error.retryable);
    throw error;
  }
}

export async function handleDeleteLink(db: Db, req: ApiRequest, atlasCompanyId: string, env?: AtlasEnv): Promise<ApiResult> {
  const denied = authenticateInstall(req, env);
  if (denied) return denied;
  const r = await disableLink(db, atlasCompanyId);
  if (!r) return rejected(null, "company_not_linked", "Empresa não vinculada.", 404, false);
  return { status: 200, body: { status: "disabled", atlas_company_id: atlasCompanyId, orion_company_id: r.orion_company_id } };
}

export async function handleEvent(db: Db, req: ApiRequest): Promise<ApiResult> {
  if (Buffer.byteLength(req.body) > MAX_EVENT_BYTES) return rejected(eventIdOf(req.body), "payload_too_large", "Evento acima de 1 MB.", 413, false);
  const auth = await authenticateCompany(db, req);
  if (!auth.ok) return auth.result;
  const json = parseJson(req.body);
  if (!json.ok) return rejected(null, "invalid_envelope", "Corpo não é JSON.", 400, false);
  return receiveAtlasEvent(db, auth.link, json.value);
}

export async function handleBatch(db: Db, req: ApiRequest): Promise<ApiResult> {
  if (Buffer.byteLength(req.body) > MAX_BATCH_BYTES) return rejected(null, "payload_too_large", "Lote acima de 10 MB.", 413, false);
  const auth = await authenticateCompany(db, req);
  if (!auth.ok) return auth.result;
  const json = parseJson(req.body);
  if (!json.ok) return rejected(null, "invalid_envelope", "Corpo não é JSON.", 400, false);
  return receiveAtlasBatch(db, auth.link, json.value);
}

export async function handleCapabilities(db: Db, req: ApiRequest): Promise<ApiResult> {
  const auth = await authenticateCompany(db, req);
  if (!auth.ok) return auth.result;
  return { status: 200, body: capabilities() };
}

export async function handleDocument(db: Db, req: ApiRequest, type: string, id: string): Promise<ApiResult> {
  const auth = await authenticateCompany(db, req);
  if (!auth.ok) return auth.result;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return rejected(null, "validation_failed", "Identificador inválido.", 400, false);
  try {
    const doc = await documentStatus(db, auth.link.company_id, type, id);
    if (!doc) return rejected(null, "unknown_reference", "Documento não encontrado no ORION.", 404, false);
    return { status: 200, body: doc };
  } catch (error) {
    if (error instanceof AtlasApplyError) return rejected(null, error.code, error.message, error.http, error.retryable);
    throw error;
  }
}

export async function handleBalances(db: Db, req: ApiRequest): Promise<ApiResult> {
  const auth = await authenticateCompany(db, req);
  if (!auth.ok) return auth.result;
  const url = new URL(req.pathWithQuery, "http://orion.local");
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit")) || 500));
  const cursor = url.searchParams.get("cursor");
  const after = cursor ? Buffer.from(cursor, "base64url").toString("utf8") : null;
  const rows = await balanceItems(db, auth.link.company_id, { after, limit: limit + 1 });
  const page = rows.slice(0, limit);
  const next = rows.length > limit ? Buffer.from(page[page.length - 1].key, "utf8").toString("base64url") : null;
  return {
    status: 200,
    body: {
      atlas_company_id: auth.link.atlas_company_id,
      orion_company_id: auth.link.company_id,
      taken_at: new Date().toISOString(),
      items: page.map(({ key: _key, ...i }) => (void _key, i)),
      next_cursor: next,
    },
  };
}
