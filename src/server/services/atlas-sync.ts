import "server-only";
import { randomUUID } from "node:crypto";
import type { Db, Queryable } from "../db/types";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError, NotFoundError } from "../errors";
import {
  A2O_TYPES,
  envelopeSchema,
  payloadSchemaFor,
  CONTRACT_VERSION,
  type A2OPayload,
  type Envelope,
  type ErrorCode,
  type LaunchClaims,
  type LinkRequest,
} from "../integrations/atlas/contract";
import { decryptSecret, encryptSecret, sha256Hex } from "../integrations/atlas/crypto";
import { ensureSystemUser, systemCtx } from "../integrations/atlas/system";
import { SsoError } from "../integrations/atlas/sso";
import { checkAtlasAccess, type ClientOptions } from "../integrations/atlas/client";
import { atlasEnv } from "../integrations/atlas/config";
import { enqueueIntegrationEvent, nextCode, recordTaskEvent, round3 } from "./common";
import { addStock, changeReserved, insertMovement, lockBalanceById, suggestLocations } from "./stock-core";
import { importSalesOrder, cancelOrder, cancelOrderLine } from "./outbound";
import { cancelReceipt } from "./receiving";
import { createRequisition, cancelRequisition } from "./production";
import { createWarehouse } from "./warehouse";
import type { Role } from "@/lib/permissions";

/**
 * Sincronização ATLAS.ERP → ORION.WMS (contrato v1, seções 2–6).
 *
 * - Vínculo de empresa (POST/DELETE /api/atlas/v1/links, credencial de instalação).
 * - Entrada de eventos (POST /api/atlas/v1/events): idempotência pelo `id` do
 *   envelope (wms.atlas_inbox, na MESMA transação do efeito), ordem por agregado
 *   (`aggregate.sequence`, wms.atlas_aggregate_state), dependências
 *   (`dependency_missing`) e aplicação pelos serviços reais (pedido de saída,
 *   requisição, recebimento, estoque) com um usuário de sistema por empresa.
 * - SSO: anti-replay, empresa vinculada e provisionamento JIT do usuário.
 * - Checagem periódica de acesso no ATLAS (revogação).
 */

// -----------------------------------------------------------------------------
// Erros do contrato
// -----------------------------------------------------------------------------

export class AtlasApplyError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly http: number,
    public readonly retryable: boolean,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AtlasApplyError";
  }
}

const dependency = (message: string) => new AtlasApplyError("dependency_missing", message, 422, true);
const unknownRef = (message: string) => new AtlasApplyError("unknown_reference", message, 422, false);
const inProgress = (message: string) => new AtlasApplyError("document_in_progress", message, 409, false);
const alreadyShipped = (message: string) => new AtlasApplyError("already_shipped", message, 409, false);

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

export function rejected(eventId: string | null, code: ErrorCode, message: string, http: number, retryable: boolean, extra: Record<string, unknown> = {}): ApiResult {
  return { status: http, body: { status: "rejected", event_id: eventId, error: { code, message, retryable, ...extra } } };
}

/** Tipos de "estado completo": aceitam lacunas de sequência (3.5). */
const STATE_TYPES = new Set([
  "company.upserted",
  "company.deactivated",
  "integration.activated",
  "user_access.granted",
  "user_access.revoked",
  "unit.upserted",
  "product.upserted",
  "product.deactivated",
  "customer.upserted",
  "supplier.upserted",
]);

/** Aceitos com a integração suspensa (o restante aguarda na outbox do ATLAS). */
const ALLOWED_WHEN_SUSPENDED = new Set(["company.upserted", "company.deactivated", "integration.activated", "user_access.granted", "user_access.revoked"]);

export function capabilities() {
  return {
    contract: "astraeus.atlas-orion",
    version: CONTRACT_VERSION,
    types: Object.fromEntries(A2O_TYPES.map((t) => [t, [1]])),
    batch_max: 500,
    max_event_bytes: 1_048_576,
  };
}

// -----------------------------------------------------------------------------
// Vínculo
// -----------------------------------------------------------------------------

export interface LinkRow {
  company_id: string;
  atlas_company_id: string;
  key_id: string;
  secret_ciphertext: string;
  previous_key_id: string | null;
  previous_secret_ciphertext: string | null;
  previous_valid_until: string | null;
  status: "activating" | "active" | "suspended" | "disabled";
  stock_owner: string;
  require_invoice_before_ship: boolean;
  system_user_id: string | null;
}

const LINK_COLS = `company_id, atlas_company_id, key_id, secret_ciphertext, previous_key_id, previous_secret_ciphertext,
  previous_valid_until::text as previous_valid_until, status, stock_owner, require_invoice_before_ship, system_user_id`;

/** Segredos aceitos para o key_id informado (atual e, durante a rotação, o anterior). */
export async function findLinkByKey(q: Queryable, keyId: string): Promise<{ link: LinkRow; secrets: string[] } | null> {
  const [link] = await q.query<LinkRow>(
    `select ${LINK_COLS} from wms.atlas_links
     where key_id = $1 or (previous_key_id = $1 and previous_valid_until > now()) limit 1`,
    [keyId],
  );
  if (!link) return null;
  const secrets: string[] = [];
  if (link.key_id === keyId) secrets.push(decryptSecret(link.secret_ciphertext));
  if (link.previous_secret_ciphertext && link.previous_valid_until && new Date(link.previous_valid_until) > new Date()) {
    if ((link.previous_key_id ?? link.key_id) === keyId) secrets.push(decryptSecret(link.previous_secret_ciphertext));
  }
  return secrets.length ? { link, secrets } : null;
}

export async function getLink(q: Queryable, companyId: string): Promise<LinkRow | null> {
  const [link] = await q.query<LinkRow>(`select ${LINK_COLS} from wms.atlas_links where company_id = $1`, [companyId]);
  return link ?? null;
}

const digits = (v: string | null | undefined, len: number) => {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length === len ? d : null;
};
const email = (v: string | null | undefined) => (v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()) ? v.trim().toLowerCase() : null);
const uf = (v: string | null | undefined) => (v && /^[A-Za-z]{2}$/.test(v.trim()) ? v.trim().toUpperCase() : null);

function companyColumns(c: LinkRequest["company"]) {
  return [c.name.trim(), c.legal_name ?? null, digits(c.document, 14), email(c.email), c.phone ?? null, c.address ?? null, c.city ?? null, uf(c.state), digits(c.zip_code, 8)];
}

async function auditSys(tx: Queryable, companyId: string, userId: string | null, action: string, entityType: string, entityId: string | null, code: string | null, details: Record<string, unknown> = {}) {
  await tx.query(
    `insert into wms.audit_log (company_id, user_id, action, entity_type, entity_id, entity_code, details) values ($1,$2,$3,$4,$5,$6,$7)`,
    [companyId, userId, action, entityType, entityId, code, JSON.stringify(details)],
  );
}

/**
 * POST /links: cria/atualiza o vínculo. Empresa: a já vinculada a este
 * atlas_company_id; senão uma `local` com o mesmo CNPJ e sem outro vínculo;
 * senão uma nova. Segredo novo com segredo anterior aceito por N horas (rotação).
 */
export async function upsertLink(db: Db, req: LinkRequest): Promise<{ orion_company_id: string; status: string; created: boolean }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.query<LinkRow>(`select ${LINK_COLS} from wms.atlas_links where atlas_company_id = $1 for update`, [req.atlas_company_id]);
    const [keyOwner] = await tx.query<{ company_id: string }>(`select company_id from wms.atlas_links where key_id = $1`, [req.key_id]);
    if (keyOwner && keyOwner.company_id !== existing?.company_id) {
      throw new AtlasApplyError("company_mismatch", "key_id já usado por outra empresa.", 409, false);
    }
    const cols = companyColumns(req.company);
    let companyId: string;
    let created = false;
    if (existing) {
      companyId = existing.company_id;
    } else {
      const [byExternal] = await tx.query<{ id: string }>(`select id from erp.companies where source = 'atlas' and external_id = $1`, [req.atlas_company_id]);
      const doc = cols[2];
      const [byDocument] = !byExternal && doc
        ? await tx.query<{ id: string; source: string }>(
            `select c.id, c.source from erp.companies c where c.document = $1 and not c.is_demo
               and not exists (select 1 from wms.atlas_links l where l.company_id = c.id) order by c.created_at limit 1`,
            [doc],
          )
        : [];
      if (byDocument && byDocument.source !== "local") {
        throw new AtlasApplyError("company_mismatch", "CNPJ já vinculado a outra empresa do ATLAS.", 409, false);
      }
      if (byExternal) companyId = byExternal.id;
      else if (byDocument) companyId = byDocument.id;
      else {
        const [c] = await tx.query<{ id: string }>(`insert into erp.companies (name, source, external_id) values ($1, 'atlas', $2) returning id`, [
          cols[0],
          req.atlas_company_id,
        ]);
        companyId = c.id;
        created = true;
      }
    }
    await tx.query(
      `update erp.companies set name = $2, legal_name = $3, document = $4, email = $5, phone = $6, address = $7, city = $8, state = $9,
              zip_code = $10, source = 'atlas', external_id = $11, synced_at = now(), updated_at = now() where id = $1`,
      [companyId, ...cols, req.atlas_company_id],
    );
    const systemUserId = await ensureSystemUser(tx, companyId);
    const cipher = encryptSecret(req.secret);
    const hours = req.previous_secret_hours ?? 24;
    if (existing) {
      const sameSecret = decryptSecret(existing.secret_ciphertext) === req.secret && existing.key_id === req.key_id;
      if (!sameSecret) {
        await tx.query(
          `update wms.atlas_links set previous_key_id = key_id, previous_secret_ciphertext = secret_ciphertext,
                  previous_valid_until = now() + make_interval(hours => $4), key_id = $2, secret_ciphertext = $3, updated_at = now()
           where company_id = $1`,
          [companyId, req.key_id, cipher, hours],
        );
        await auditSys(tx, companyId, systemUserId, "atlas.secret_rotated", "atlas_link", companyId, req.atlas_company_id, { key_id: req.key_id });
      }
      if (existing.status === "disabled") {
        await tx.query(`update wms.atlas_links set status = 'activating', disabled_at = null, updated_at = now() where company_id = $1`, [companyId]);
      }
    } else {
      await tx.query(
        `insert into wms.atlas_links (company_id, atlas_company_id, key_id, secret_ciphertext, status, system_user_id)
         values ($1, $2, $3, $4, 'activating', $5)`,
        [companyId, req.atlas_company_id, req.key_id, cipher, systemUserId],
      );
      await auditSys(tx, companyId, systemUserId, "atlas.link_created", "atlas_link", companyId, req.atlas_company_id, { key_id: req.key_id, created });
    }
    if (req.admin) {
      await provisionAtlasUser(tx, companyId, systemUserId, {
        atlasUserId: req.admin.atlas_user_id,
        email: req.admin.email,
        name: req.admin.name,
        role: "admin",
        accessVersion: 1,
        warehouses: null,
      });
    }
    const [link] = await tx.query<{ status: string }>(`select status from wms.atlas_links where company_id = $1`, [companyId]);
    return { orion_company_id: companyId, status: link.status, created };
  });
}

/** DELETE /links/{atlas_company_id}: desativa o vínculo e os usuários vinculados (dados ficam para auditoria). */
export async function disableLink(db: Db, atlasCompanyId: string): Promise<{ orion_company_id: string } | null> {
  return db.transaction(async (tx) => {
    const [link] = await tx.query<LinkRow>(`select ${LINK_COLS} from wms.atlas_links where atlas_company_id = $1 for update`, [atlasCompanyId]);
    if (!link) return null;
    await tx.query(`update wms.atlas_links set status = 'disabled', disabled_at = now(), updated_at = now() where company_id = $1`, [link.company_id]);
    await tx.query(`update wms.users set active = false, updated_at = now() where company_id = $1 and atlas_user_id is not null`, [link.company_id]);
    await auditSys(tx, link.company_id, link.system_user_id, "atlas.link_disabled", "atlas_link", link.company_id, atlasCompanyId);
    return { orion_company_id: link.company_id };
  });
}

// -----------------------------------------------------------------------------
// Usuários (JIT e eventos de acesso)
// -----------------------------------------------------------------------------

export interface AtlasUserInput {
  atlasUserId: string;
  email: string;
  name: string;
  role: Role;
  accessVersion: number;
  /** Códigos de depósito ORION; null/undefined = manter; [] = todos. */
  warehouses: string[] | null | undefined;
}

/**
 * Provisionamento (2.6): procura por atlas_user_id; senão pelo e-mail NA MESMA
 * empresa (vincula); senão cria sem senha. Atualiza nome, e-mail, perfil,
 * versão de acesso e depósitos. Versão menor que a gravada não rebaixa nada.
 */
export async function provisionAtlasUser(
  tx: Queryable,
  companyId: string,
  actorId: string | null,
  u: AtlasUserInput,
  opts: { activate?: boolean } = {},
): Promise<{ userId: string; created: boolean; stale: boolean }> {
  const mail = u.email.trim().toLowerCase();
  let [row] = await tx.query<{ id: string; atlas_access_version: number | null; active: boolean }>(
    `select id, atlas_access_version, active from wms.users where company_id = $1 and atlas_user_id = $2 for update`,
    [companyId, u.atlasUserId],
  );
  if (!row) {
    [row] = await tx.query<{ id: string; atlas_access_version: number | null; active: boolean }>(
      `select id, atlas_access_version, active from wms.users where company_id = $1 and lower(email) = $2 and atlas_user_id is null and not is_system for update`,
      [companyId, mail],
    );
    if (row) {
      await tx.query(
        `update wms.users set atlas_user_id = $2, password_hash = null, must_change_password = false, updated_at = now() where id = $1`,
        [row.id, u.atlasUserId],
      );
    }
  }
  let created = false;
  if (!row) {
    const [ins] = await tx.query<{ id: string }>(
      `insert into wms.users (company_id, name, email, role, password_hash, active, atlas_user_id, atlas_access_version)
       values ($1, $2, $3, $4, null, true, $5, $6) returning id`,
      [companyId, u.name.trim(), mail, u.role, u.atlasUserId, u.accessVersion],
    );
    row = { id: ins.id, atlas_access_version: u.accessVersion, active: true };
    created = true;
  } else if (row.atlas_access_version != null && u.accessVersion < row.atlas_access_version) {
    return { userId: row.id, created: false, stale: true };
  }
  const [dup] = await tx.query(`select 1 from wms.users where company_id = $1 and lower(email) = $2 and id <> $3`, [companyId, mail, row.id]);
  await tx.query(
    `update wms.users set name = $2, email = case when $6 then email else $3 end, role = $4, atlas_access_version = $5,
            active = case when $7 then true else active end, updated_at = now() where id = $1`,
    [row.id, u.name.trim(), mail, u.role, u.accessVersion, Boolean(dup), opts.activate !== false],
  );
  if (u.warehouses) {
    const codes = u.warehouses.map((c) => c.trim().toUpperCase()).filter(Boolean);
    const whs = codes.length
      ? await tx.query<{ id: string }>(`select id from wms.warehouses where company_id = $1 and upper(code) = any($2::text[])`, [companyId, codes])
      : [];
    await tx.query(`delete from wms.user_warehouses where user_id = $1`, [row.id]);
    for (const w of whs) {
      await tx.query(`insert into wms.user_warehouses (user_id, warehouse_id, company_id, created_by) values ($1,$2,$3,$4)`, [row.id, w.id, companyId, actorId]);
    }
  }
  await auditSys(tx, companyId, actorId, created ? "user.provisioned_from_atlas" : "user.updated_from_atlas", "user", row.id, mail, {
    role: u.role,
    access_version: u.accessVersion,
    warehouses: u.warehouses ?? "mantidos",
  });
  return { userId: row.id, created, stale: false };
}

/**
 * SSO (2.4, passos 4–6): uso único do jti, empresa vinculada e provisionamento.
 * As claims já foram verificadas (assinatura, aud, iss, exp, state).
 */
export async function consumeLaunchClaims(db: Db, claims: LaunchClaims): Promise<{ userId: string; companyId: string }> {
  return db.transaction(async (tx) => {
    await tx.query(`delete from wms.sso_token_uses where expires_at < now() - interval '1 day'`);
    const [company] = await tx.query<{ id: string; status: string; system_user_id: string | null }>(
      `select c.id, l.status, l.system_user_id from erp.companies c join wms.atlas_links l on l.company_id = c.id
       where c.source = 'atlas' and c.external_id = $1 and c.id = $2`,
      [claims.atlas_company_id, claims.orion_company_id],
    );
    const used = await tx.query(
      `insert into wms.sso_token_uses (jti, company_id, atlas_user_id, expires_at) values ($1, $2, $3, to_timestamp($4))
       on conflict (jti) do nothing returning jti`,
      [claims.jti, company?.id ?? null, claims.sub, claims.exp],
    );
    if (used.length === 0) throw new SsoError("token_replayed", "Este link de acesso já foi usado.");
    if (!company || !["active", "activating"].includes(company.status)) {
      throw new SsoError("company_not_linked", "Empresa não vinculada ao ORION ou integração suspensa.", 403);
    }
    const result = await provisionAtlasUser(tx, company.id, company.system_user_id, {
      atlasUserId: claims.sub,
      email: claims.email,
      name: claims.name,
      role: claims.orion_role,
      accessVersion: claims.access_version,
      warehouses: claims.warehouses ?? null,
    });
    if (result.stale) throw new SsoError("access_revoked", "Acesso ao ORION revogado ou alterado no ATLAS. Entre novamente pelo ATLAS.", 403);
    await tx.query(`update wms.users set atlas_checked_at = now(), atlas_access_ok_at = now() where id = $1`, [result.userId]);
    await auditSys(tx, company.id, result.userId, "auth.sso_login", "user", result.userId, claims.email, { jti: claims.jti, access_version: claims.access_version });
    return { userId: result.userId, companyId: company.id };
  });
}

export async function auditSsoDenied(db: Db, claims: Partial<LaunchClaims> | null, code: string) {
  if (!claims?.orion_company_id) return;
  try {
    const [c] = await db.query<{ id: string }>(`select id from erp.companies where id::text = $1`, [claims.orion_company_id]);
    if (c) await auditSys(db, c.id, null, "auth.sso_denied", "user", null, claims.email ?? null, { code, atlas_user_id: claims.sub ?? null });
  } catch {
    // auditoria de negação nunca impede a resposta
  }
}

/**
 * Checagem periódica de acesso (2.7). Chamada a cada requisição de usuário
 * vinculado; só consulta o ATLAS quando a última checagem tem mais de
 * ORION_ATLAS_ACCESS_CHECK_SECONDS. Resposta `active:false` inativa o usuário;
 * ATLAS sem resposta mantém a sessão até ORION_ATLAS_ACCESS_GRACE_SECONDS desde a
 * última checagem bem-sucedida.
 */
export async function enforceAtlasAccess(
  db: Db,
  userId: string,
  opts: { env?: ReturnType<typeof atlasEnv>; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<"ok" | "denied"> {
  const env = opts.env ?? atlasEnv();
  const now = opts.now ?? new Date();
  const [u] = await db.query<{
    atlas_user_id: string;
    company_id: string;
    checked: string | null;
    ok_at: string | null;
    status: string | null;
    key_id: string | null;
    secret_ciphertext: string | null;
    system_user_id: string | null;
    atlas_access_version: number | null;
  }>(
    `select u.atlas_user_id, u.company_id, u.atlas_checked_at::text as checked, u.atlas_access_ok_at::text as ok_at, l.status, l.key_id,
            l.secret_ciphertext, l.system_user_id, u.atlas_access_version
     from wms.users u left join wms.atlas_links l on l.company_id = u.company_id where u.id = $1`,
    [userId],
  );
  if (!u?.atlas_user_id) return "ok";
  if (!u.status || !["active", "activating"].includes(u.status)) return "denied";
  const age = (iso: string | null) => (iso ? (now.getTime() - new Date(iso).getTime()) / 1000 : Infinity);
  if (age(u.checked) < env.checkSeconds) return "ok";
  // Só uma requisição concorrente faz a chamada (as demais seguem com o estado atual).
  const claimed = await db.query(
    `update wms.users set atlas_checked_at = $2 where id = $1 and (atlas_checked_at is null or atlas_checked_at = $3::timestamptz) returning id`,
    [userId, now.toISOString(), u.checked],
  );
  if (claimed.length === 0) return age(u.ok_at) <= env.graceSeconds ? "ok" : "denied";
  if (!env.apiUrl || !u.key_id || !u.secret_ciphertext) return age(u.ok_at) <= env.graceSeconds ? "ok" : "denied";
  try {
    const client: ClientOptions = { apiUrl: env.apiUrl, fetchImpl: opts.fetchImpl, timeoutMs: 5_000 };
    const r = await checkAtlasAccess({ keyId: u.key_id, secret: decryptSecret(u.secret_ciphertext) }, client, u.atlas_user_id);
    if (!r.active) {
      await db.transaction(async (tx) => {
        await tx.query(`update wms.users set active = false, atlas_access_version = greatest(coalesce(atlas_access_version, 0), $2), updated_at = now() where id = $1`, [
          userId,
          r.access_version ?? 0,
        ]);
        await auditSys(tx, u.company_id, u.system_user_id, "user.access_revoked_by_atlas", "user", userId, null, { reason: r.reason, via: "access_check" });
      });
      return "denied";
    }
    await db.transaction(async (tx) => {
      await tx.query(`update wms.users set atlas_access_ok_at = $2 where id = $1`, [userId, now.toISOString()]);
      if (r.access_version > (u.atlas_access_version ?? 0)) {
        await provisionAtlasUser(tx, u.company_id, u.system_user_id, {
          atlasUserId: u.atlas_user_id,
          email: r.email,
          name: r.name,
          role: r.orion_role,
          accessVersion: r.access_version,
          warehouses: r.warehouses ?? null,
        });
      }
    });
    return "ok";
  } catch {
    return age(u.ok_at) <= env.graceSeconds ? "ok" : "denied";
  }
}

// -----------------------------------------------------------------------------
// Entrada de eventos
// -----------------------------------------------------------------------------

function mapError(e: unknown): AtlasApplyError {
  if (e instanceof AtlasApplyError) return e;
  if (e instanceof DomainError) {
    if (e.code === "NOT_FOUND") return unknownRef(e.message);
    if (e.code === "INVALID_STATUS" || e.code === "IN_WAVE") return inProgress(e.message);
    return new AtlasApplyError("validation_failed", e.message, 400, false);
  }
  const code = (e as { code?: string } | null)?.code;
  if (code && /^(23|22|P0)/.test(code)) {
    return new AtlasApplyError("validation_failed", (e as Error).message ?? "Violação de integridade.", 400, false);
  }
  return new AtlasApplyError("internal_error", "Erro interno ao aplicar o evento.", 500, true);
}

const DOCUMENT_TYPES: Record<string, { type: string; idOf: (p: Record<string, unknown>) => string | undefined }> = {
  "sales_order.released": { type: "sales_order", idOf: (p) => (p.sales_order as { atlas_sales_order_id?: string })?.atlas_sales_order_id },
  "sales_order.updated": { type: "sales_order", idOf: (p) => (p.sales_order as { atlas_sales_order_id?: string })?.atlas_sales_order_id },
  "purchase_order.released": { type: "purchase_order", idOf: (p) => (p.purchase_order as { atlas_purchase_order_id?: string })?.atlas_purchase_order_id },
  "production_order.released": {
    type: "production_order",
    idOf: (p) => (p.production_order as { atlas_production_order_id?: string })?.atlas_production_order_id,
  },
};

export interface ReceiveOptions {
  /** Reprocessamento manual (painel): reaplica um evento que falhou. */
  reprocess?: boolean;
}

/** Aplica um envelope recebido do ATLAS. Nunca lança: devolve o HTTP e o corpo do contrato. */
export async function receiveAtlasEvent(db: Db, link: LinkRow, raw: unknown, opts: ReceiveOptions = {}): Promise<ApiResult> {
  const env = envelopeSchema.safeParse(raw);
  const rawId = typeof (raw as { id?: unknown })?.id === "string" ? ((raw as { id: string }).id as string) : null;
  if (!env.success) {
    const issue = env.error.issues[0];
    return rejected(rawId, "invalid_envelope", `Envelope inválido: ${issue.path.join(".") || "(raiz)"}: ${issue.message}`, 400, false);
  }
  const e = env.data;
  if (e.source !== "atlas") return rejected(e.id, "invalid_envelope", "source deve ser \"atlas\".", 400, false);
  if (e.atlas_company_id !== link.atlas_company_id || e.orion_company_id !== link.company_id) {
    return rejected(e.id, "company_mismatch", "Empresa do envelope diferente da empresa da credencial.", 403, false);
  }
  if (link.status === "disabled") return rejected(e.id, "company_not_linked", "Vínculo desativado.", 403, false);
  if (link.status === "suspended" && !ALLOWED_WHEN_SUSPENDED.has(e.type)) {
    return rejected(e.id, "integration_suspended", "Integração suspensa: empresa em modo somente leitura.", 403, false);
  }
  const schema = payloadSchemaFor(e.type);
  if (!schema) return rejected(e.id, "unsupported_type", `Tipo de evento não suportado: ${e.type}.`, 400, false);
  if (e.version !== 1) return rejected(e.id, "unsupported_type", `Versão ${e.version} de ${e.type} não suportada (aceita: 1).`, 400, false);
  const parsed = schema.safeParse(e.payload);
  if (!parsed.success) {
    const details = parsed.error.issues.slice(0, 20).map((i) => ({ path: `payload.${i.path.join(".")}`, issue: i.message }));
    return rejected(e.id, "validation_failed", `${details[0].path}: ${details[0].issue}`, 400, false, { details });
  }
  const hash = sha256Hex(JSON.stringify({ type: e.type, version: e.version, aggregate: e.aggregate, payload: e.payload }));
  try {
    return await db.transaction(async (tx) => {
      const [seen] = await tx.query<{ status: string; payload_hash: string; company_id: string }>(
        `select status, payload_hash, company_id from wms.atlas_inbox where event_id = $1 for update`,
        [e.id],
      );
      if (seen) {
        if (seen.payload_hash !== hash || seen.company_id !== link.company_id) {
          throw new AtlasApplyError("idempotency_conflict", "Mesmo id de evento com conteúdo diferente.", 400, false);
        }
        if (seen.status === "applied" || seen.status === "ignored") return accepted(e.id, true);
      }
      await tx.query(
        `insert into wms.atlas_aggregate_state (company_id, aggregate_type, aggregate_id) values ($1, $2, $3) on conflict do nothing`,
        [link.company_id, e.aggregate.type, e.aggregate.id],
      );
      const [state] = await tx.query<{ last_seq: number }>(
        `select last_seq from wms.atlas_aggregate_state where company_id = $1 and aggregate_type = $2 and aggregate_id = $3 for update`,
        [link.company_id, e.aggregate.type, e.aggregate.id],
      );
      const last = Number(state.last_seq);
      const isState = STATE_TYPES.has(e.type);
      if (e.aggregate.sequence <= last && !(opts.reprocess && seen?.status === "failed")) {
        await upsertInbox(tx, link.company_id, e, hash, "ignored", null, { reason: "sequência já aplicada", last_seq: last });
        return accepted(e.id, true);
      }
      if (!isState && e.aggregate.sequence > last + 1) {
        throw new AtlasApplyError("out_of_order", `Fora de ordem: esperado sequence ${last + 1} para ${e.aggregate.type} ${e.aggregate.id}.`, 409, true, {
          expected_sequence: last + 1,
        });
      }
      const sctx = await systemCtx(tx, link.company_id, db.driver);
      const result = await applyEvent(tx, sctx, link, e, parsed.data);
      await upsertInbox(tx, link.company_id, e, hash, "applied", null, result ?? {});
      await tx.query(
        `update wms.atlas_aggregate_state set last_seq = greatest(last_seq, $4), last_event_id = $5, updated_at = now()
         where company_id = $1 and aggregate_type = $2 and aggregate_id = $3`,
        [link.company_id, e.aggregate.type, e.aggregate.id, e.aggregate.sequence, e.id],
      );
      await tx.query(`update wms.atlas_links set last_inbound_at = now() where company_id = $1`, [link.company_id]);
      await auditSys(tx, link.company_id, sctx.user.id, "atlas.event_applied", "atlas_event", e.id, e.type, {
        aggregate: e.aggregate,
        result: result ?? null,
      });
      return accepted(e.id, false);
    });
  } catch (error) {
    const err = mapError(error);
    if (err.code !== "out_of_order" && err.code !== "idempotency_conflict") {
      await recordFailure(db, link, e, hash, err).catch(() => undefined);
    }
    return rejected(e.id, err.code, err.message, err.http, err.retryable, err.extra);
  }
}

function accepted(eventId: string, duplicate: boolean): ApiResult {
  return { status: duplicate ? 200 : 202, body: { status: "accepted", event_id: eventId, duplicate } };
}

async function upsertInbox(tx: Queryable, companyId: string, e: Envelope, hash: string, status: string, err: AtlasApplyError | null, result: Record<string, unknown>) {
  await tx.query(
    `insert into wms.atlas_inbox (event_id, company_id, event_type, version, aggregate_type, aggregate_id, aggregate_seq, payload_hash, envelope,
                                  status, error_code, last_error, result, applied_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, case when $10 = 'applied' then now() end)
     on conflict (event_id) do update set status = excluded.status, attempts = wms.atlas_inbox.attempts + 1,
       error_code = excluded.error_code, last_error = excluded.last_error, result = excluded.result,
       applied_at = coalesce(excluded.applied_at, wms.atlas_inbox.applied_at)`,
    [e.id, companyId, e.type, e.version, e.aggregate.type, e.aggregate.id, e.aggregate.sequence, hash, JSON.stringify(e), status,
      err?.code ?? null, err?.message.slice(0, 1000) ?? null, JSON.stringify(result)],
  );
}

/** Falha registrada fora da transação do efeito (que foi desfeita): aparece no painel e pode ser reprocessada. */
async function recordFailure(db: Db, link: LinkRow, e: Envelope, hash: string, err: AtlasApplyError) {
  await db.transaction(async (tx) => {
    const [seen] = await tx.query<{ status: string }>(`select status from wms.atlas_inbox where event_id = $1 for update`, [e.id]);
    if (seen && seen.status !== "failed" && seen.status !== "received") return;
    await upsertInbox(tx, link.company_id, e, hash, "failed", err, {});
    await auditSys(tx, link.company_id, link.system_user_id, "atlas.event_rejected", "atlas_event", e.id, e.type, { code: err.code, message: err.message });
    // Documento recusado de forma definitiva: devolve document.rejected ao ATLAS pela outbox.
    const doc = DOCUMENT_TYPES[e.type];
    const docId = doc?.idOf(e.payload);
    if (doc && docId && !err.retryable) {
      const [already] = await tx.query(
        `select 1 from wms.integration_events where company_id = $1 and event_type = 'document.rejected' and payload->>'atlas_event_id' = $2`,
        [link.company_id, e.id],
      );
      if (!already) {
        const sctx = await systemCtx(tx, link.company_id, db.driver);
        await enqueueIntegrationEvent(tx, sctx, "document.rejected", "atlas_document", docId, {
          atlas_event_id: e.id,
          atlas_document_type: doc.type,
          atlas_document_id: docId,
          error: { code: err.code, message: err.message },
        });
      }
    }
  });
}

/** POST /events:batch — até 500 envelopes da mesma empresa, aplicados em ordem; resposta por item. */
export async function receiveAtlasBatch(db: Db, link: LinkRow, raw: unknown): Promise<ApiResult> {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { events?: unknown })?.events) ? (raw as { events: unknown[] }).events : null;
  if (!list) return rejected(null, "invalid_envelope", "Corpo deve ser uma lista de envelopes ou { events: [...] }.", 400, false);
  if (list.length === 0 || list.length > 500) return rejected(null, "invalid_envelope", "O lote deve ter de 1 a 500 envelopes.", 400, false);
  const results: { http_status: number; body: Record<string, unknown> }[] = [];
  for (const item of list) {
    const r = await receiveAtlasEvent(db, link, item);
    results.push({ http_status: r.status, body: r.body });
  }
  return { status: 200, body: { status: "processed", results } };
}

// -----------------------------------------------------------------------------
// Aplicação por tipo (ATLAS → ORION, tabela 3.4)
// -----------------------------------------------------------------------------

async function applyEvent(tx: Queryable, ctx: Ctx, link: LinkRow, e: Envelope, payload: unknown): Promise<Record<string, unknown> | void> {
  const companyId = link.company_id;
  switch (e.type) {
    case "company.upserted": {
      const c = (payload as A2OPayload<"company.upserted">).company;
      if (c.atlas_company_id !== link.atlas_company_id) throw new AtlasApplyError("company_mismatch", "Empresa do payload diferente do vínculo.", 403, false);
      const cols = companyColumns(c);
      await tx.query(
        `update erp.companies set name = $2, legal_name = $3, document = $4, email = $5, phone = $6, address = $7, city = $8, state = $9,
                zip_code = $10, synced_at = now(), updated_at = now() where id = $1`,
        [companyId, ...cols],
      );
      return;
    }
    case "company.deactivated": {
      const p = payload as A2OPayload<"company.deactivated">;
      const status = p.mode === "disabled" ? "disabled" : "suspended";
      await tx.query(`update wms.atlas_links set status = $2, status_reason = $3, updated_at = now() where company_id = $1`, [companyId, status, p.reason]);
      return { status };
    }
    case "integration.activated":
      return applyIntegrationActivated(tx, ctx, link, payload as A2OPayload<"integration.activated">);
    case "user_access.granted": {
      const p = payload as A2OPayload<"user_access.granted">;
      const r = await provisionAtlasUser(tx, companyId, ctx.user.id, {
        atlasUserId: p.atlas_user_id,
        email: p.email,
        name: p.name,
        role: p.orion_role,
        accessVersion: p.access_version,
        warehouses: p.warehouses ?? null,
      });
      return { user_id: r.userId, created: r.created, stale: r.stale };
    }
    case "user_access.revoked": {
      const p = payload as A2OPayload<"user_access.revoked">;
      const rows = await tx.query<{ id: string }>(
        `update wms.users set active = false, atlas_access_version = $3, updated_at = now()
         where company_id = $1 and atlas_user_id = $2 and coalesce(atlas_access_version, 0) <= $3 returning id`,
        [companyId, p.atlas_user_id, p.access_version],
      );
      for (const r of rows) await auditSys(tx, companyId, ctx.user.id, "user.access_revoked_by_atlas", "user", r.id, null, { reason: p.reason });
      return { revoked: rows.length };
    }
    case "unit.upserted": {
      const p = payload as A2OPayload<"unit.upserted">;
      await tx.query(
        `insert into wms.atlas_units (company_id, atlas_unit_id, code, name, base_unit_code, factor_to_base, status)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (company_id, atlas_unit_id) do update set code = excluded.code, name = excluded.name, base_unit_code = excluded.base_unit_code,
           factor_to_base = excluded.factor_to_base, status = excluded.status, updated_at = now()`,
        [companyId, p.atlas_unit_id, p.code.toUpperCase(), p.name, p.base_unit_code ?? null, p.factor_to_base ?? null, p.status],
      );
      return;
    }
    case "product.upserted":
      return applyProduct(tx, companyId, (payload as A2OPayload<"product.upserted">).product);
    case "product.deactivated": {
      const p = payload as A2OPayload<"product.deactivated">;
      const rows = await tx.query(`update erp.products set status = 'inactive', synced_at = now(), updated_at = now() where company_id = $1 and external_id = $2 returning id`, [
        companyId,
        p.atlas_product_id,
      ]);
      return { found: rows.length > 0 };
    }
    case "customer.upserted": {
      const c = (payload as A2OPayload<"customer.upserted">).customer;
      return upsertParty(tx, "customers", companyId, c.atlas_customer_id, c.code, c.name, c.document ?? null, c.status);
    }
    case "supplier.upserted": {
      const s = (payload as A2OPayload<"supplier.upserted">).supplier;
      return upsertParty(tx, "suppliers", companyId, s.atlas_supplier_id, s.code, s.name, s.document ?? null, s.status);
    }
    case "sales_order.released":
      return applySalesReleased(tx, ctx, link, e, (payload as A2OPayload<"sales_order.released">).sales_order);
    case "sales_order.updated":
      return applySalesUpdated(tx, ctx, (payload as A2OPayload<"sales_order.updated">).sales_order);
    case "sales_order.line_cancelled":
      return applySalesLineCancelled(tx, ctx, payload as A2OPayload<"sales_order.line_cancelled">);
    case "sales_order.cancelled":
      return applySalesCancelled(tx, ctx, payload as A2OPayload<"sales_order.cancelled">);
    case "sales_invoice.authorized": {
      const p = payload as A2OPayload<"sales_invoice.authorized">;
      const rows = await tx.query<{ id: string; code: string }>(
        `update wms.outbound_orders o set invoice_number = $3, invoice_series = $4, invoice_access_key = $5, invoice_authorized_at = $6,
                updated_at = now(), version = o.version + 1
         from erp.sales_orders so where so.id = o.sales_order_id and so.company_id = $1 and so.external_id = $2 and o.status <> 'cancelled'
         returning o.id, o.code`,
        [companyId, p.atlas_sales_order_id, p.nfe_number, p.nfe_series, p.access_key, p.authorized_at],
      );
      if (!rows.length) throw unknownRef(`Pedido de saída do pedido ${p.number} não encontrado no ORION.`);
      await auditSys(tx, companyId, ctx.user.id, "outbound.invoice_authorized", "outbound_order", rows[0].id, rows[0].code, { nfe: p.nfe_number, access_key: p.access_key });
      return { outbound: rows[0].code };
    }
    case "purchase_order.released":
      return applyPurchaseReleased(tx, ctx, (payload as A2OPayload<"purchase_order.released">).purchase_order);
    case "purchase_order.cancelled":
      return applyPurchaseCancelled(tx, ctx, payload as A2OPayload<"purchase_order.cancelled">);
    case "production_order.released":
      return applyProductionReleased(tx, ctx, (payload as A2OPayload<"production_order.released">).production_order);
    case "production_order.cancelled":
      return applyProductionCancelled(tx, ctx, payload as A2OPayload<"production_order.cancelled">);
    case "stock.initial_snapshot":
      return applyInitialSnapshot(tx, ctx, link, payload as A2OPayload<"stock.initial_snapshot">);
    default:
      throw new AtlasApplyError("unsupported_type", `Tipo não suportado: ${e.type}.`, 400, false);
  }
}

async function applyIntegrationActivated(tx: Queryable, ctx: Ctx, link: LinkRow, p: A2OPayload<"integration.activated">) {
  const companyId = link.company_id;
  const mapped: string[] = [];
  for (const w of p.warehouses) {
    const code = w.orion_warehouse_code.trim().toUpperCase();
    let [wh] = await tx.query<{ id: string }>(`select id from wms.warehouses where company_id = $1 and upper(code) = $2`, [companyId, code]);
    if (!wh) {
      const created = await createWarehouse(ctx, { code, name: w.name.length >= 3 ? w.name : `${w.name} (ATLAS)` });
      wh = { id: created.id };
    }
    await tx.query(
      `insert into wms.atlas_warehouse_map (company_id, atlas_warehouse_id, warehouse_id, atlas_code, atlas_name) values ($1,$2,$3,$4,$5)
       on conflict (company_id, atlas_warehouse_id) do update set warehouse_id = excluded.warehouse_id, atlas_code = excluded.atlas_code,
         atlas_name = excluded.atlas_name, updated_at = now()`,
      [companyId, w.atlas_warehouse_id, wh.id, w.code, w.name],
    );
    mapped.push(code);
  }
  const [cur] = await tx.query<{ status: string; activated_at: string | null }>(
    `select status, activated_at::text as activated_at from wms.atlas_links where company_id = $1`,
    [companyId],
  );
  // Estoque do ATLAS (sem carga inicial) ou reativação após suspensão: ativo de imediato.
  const status =
    p.stock_owner === "atlas" || cur.status === "active" || (cur.status === "suspended" && cur.activated_at) ? "active" : "activating";
  await tx.query(
    `update wms.atlas_links set stock_owner = $2, sales_release_status = $3, purchase_release_status = $4, production_release_status = $5,
            require_invoice_before_ship = $6, status = $7, status_reason = null,
            activated_at = case when $7 = 'active' then coalesce(activated_at, now()) else activated_at end, updated_at = now()
     where company_id = $1`,
    [companyId, p.stock_owner, p.sales_release_status, p.purchase_release_status, p.production_release_status, p.require_invoice_before_ship, status],
  );
  return { warehouses: mapped, status };
}

async function applyProduct(tx: Queryable, companyId: string, p: A2OPayload<"product.upserted">["product"]) {
  const sku = p.code.trim();
  let [row] = await tx.query<{ id: string }>(`select id from erp.products where company_id = $1 and external_id = $2 for update`, [companyId, p.atlas_product_id]);
  if (!row) {
    [row] = await tx.query<{ id: string }>(
      `select id from erp.products where company_id = $1 and sku = $2 and external_id is null for update`,
      [companyId, sku],
    );
  }
  const values = [sku, p.name, p.barcode ?? null, p.unit.toUpperCase(), p.category ?? null, p.status, p.weight_kg ?? null, p.length_cm ?? null, p.width_cm ?? null, p.height_cm ?? null];
  if (row) {
    await tx.query(
      `update erp.products set sku = $3, description = $4, barcode = $5, uom = $6, category = $7, status = $8, weight_kg = $9,
              length_cm = $10, width_cm = $11, height_cm = $12, source = 'atlas', external_id = $2, synced_at = now(), updated_at = now()
       where id = $1`,
      [row.id, p.atlas_product_id, ...values],
    );
  } else {
    [row] = await tx.query<{ id: string }>(
      `insert into erp.products (company_id, external_id, sku, description, barcode, uom, category, status, weight_kg, length_cm, width_cm, height_cm,
                                 source, synced_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'atlas',now()) returning id`,
      [companyId, p.atlas_product_id, ...values],
    );
  }
  await tx.query(
    `insert into wms.product_settings (product_id, company_id, lot_controlled, expiry_controlled, serial_controlled)
     values ($1,$2,$3,$4,$5)
     on conflict (product_id) do update set lot_controlled = excluded.lot_controlled, expiry_controlled = excluded.expiry_controlled,
       serial_controlled = excluded.serial_controlled, updated_at = now()`,
    [row.id, companyId, p.batch_controlled, p.expiration_controlled, p.serial_controlled ?? false],
  );
  for (const pk of p.packagings ?? []) {
    await tx.query(
      `insert into wms.packaging_units (company_id, product_id, code, description, units_per_package, barcode)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (product_id, code) do update set units_per_package = excluded.units_per_package, barcode = excluded.barcode, active = true`,
      [companyId, row.id, pk.unit.toUpperCase(), `${pk.unit.toUpperCase()} c/ ${pk.quantity}`, pk.quantity, pk.barcode ?? null],
    );
  }
  return { product_id: row.id };
}

async function upsertParty(tx: Queryable, table: "customers" | "suppliers", companyId: string, externalId: string, code: string, name: string, document: string | null, status: string) {
  let [row] = await tx.query<{ id: string }>(`select id from erp.${table} where company_id = $1 and external_id = $2 for update`, [companyId, externalId]);
  if (!row) [row] = await tx.query<{ id: string }>(`select id from erp.${table} where company_id = $1 and code = $2 and external_id is null for update`, [companyId, code]);
  if (row) {
    await tx.query(
      `update erp.${table} set code = $2, name = $3, document = $4, status = $5, source = 'atlas', external_id = $6, synced_at = now() where id = $1`,
      [row.id, code, name, document, status, externalId],
    );
  } else {
    [row] = await tx.query<{ id: string }>(
      `insert into erp.${table} (company_id, code, name, document, status, source, external_id, synced_at) values ($1,$2,$3,$4,$5,'atlas',$6,now()) returning id`,
      [companyId, code, name, document, status, externalId],
    );
  }
  return { id: row.id };
}

async function productsByExternal(tx: Queryable, companyId: string, refs: { id: string; code: string }[]) {
  const ids = [...new Set(refs.map((r) => r.id))];
  const rows = await tx.query<{ id: string; external_id: string; status: string; sku: string }>(
    `select id, external_id, status, sku from erp.products where company_id = $1 and external_id = any($2::text[])`,
    [companyId, ids],
  );
  const map = new Map(rows.map((r) => [r.external_id, r]));
  const missing = refs.find((r) => !map.has(r.id));
  if (missing) throw dependency(`Produto ${missing.code} (${missing.id}) ainda não recebido; reenviar após product.upserted.`);
  const inactive = rows.find((r) => r.status !== "active");
  if (inactive) throw unknownRef(`Produto ${inactive.sku} está inativo no ORION.`);
  return map;
}

async function warehouseFor(tx: Queryable, companyId: string, atlasWarehouseId: string): Promise<string> {
  const [w] = await tx.query<{ warehouse_id: string }>(
    `select warehouse_id from wms.atlas_warehouse_map where company_id = $1 and atlas_warehouse_id = $2`,
    [companyId, atlasWarehouseId],
  );
  if (!w) throw dependency(`Depósito ${atlasWarehouseId} sem mapeamento no ORION; reenviar após integration.activated.`);
  return w.warehouse_id;
}

const PRIORITY: Record<string, number> = { urgent: 1, high: 1, normal: 2, low: 3 };

type SalesLines = A2OPayload<"sales_order.released">["sales_order"]["lines"];

async function syncSalesItems(tx: Queryable, soId: string, lines: SalesLines, products: Map<string, { id: string }>) {
  for (const l of lines) {
    const productId = products.get(l.atlas_product_id)!.id;
    const [item] = await tx.query<{ id: string }>(`select id from erp.sales_order_items where sales_order_id = $1 and external_id = $2`, [soId, l.atlas_line_id]);
    if (item) {
      await tx.query(`update erp.sales_order_items set line_no = $2, product_id = $3, quantity = $4 where id = $1`, [item.id, l.line_no, productId, l.quantity]);
    } else {
      await tx.query(`insert into erp.sales_order_items (sales_order_id, line_no, product_id, quantity, external_id) values ($1,$2,$3,$4,$5)`, [
        soId,
        l.line_no,
        productId,
        l.quantity,
        l.atlas_line_id,
      ]);
    }
  }
}

interface ActiveOutbound {
  id: string;
  code: string;
  status: string;
}

async function activeOutbound(tx: Queryable, salesOrderId: string): Promise<ActiveOutbound | null> {
  const [o] = await tx.query<ActiveOutbound>(
    `select id, code, status from wms.outbound_orders where sales_order_id = $1 and status <> 'cancelled' order by created_at desc limit 1 for update`,
    [salesOrderId],
  );
  return o ?? null;
}

/** Libera as reservas de um pedido ainda não liberado para separação (status reserved → open). */
async function releaseOutboundReservations(tx: Queryable, ctx: Ctx, orderId: string) {
  const res = await tx.query<{ id: string; balance_id: string; quantity: number }>(
    `select r.id, r.balance_id, r.quantity::float8 as quantity from wms.stock_reservations r join wms.outbound_order_lines l on l.id = r.order_line_id
     where l.order_id = $1 and r.status = 'active' for update of r`,
    [orderId],
  );
  for (const r of res) {
    await lockBalanceById(tx, ctx.user.companyId, r.balance_id);
    await changeReserved(tx, r.balance_id, -r.quantity);
    await tx.query(`update wms.stock_reservations set status = 'released', closed_at = now() where id = $1`, [r.id]);
  }
  await tx.query(`update wms.outbound_order_lines set reserved_qty = 0 where order_id = $1`, [orderId]);
  await tx.query(`update wms.outbound_orders set status = 'open', reserved_at = null, updated_at = now(), version = version + 1 where id = $1`, [orderId]);
}

async function applyOutboundLines(tx: Queryable, ctx: Ctx, soId: string, o: ActiveOutbound, lines: SalesLines, shipDate: string | null | undefined) {
  if (!["open", "reserved"].includes(o.status)) {
    throw inProgress(`O armazém já começou a separar o pedido (${o.code}); cancele a linha ou o pedido.`);
  }
  const [wave] = await tx.query(`select 1 from wms.wave_orders where order_id = $1 and active`, [o.id]);
  if (wave) throw inProgress(`O pedido ${o.code} está em uma onda de separação; cancele a linha ou o pedido.`);
  if (o.status === "reserved") await releaseOutboundReservations(tx, ctx, o.id);
  const keep = new Set<string>();
  for (const l of lines) {
    const [item] = await tx.query<{ id: string; product_id: string; quantity: number }>(
      `select id, product_id, quantity::float8 as quantity from erp.sales_order_items where sales_order_id = $1 and external_id = $2`,
      [soId, l.atlas_line_id],
    );
    const [line] = await tx.query<{ id: string }>(
      `select id from wms.outbound_order_lines where order_id = $1 and sales_order_item_id = $2 and cancelled_at is null`,
      [o.id, item.id],
    );
    if (line) {
      await tx.query(`update wms.outbound_order_lines set requested_qty = $2, product_id = $3 where id = $1`, [line.id, item.quantity, item.product_id]);
      keep.add(line.id);
    } else {
      const [ins] = await tx.query<{ id: string }>(
        `insert into wms.outbound_order_lines (order_id, line_no, product_id, requested_qty, sales_order_item_id)
         values ($1, (select coalesce(max(line_no), 0) + 1 from wms.outbound_order_lines where order_id = $1), $2, $3, $4) returning id`,
        [o.id, item.product_id, item.quantity, item.id],
      );
      keep.add(ins.id);
    }
  }
  await tx.query(
    `update wms.outbound_order_lines set cancelled_at = now(), cancel_reason = 'Linha removida no ATLAS'
     where order_id = $1 and cancelled_at is null and not (id = any($2::uuid[]))`,
    [o.id, [...keep]],
  );
  await tx.query(`update wms.outbound_orders set planned_ship_date = coalesce($2::date, planned_ship_date), updated_at = now(), version = version + 1 where id = $1`, [
    o.id,
    shipDate ?? null,
  ]);
}

async function applySalesReleased(tx: Queryable, ctx: Ctx, link: LinkRow, e: Envelope, so: A2OPayload<"sales_order.released">["sales_order"]) {
  const companyId = link.company_id;
  const [customer] = await tx.query<{ id: string; name: string }>(`select id, name from erp.customers where company_id = $1 and external_id = $2`, [
    companyId,
    so.atlas_customer_id,
  ]);
  if (!customer) throw dependency(`Cliente ${so.atlas_customer_id} ainda não recebido; reenviar após customer.upserted.`);
  const products = await productsByExternal(tx, companyId, so.lines.map((l) => ({ id: l.atlas_product_id, code: l.product_code })));
  const warehouseId = await warehouseFor(tx, companyId, so.atlas_warehouse_id);
  let [existing] = await tx.query<{ id: string }>(`select id from erp.sales_orders where company_id = $1 and external_id = $2 for update`, [companyId, so.atlas_sales_order_id]);
  let outbound: ActiveOutbound | null = existing ? await activeOutbound(tx, existing.id) : null;
  if (outbound && outbound.status === "shipped") throw alreadyShipped(`O pedido ${so.number} já foi expedido (${outbound.code}).`);
  if (existing) {
    await tx.query(
      `update erp.sales_orders set number = $2, customer_id = $3, issue_date = $4, requested_ship_date = $5, notes = $6,
              status = case when status = 'cancelled' then 'open' else status end where id = $1`,
      [existing.id, so.number, customer.id, so.issue_date, so.requested_ship_date ?? null, so.notes ?? null],
    );
  } else {
    [existing] = await tx.query<{ id: string }>(
      `insert into erp.sales_orders (company_id, number, customer_id, status, issue_date, external_id, requested_ship_date, notes)
       values ($1,$2,$3,'open',$4,$5,$6,$7) returning id`,
      [companyId, so.number, customer.id, so.issue_date, so.atlas_sales_order_id, so.requested_ship_date ?? null, so.notes ?? null],
    );
  }
  await syncSalesItems(tx, existing.id, so.lines, products);
  if (outbound) {
    // Reenvio de documento já recebido: upsert enquanto não começou a separação.
    await applyOutboundLines(tx, ctx, existing.id, outbound, so.lines, so.requested_ship_date);
  } else {
    await tx.query(`update erp.sales_orders set status = 'open' where id = $1`, [existing.id]);
    const created = await importSalesOrder(ctx, { salesOrderId: existing.id, warehouseId, priority: PRIORITY[so.priority] ?? 2 });
    // Linha do pedido de saída ↔ item do pedido (mesma ordem de line_no).
    await tx.query(
      `update wms.outbound_order_lines l set sales_order_item_id = i.id
       from (select id, row_number() over (order by line_no) as rn from erp.sales_order_items where sales_order_id = $1) i
       where l.order_id = $2 and l.line_no = i.rn`,
      [existing.id, created.id],
    );
    outbound = { id: created.id, code: created.code, status: "open" };
  }
  await tx.query(
    `update wms.outbound_orders set requires_invoice = $2, planned_ship_date = coalesce($3::date, planned_ship_date),
            carrier = coalesce($4, carrier), notes = coalesce($5, notes), updated_at = now()
     where id = $1`,
    [outbound.id, link.require_invoice_before_ship, so.requested_ship_date ?? null, so.shipping?.carrier_code ?? null, so.notes ? `${so.number}: ${so.notes}` : null],
  );
  await enqueueIntegrationEvent(tx, ctx, "outbound.accepted", "outbound_order", outbound.id, {
    code: outbound.code,
    atlas_sales_order_id: so.atlas_sales_order_id,
    atlas_event_id: e.id,
  });
  return { outbound: outbound.code };
}

async function findSales(tx: Queryable, companyId: string, atlasId: string, number: string) {
  const [so] = await tx.query<{ id: string }>(`select id from erp.sales_orders where company_id = $1 and external_id = $2 for update`, [companyId, atlasId]);
  if (!so) throw unknownRef(`Pedido de venda ${number} não encontrado no ORION.`);
  return so;
}

async function applySalesUpdated(tx: Queryable, ctx: Ctx, so: A2OPayload<"sales_order.updated">["sales_order"]) {
  const companyId = ctx.user.companyId;
  const found = await findSales(tx, companyId, so.atlas_sales_order_id, so.number);
  const products = await productsByExternal(tx, companyId, so.lines.map((l) => ({ id: l.atlas_product_id, code: l.product_code })));
  const outbound = await activeOutbound(tx, found.id);
  if (outbound?.status === "shipped") throw alreadyShipped(`O pedido ${so.number} já foi expedido (${outbound.code}).`);
  if (outbound && !["open", "reserved"].includes(outbound.status)) {
    throw inProgress(`O armazém já começou a separar o pedido (${outbound.code}); cancele a linha ou o pedido.`);
  }
  await tx.query(`update erp.sales_orders set requested_ship_date = $2 where id = $1`, [found.id, so.requested_ship_date ?? null]);
  await syncSalesItems(tx, found.id, so.lines, products);
  if (outbound) await applyOutboundLines(tx, ctx, found.id, outbound, so.lines, so.requested_ship_date);
  return { outbound: outbound?.code ?? null };
}

const reasonOf = (reason: string) => (reason.trim().length >= 5 ? `ATLAS: ${reason.trim()}` : `Cancelado no ATLAS: ${reason.trim()}`);

async function applySalesLineCancelled(tx: Queryable, ctx: Ctx, p: A2OPayload<"sales_order.line_cancelled">) {
  const so = await findSales(tx, ctx.user.companyId, p.atlas_sales_order_id, p.number);
  const [item] = await tx.query<{ id: string; quantity: number }>(
    `select id, quantity::float8 as quantity from erp.sales_order_items where sales_order_id = $1 and external_id = $2`,
    [so.id, p.atlas_line_id],
  );
  if (!item) throw unknownRef(`Linha ${p.atlas_line_id} do pedido ${p.number} não encontrada.`);
  const outbound = await activeOutbound(tx, so.id);
  if (outbound?.status === "shipped") throw alreadyShipped(`O pedido ${p.number} já foi expedido (${outbound.code}).`);
  const [line] = outbound
    ? await tx.query<{ id: string; requested_qty: number }>(
        `select id, requested_qty::float8 as requested_qty from wms.outbound_order_lines where order_id = $1 and sales_order_item_id = $2 and cancelled_at is null`,
        [outbound.id, item.id],
      )
    : [];
  const remaining = round3(item.quantity - p.cancelled_quantity);
  if (remaining > 0) await tx.query(`update erp.sales_order_items set quantity = $2 where id = $1`, [item.id, remaining]);
  if (!outbound || !line) return { outbound: outbound?.code ?? null, line: null };
  if (p.cancelled_quantity >= line.requested_qty) {
    await cancelOrderLine(ctx, outbound.id, { lineId: line.id, reason: reasonOf(p.reason) });
    return { outbound: outbound.code, cancelled: "line" };
  }
  if (!["open", "reserved"].includes(outbound.status)) {
    throw inProgress(`Cancelamento parcial não é possível após o início da separação de ${outbound.code}; cancele a linha inteira.`);
  }
  if (outbound.status === "reserved") await releaseOutboundReservations(tx, ctx, outbound.id);
  await tx.query(`update wms.outbound_order_lines set requested_qty = $2 where id = $1`, [line.id, round3(line.requested_qty - p.cancelled_quantity)]);
  await auditSys(tx, ctx.user.companyId, ctx.user.id, "outbound.line_reduced", "outbound_order", outbound.id, outbound.code, {
    line: line.id,
    cancelled: p.cancelled_quantity,
    reason: p.reason,
  });
  return { outbound: outbound.code, cancelled: "partial" };
}

async function applySalesCancelled(tx: Queryable, ctx: Ctx, p: A2OPayload<"sales_order.cancelled">) {
  const [so] = await tx.query<{ id: string }>(`select id from erp.sales_orders where company_id = $1 and external_id = $2 for update`, [
    ctx.user.companyId,
    p.atlas_sales_order_id,
  ]);
  if (!so) return { outbound: null };
  const outbound = await activeOutbound(tx, so.id);
  if (outbound?.status === "shipped") throw alreadyShipped(`O pedido ${p.number} já foi expedido (${outbound.code}).`);
  if (outbound) await cancelOrder(ctx, outbound.id, { reason: reasonOf(p.reason) });
  await tx.query(`update erp.sales_orders set status = 'cancelled' where id = $1`, [so.id]);
  return { outbound: outbound?.code ?? null };
}

async function applyPurchaseReleased(tx: Queryable, ctx: Ctx, po: A2OPayload<"purchase_order.released">["purchase_order"]) {
  const companyId = ctx.user.companyId;
  const [supplier] = await tx.query<{ id: string }>(`select id from erp.suppliers where company_id = $1 and external_id = $2`, [companyId, po.atlas_supplier_id]);
  if (!supplier) throw dependency(`Fornecedor ${po.supplier_code} ainda não recebido; reenviar após supplier.upserted.`);
  const products = await productsByExternal(tx, companyId, po.lines.map((l) => ({ id: l.atlas_product_id, code: l.product_code })));
  await warehouseFor(tx, companyId, po.atlas_warehouse_id);
  let [row] = await tx.query<{ id: string; status: string }>(`select id, status from erp.purchase_orders where company_id = $1 and external_id = $2 for update`, [
    companyId,
    po.atlas_purchase_order_id,
  ]);
  if (row) {
    const [receipt] = await tx.query<{ code: string }>(`select code from wms.receipts where purchase_order_id = $1 and status <> 'cancelled' limit 1`, [row.id]);
    if (receipt || ["partially_received", "received"].includes(row.status)) {
      throw inProgress(`O recebimento do pedido ${po.number} já começou no armazém${receipt ? ` (${receipt.code})` : ""}.`);
    }
    await tx.query(
      `update erp.purchase_orders set number = $2, supplier_id = $3, status = 'open', issue_date = $4, expected_date = $5 where id = $1`,
      [row.id, po.number, supplier.id, po.issue_date, po.expected_date ?? null],
    );
  } else {
    [row] = await tx.query<{ id: string; status: string }>(
      `insert into erp.purchase_orders (company_id, number, supplier_id, status, issue_date, expected_date, external_id)
       values ($1,$2,$3,'open',$4,$5,$6) returning id, status`,
      [companyId, po.number, supplier.id, po.issue_date, po.expected_date ?? null, po.atlas_purchase_order_id],
    );
  }
  for (const l of po.lines) {
    const productId = products.get(l.atlas_product_id)!.id;
    const [item] = await tx.query<{ id: string }>(`select id from erp.purchase_order_items where purchase_order_id = $1 and external_id = $2`, [row.id, l.atlas_line_id]);
    if (item) {
      await tx.query(`update erp.purchase_order_items set line_no = $2, product_id = $3, quantity = $4, unit_price = $5 where id = $1`, [
        item.id,
        l.line_no,
        productId,
        l.quantity,
        l.unit_price ?? null,
      ]);
    } else {
      await tx.query(
        `insert into erp.purchase_order_items (purchase_order_id, line_no, product_id, quantity, unit_price, external_id) values ($1,$2,$3,$4,$5,$6)`,
        [row.id, l.line_no, productId, l.quantity, l.unit_price ?? null, l.atlas_line_id],
      );
    }
  }
  // Linhas removidas no ATLAS (sem recebimento que as referencie).
  await tx.query(
    `delete from erp.purchase_order_items i where i.purchase_order_id = $1 and (i.external_id is null or not (i.external_id = any($2::text[])))
       and not exists (select 1 from wms.receipt_items ri where ri.purchase_order_item_id = i.id)`,
    [row.id, po.lines.map((l) => l.atlas_line_id)],
  );
  await auditSys(tx, companyId, ctx.user.id, "atlas.purchase_order_released", "purchase_order", row.id, po.number, { lines: po.lines.length });
  return { purchase_order_id: row.id };
}

async function applyPurchaseCancelled(tx: Queryable, ctx: Ctx, p: A2OPayload<"purchase_order.cancelled">) {
  const [po] = await tx.query<{ id: string; status: string }>(`select id, status from erp.purchase_orders where company_id = $1 and external_id = $2 for update`, [
    ctx.user.companyId,
    p.atlas_purchase_order_id,
  ]);
  if (!po) return { found: false };
  if (["partially_received", "received"].includes(po.status)) throw inProgress(`O pedido ${p.number} já foi recebido (total ou parcialmente).`);
  const [receipt] = await tx.query<{ id: string; code: string; status: string }>(
    `select id, code, status from wms.receipts where purchase_order_id = $1 and status <> 'cancelled' limit 1`,
    [po.id],
  );
  if (receipt) {
    if (!["expected", "checking"].includes(receipt.status)) throw inProgress(`O recebimento ${receipt.code} já foi conferido no armazém.`);
    await cancelReceipt(ctx, receipt.id, { reason: reasonOf(p.reason) });
  }
  await tx.query(`update erp.purchase_orders set status = 'cancelled' where id = $1`, [po.id]);
  return { receipt: receipt?.code ?? null };
}

async function applyProductionReleased(tx: Queryable, ctx: Ctx, op: A2OPayload<"production_order.released">["production_order"]) {
  const companyId = ctx.user.companyId;
  const products = await productsByExternal(tx, companyId, [
    { id: op.atlas_product_id, code: op.product_code },
    ...op.components.map((c) => ({ id: c.atlas_product_id, code: c.product_code })),
  ]);
  const warehouseId = await warehouseFor(tx, companyId, op.atlas_warehouse_id);
  let [row] = await tx.query<{ id: string; status: string }>(`select id, status from erp.production_orders where company_id = $1 and external_id = $2 for update`, [
    companyId,
    op.atlas_production_order_id,
  ]);
  if (row) {
    const [req] = await tx.query<{ id: string; code: string; status: string }>(
      `select id, code, status from wms.production_requisitions where production_order_id = $1 and status <> 'cancelled' limit 1`,
      [row.id],
    );
    if (req && req.status !== "open") throw inProgress(`A requisição ${req.code} da ordem ${op.number} já está em andamento no armazém.`);
    if (req) await cancelRequisition(ctx, req.id, { reason: `Ordem ${op.number} reenviada pelo ATLAS` });
    await tx.query(
      `update erp.production_orders set number = $2, product_id = $3, quantity = $4, status = 'open', due_date = $5, output_lot_code = $6 where id = $1`,
      [row.id, op.number, products.get(op.atlas_product_id)!.id, op.quantity, op.planned_date ?? null, op.output_lot_code ?? null],
    );
  } else {
    [row] = await tx.query<{ id: string; status: string }>(
      `insert into erp.production_orders (company_id, number, product_id, quantity, status, due_date, output_lot_code, external_id)
       values ($1,$2,$3,$4,'open',$5,$6,$7) returning id, status`,
      [companyId, op.number, products.get(op.atlas_product_id)!.id, op.quantity, op.planned_date ?? null, op.output_lot_code ?? null, op.atlas_production_order_id],
    );
  }
  for (const c of op.components) {
    const productId = products.get(c.atlas_product_id)!.id;
    const [item] = await tx.query<{ id: string }>(`select id from erp.production_order_components where production_order_id = $1 and external_id = $2`, [
      row.id,
      c.atlas_material_id,
    ]);
    if (item) {
      await tx.query(`update erp.production_order_components set line_no = $2, product_id = $3, quantity = $4 where id = $1`, [item.id, c.line_no, productId, c.quantity]);
    } else {
      await tx.query(
        `insert into erp.production_order_components (production_order_id, line_no, product_id, quantity, external_id) values ($1,$2,$3,$4,$5)`,
        [row.id, c.line_no, productId, c.quantity, c.atlas_material_id],
      );
    }
  }
  await tx.query(
    `delete from erp.production_order_components c where c.production_order_id = $1 and (c.external_id is null or not (c.external_id = any($2::text[])))
       and not exists (select 1 from wms.production_requisition_lines x where x.component_id = c.id)`,
    [row.id, op.components.map((c) => c.atlas_material_id)],
  );
  // Requisição de abastecimento na primeira linha de produção ativa do depósito mapeado.
  const [line] = await tx.query<{ id: string }>(
    `select l.id from wms.locations l join wms.zones z on z.id = l.zone_id
     where l.warehouse_id = $1 and z.zone_type = 'production' and z.active and l.status = 'active' order by l.code limit 1`,
    [warehouseId],
  );
  if (!line) return { production_order_id: row.id, requisition: null, note: "Sem linha de produção ativa no depósito: crie a requisição manualmente." };
  const req = await createRequisition(ctx, { productionOrderId: row.id, lineLocationId: line.id, allOrNothing: false, notes: `Liberada pelo ATLAS (${op.number})` });
  return { production_order_id: row.id, requisition: req.code };
}

async function applyProductionCancelled(tx: Queryable, ctx: Ctx, p: A2OPayload<"production_order.cancelled">) {
  const [op] = await tx.query<{ id: string }>(`select id from erp.production_orders where company_id = $1 and external_id = $2 for update`, [
    ctx.user.companyId,
    p.atlas_production_order_id,
  ]);
  if (!op) return { found: false };
  const [req] = await tx.query<{ id: string; code: string; status: string }>(
    `select id, code, status from wms.production_requisitions where production_order_id = $1 and status <> 'cancelled' limit 1`,
    [op.id],
  );
  if (req) {
    if (!["open", "reserved"].includes(req.status)) throw inProgress(`A requisição ${req.code} já está em separação/entregue.`);
    await cancelRequisition(ctx, req.id, { reason: reasonOf(p.reason) });
  }
  await tx.query(`update erp.production_orders set status = 'cancelled' where id = $1`, [op.id]);
  return { requisition: req?.code ?? null };
}

/**
 * Carga inicial (5.3): todo o saldo entra no endereço de recebimento do
 * depósito (movimento `initial_load` por stock-core) e gera tarefas de
 * armazenagem (transferência para o endereço sugerido). Último lote ⇒ vínculo
 * ativo e `stock.balance_snapshot` (reason initial_load) de volta ao ATLAS.
 */
async function applyInitialSnapshot(tx: Queryable, ctx: Ctx, link: LinkRow, p: A2OPayload<"stock.initial_snapshot">) {
  const [cur] = await tx.query<{ status: string }>(`select status from wms.atlas_links where company_id = $1`, [link.company_id]);
  if (cur.status !== "activating") {
    throw new AtlasApplyError("validation_failed", "Carga inicial só é aceita com a integração em ativação.", 400, false);
  }
  const companyId = link.company_id;
  const warehouseId = await warehouseFor(tx, companyId, p.atlas_warehouse_id);
  const products = await productsByExternal(tx, companyId, p.items.map((i) => ({ id: i.atlas_product_id, code: i.product_code })));
  const recvCode = p.receiving_location?.trim().toUpperCase() ?? null;
  const [location] = await tx.query<{ id: string; code: string }>(
    `select l.id, l.code from wms.locations l join wms.zones z on z.id = l.zone_id
     where l.warehouse_id = $1 and l.status = 'active' and z.active and (upper(l.code) = $2::text or z.zone_type = 'receiving')
     order by (upper(l.code) = $2::text) desc nulls last, l.code limit 1`,
    [warehouseId, recvCode],
  );
  if (!location) throw unknownRef("Depósito sem endereço de recebimento ativo para a carga inicial.");
  const tasks: string[] = [];
  for (const item of p.items) {
    const productId = products.get(item.atlas_product_id)!.id;
    const lot = (item.lot_code ?? "").trim().toUpperCase();
    await addStock(tx, ctx, {
      warehouseId,
      locationId: location.id,
      productId,
      lotCode: lot,
      expiryDate: item.expiration_date ?? null,
      quantity: item.quantity,
    });
    await insertMovement(tx, ctx, {
      warehouseId,
      movementType: "initial_load",
      productId,
      lotCode: lot,
      expiryDate: item.expiration_date ?? null,
      quantity: item.quantity,
      toLocationId: location.id,
      reason: `Carga inicial do ATLAS (snapshot ${p.snapshot_id}, lote ${p.chunk}/${p.chunks})`,
      referenceType: "atlas_snapshot",
      referenceId: p.snapshot_id,
      referenceCode: `CARGA-${p.chunk}/${p.chunks}`,
    });
    const suggestion = await suggestLocations(tx, ctx, { warehouseId, productId, lotCode: lot, quantity: item.quantity });
    const best = suggestion.candidates.find((c) => c.location.id !== location.id);
    const code = await nextCode(tx, companyId, "TAR");
    const [t] = await tx.query<{ id: string }>(
      `insert into wms.tasks (company_id, warehouse_id, code, task_type, priority, product_id, lot_code, expiry_date, quantity,
                              from_location_id, suggested_location_id, to_location_id, notes, created_by)
       values ($1,$2,$3,'transfer',2,$4,$5,$6,$7,$8,$9,$9,$10,$11) returning id`,
      [companyId, warehouseId, code, productId, lot, item.expiration_date ?? null, item.quantity, location.id, best?.location.id ?? null,
        `Armazenagem da carga inicial do ATLAS${best ? "" : ` — sem sugestão automática: ${suggestion.reason ?? "defina o destino"}`}`, ctx.user.id],
    );
    await recordTaskEvent(tx, t.id, ctx.user.id, "created", null, "pending", { snapshot: p.snapshot_id });
    tasks.push(code);
  }
  await tx.query(
    `insert into wms.atlas_stock_snapshots (company_id, snapshot_id, direction, reason, warehouse_id, chunk, chunks, items, taken_at)
     values ($1,$2,'inbound','initial_load',$3,$4,$5,$6,$7) on conflict do nothing`,
    [companyId, p.snapshot_id, warehouseId, p.chunk, p.chunks, JSON.stringify(p.items), p.taken_at],
  );
  const [received] = await tx.query<{ n: number }>(
    `select count(distinct chunk)::int as n from wms.atlas_stock_snapshots where company_id = $1 and snapshot_id = $2 and direction = 'inbound'`,
    [companyId, p.snapshot_id],
  );
  let activated = false;
  if (Number(received.n) >= p.chunks) {
    // Outros depósitos ainda podem ter cargas abertas: só ativa quando não houver snapshot incompleto.
    const [open] = await tx.query<{ n: number }>(
      `select count(*)::int as n from (select snapshot_id, max(chunks) as chunks, count(distinct chunk) as got from wms.atlas_stock_snapshots
        where company_id = $1 and direction = 'inbound' group by snapshot_id) s where s.got < s.chunks`,
      [companyId],
    );
    if (Number(open.n) === 0) {
      await tx.query(`update wms.atlas_links set status = 'active', activated_at = coalesce(activated_at, now()), updated_at = now() where company_id = $1`, [companyId]);
      activated = true;
    }
    await emitBalanceSnapshot(tx, ctx, "initial_load");
  }
  return { location: location.code, tasks, activated };
}

// -----------------------------------------------------------------------------
// Saldo para o ATLAS (reconciliação, 5.4)
// -----------------------------------------------------------------------------

export interface SnapshotItem {
  atlas_product_id: string | null;
  sku: string;
  orion_warehouse_code: string;
  lot_code: string | null;
  on_hand: number;
  reserved: number;
  blocked: number;
  in_quarantine: number;
}

export async function balanceItems(q: Queryable, companyId: string, opts: { after?: string | null; limit?: number } = {}): Promise<(SnapshotItem & { key: string })[]> {
  return q.query<SnapshotItem & { key: string }>(
    `select * from (
       select w.code || '|' || p.sku || '|' || b.lot_code as key, p.external_id as atlas_product_id, p.sku, w.code as orion_warehouse_code,
              nullif(b.lot_code, '') as lot_code, sum(b.quantity)::float8 as on_hand, sum(b.reserved_qty)::float8 as reserved,
              sum(b.blocked_qty)::float8 as blocked,
              coalesce(sum(b.quantity) filter (where z.zone_type = 'quarantine'), 0)::float8 as in_quarantine
       from wms.stock_balances b join wms.warehouses w on w.id = b.warehouse_id join erp.products p on p.id = b.product_id
       join wms.locations l on l.id = b.location_id join wms.zones z on z.id = l.zone_id
       where b.company_id = $1 and b.quantity > 0
       group by w.code, p.sku, p.external_id, b.lot_code) s
     where ($2::text is null or s.key > $2) order by s.key limit $3`,
    [companyId, opts.after ?? null, opts.limit ?? 100_000],
  );
}

/** Enfileira stock.balance_snapshot (em lotes de até 1000 itens) para o ATLAS. */
export async function emitBalanceSnapshot(tx: Queryable, ctx: Ctx, reason: "daily_reconciliation" | "initial_load" | "on_demand") {
  const items = await balanceItems(tx, ctx.user.companyId);
  const [last] = await tx.query<{ id: string }>(
    `select id from wms.integration_events where company_id = $1 and event_type <> 'stock.balance_snapshot' order by created_at desc, id desc limit 1`,
    [ctx.user.companyId],
  );
  const snapshotId = randomUUID();
  const chunks = Math.max(1, Math.ceil(items.length / 1000));
  const takenAt = new Date().toISOString();
  for (let chunk = 1; chunk <= chunks; chunk++) {
    const part = items.slice((chunk - 1) * 1000, chunk * 1000).map(({ key: _key, ...i }) => (void _key, i));
    await enqueueIntegrationEvent(tx, ctx, "stock.balance_snapshot", "stock_snapshot", snapshotId, {
      snapshot_id: snapshotId,
      taken_at: takenAt,
      chunk,
      chunks,
      reason,
      as_of_event_id: last?.id ?? null,
      items: part,
    });
    await tx.query(
      `insert into wms.atlas_stock_snapshots (company_id, snapshot_id, direction, reason, chunk, chunks, items, taken_at)
       values ($1,$2,'outbound',$3,$4,$5,$6,$7)`,
      [ctx.user.companyId, snapshotId, reason, chunk, chunks, JSON.stringify(part), takenAt],
    );
  }
  return { snapshotId, items: items.length, chunks };
}

/** Snapshot diário de todas as empresas vinculadas e ativas (uma vez por dia por empresa). */
export async function emitDailySnapshots(db: Db): Promise<{ companies: number; emitted: number }> {
  const links = await db.query<{ company_id: string }>(`select company_id from wms.atlas_links where status = 'active'`);
  let emitted = 0;
  for (const l of links) {
    await db.transaction(async (tx) => {
      const [done] = await tx.query(
        `select 1 from wms.atlas_stock_snapshots where company_id = $1 and direction = 'outbound' and reason = 'daily_reconciliation'
           and created_at >= date_trunc('day', now())`,
        [l.company_id],
      );
      if (done) return;
      const ctx = await systemCtx(tx, l.company_id, db.driver);
      await emitBalanceSnapshot(tx, ctx, "daily_reconciliation");
      emitted++;
    });
  }
  return { companies: links.length, emitted };
}

// -----------------------------------------------------------------------------
// Consultas servidor-a-servidor
// -----------------------------------------------------------------------------

/** GET /documents/{type}/{atlas_id}: estado do documento no ORION. */
export async function documentStatus(q: Queryable, companyId: string, type: string, atlasId: string): Promise<Record<string, unknown> | null> {
  if (type === "sales_order") {
    const [so] = await q.query<{ id: string; number: string; status: string }>(
      `select id, number, status from erp.sales_orders where company_id = $1 and external_id = $2`,
      [companyId, atlasId],
    );
    if (!so) return null;
    const [o] = await q.query<Record<string, unknown>>(
      `select o.id as orion_outbound_id, o.code, o.status, o.requires_invoice, o.invoice_authorized_at, o.shipped_at,
              coalesce(sum(l.requested_qty) filter (where l.cancelled_at is null), 0)::float8 as requested_qty,
              coalesce(sum(l.picked_qty), 0)::float8 as picked_qty, coalesce(sum(l.shipped_qty), 0)::float8 as shipped_qty
       from wms.outbound_orders o left join wms.outbound_order_lines l on l.order_id = o.id
       where o.sales_order_id = $1 group by o.id order by (o.status <> 'cancelled') desc, o.created_at desc limit 1`,
      [so.id],
    );
    return { atlas_document_type: type, atlas_id: atlasId, number: so.number, erp_status: so.status, outbound: o ?? null, can_update: !o || ["open", "reserved", "cancelled"].includes(String(o.status)) };
  }
  if (type === "purchase_order") {
    const [po] = await q.query<{ id: string; number: string; status: string }>(
      `select id, number, status from erp.purchase_orders where company_id = $1 and external_id = $2`,
      [companyId, atlasId],
    );
    if (!po) return null;
    const receipts = await q.query(`select id as orion_receipt_id, code, status from wms.receipts where purchase_order_id = $1 order by created_at`, [po.id]);
    return { atlas_document_type: type, atlas_id: atlasId, number: po.number, status: po.status, receipts };
  }
  if (type === "production_order") {
    const [op] = await q.query<{ id: string; number: string; status: string }>(
      `select id, number, status from erp.production_orders where company_id = $1 and external_id = $2`,
      [companyId, atlasId],
    );
    if (!op) return null;
    const requisitions = await q.query(
      `select id as orion_requisition_id, code, status from wms.production_requisitions where production_order_id = $1 order by created_at`,
      [op.id],
    );
    return { atlas_document_type: type, atlas_id: atlasId, number: op.number, status: op.status, requisitions };
  }
  throw new AtlasApplyError("validation_failed", `Tipo de documento desconhecido: ${type}.`, 400, false);
}

// -----------------------------------------------------------------------------
// Painel (tela Integração → ATLAS)
// -----------------------------------------------------------------------------

export async function getAtlasPanel(ctx: Ctx) {
  assertCan(ctx, "integration.process");
  const [link] = await ctx.db.query<{
    atlas_company_id: string;
    key_id: string;
    status: string;
    status_reason: string | null;
    stock_owner: string;
    require_invoice_before_ship: boolean;
    linked_at: string;
    activated_at: string | null;
    last_inbound_at: string | null;
    last_outbound_at: string | null;
    previous_valid_until: string | null;
  }>(
    `select atlas_company_id, key_id, status, status_reason, stock_owner, require_invoice_before_ship, linked_at::text as linked_at,
            activated_at::text as activated_at, last_inbound_at::text as last_inbound_at, last_outbound_at::text as last_outbound_at,
            previous_valid_until::text as previous_valid_until
     from wms.atlas_links where company_id = $1`,
    [ctx.user.companyId],
  );
  const counts = Object.fromEntries(
    (
      await ctx.db.query<{ status: string; n: number }>(`select status, count(*)::int as n from wms.atlas_inbox where company_id = $1 group by status`, [
        ctx.user.companyId,
      ])
    ).map((r) => [r.status, Number(r.n)]),
  ) as Record<string, number>;
  const warehouses = await ctx.db.query<{ atlas_warehouse_id: string; atlas_code: string | null; atlas_name: string | null; code: string }>(
    `select m.atlas_warehouse_id, m.atlas_code, m.atlas_name, w.code from wms.atlas_warehouse_map m join wms.warehouses w on w.id = m.warehouse_id
     where m.company_id = $1 order by w.code`,
    [ctx.user.companyId],
  );
  const [users] = await ctx.db.query<{ n: number; active: number }>(
    `select count(*)::int as n, (count(*) filter (where active))::int as active from wms.users where company_id = $1 and atlas_user_id is not null`,
    [ctx.user.companyId],
  );
  return { link: link ?? null, counts, warehouses, users: { total: Number(users?.n ?? 0), active: Number(users?.active ?? 0) }, sso: atlasEnv().ssoEnabled };
}

export async function listAtlasInbox(ctx: Ctx, f: { status?: string | null; limit?: number } = {}) {
  assertCan(ctx, "integration.process");
  return ctx.db.query<{
    event_id: string;
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    aggregate_seq: number;
    status: string;
    attempts: number;
    error_code: string | null;
    last_error: string | null;
    received_at: string;
    applied_at: string | null;
  }>(
    `select event_id, event_type, aggregate_type, aggregate_id, aggregate_seq::int as aggregate_seq, status, attempts, error_code, last_error,
            received_at::text as received_at, applied_at::text as applied_at
     from wms.atlas_inbox where company_id = $1 and ($2::text is null or status = $2) order by received_at desc limit $3`,
    [ctx.user.companyId, f.status || null, Math.min(500, f.limit ?? 100)],
  );
}

/** Reaplica um evento que falhou (ex.: dependência já sincronizada). */
export async function reprocessAtlasEvent(ctx: Ctx, eventId: string) {
  assertCan(ctx, "integration.manage");
  const [row] = await ctx.db.query<{ envelope: unknown; status: string }>(
    `select envelope, status from wms.atlas_inbox where event_id = $1 and company_id = $2`,
    [eventId, ctx.user.companyId],
  );
  if (!row) throw new NotFoundError("Evento do ATLAS");
  if (row.status !== "failed") throw new DomainError("Só eventos com erro podem ser reprocessados.", "INVALID_STATUS");
  const link = await getLink(ctx.db, ctx.user.companyId);
  if (!link) throw new DomainError("Empresa sem vínculo com o ATLAS.", "NOT_LINKED");
  const envelope = typeof row.envelope === "string" ? JSON.parse(row.envelope) : row.envelope;
  const result = await receiveAtlasEvent(ctx.db, link, envelope, { reprocess: true });
  await ctx.db.query(
    `insert into wms.audit_log (company_id, user_id, action, entity_type, entity_id, entity_code, details) values ($1,$2,'atlas.event_reprocessed','atlas_event',$3,null,$4)`,
    [ctx.user.companyId, ctx.user.id, eventId, JSON.stringify({ http: result.status, body: result.body })],
  );
  const err = (result.body.error as { message?: string } | undefined)?.message;
  if (result.status >= 400) throw new DomainError(`Reprocessamento recusado: ${err ?? result.status}`, "ATLAS_REJECTED");
  return { eventId, status: result.status };
}

/** Reconciliação na tela: carga inicial recebida × saldo atual, e últimos snapshots enviados. */
export async function atlasReconciliation(ctx: Ctx) {
  assertCan(ctx, "integration.process");
  const inbound = await ctx.db.query<{ sku: string; lot_code: string | null; warehouse: string; atlas_qty: number; orion_qty: number }>(
    `with snap as (
       select s.warehouse_id, i->>'atlas_product_id' as atlas_product_id, upper(coalesce(i->>'lot_code', '')) as lot_code,
              sum((i->>'quantity')::numeric) as qty
       from wms.atlas_stock_snapshots s cross join lateral jsonb_array_elements(s.items) i
       where s.company_id = $1 and s.direction = 'inbound' group by 1, 2, 3)
     select p.sku, nullif(snap.lot_code, '') as lot_code, w.code as warehouse, snap.qty::float8 as atlas_qty,
            coalesce((select sum(b.quantity) from wms.stock_balances b where b.warehouse_id = snap.warehouse_id and b.product_id = p.id
                        and b.lot_code = snap.lot_code), 0)::float8 as orion_qty
     from snap join erp.products p on p.company_id = $1 and p.external_id = snap.atlas_product_id
     join wms.warehouses w on w.id = snap.warehouse_id order by w.code, p.sku, snap.lot_code`,
    [ctx.user.companyId],
  );
  const outbound = await ctx.db.query<{ snapshot_id: string; reason: string; chunks: number; items: number; created_at: string }>(
    `select snapshot_id, reason, max(chunks)::int as chunks, sum(jsonb_array_length(items))::int as items, max(created_at)::text as created_at
     from wms.atlas_stock_snapshots where company_id = $1 and direction = 'outbound' group by snapshot_id, reason order by max(created_at) desc limit 10`,
    [ctx.user.companyId],
  );
  return { inbound, outbound };
}

/** Empresa vinculada ao ATLAS: cadastros mestres somente leitura no ORION. */
export async function isAtlasManaged(q: Queryable, companyId: string): Promise<boolean> {
  const [l] = await q.query<{ status: string }>(`select status from wms.atlas_links where company_id = $1`, [companyId]);
  return Boolean(l && l.status !== "disabled");
}
