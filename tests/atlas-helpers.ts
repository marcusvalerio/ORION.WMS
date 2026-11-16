/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures JSON do contrato manipuladas livremente nos testes */
/** Simulador do ATLAS para os testes: fixtures do contrato, envelopes assinados e chaves de SSO. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWK } from "jose";
import type { Db } from "@/server/db/types";
import { signedHeaders } from "@/server/integrations/atlas/crypto";
import { handleEvent, handlePostLink, type ApiRequest } from "@/server/integrations/atlas/api";
import type { AtlasEnv } from "@/server/integrations/atlas/config";

export const INSTALL = { keyId: "orion-install-test", secret: "install-secret-de-teste-com-mais-de-32-chars" };
export const ISSUER = "https://atlas.teste.local";

export function testEnv(over: Partial<AtlasEnv> = {}): AtlasEnv {
  return {
    url: ISSUER,
    issuer: ISSUER,
    jwksUrl: `${ISSUER}/.well-known/astraeus-jwks.json`,
    apiUrl: ISSUER,
    installKeyId: INSTALL.keyId,
    installSecret: INSTALL.secret,
    checkSeconds: 900,
    graceSeconds: 3600,
    ssoEnabled: true,
    ...over,
  };
}

export function fixture<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), "docs/contrato", `${name}.json`), "utf8"));
}

export function request(method: string, pathWithQuery: string, body: string, keyId: string, secret: string, now = Date.now()): ApiRequest {
  return { method, pathWithQuery, body, headers: new Headers(signedHeaders(keyId, secret, method, pathWithQuery, body, now)) };
}

export interface AtlasCompanySim {
  atlasCompanyId: string;
  orionCompanyId: string;
  keyId: string;
  secret: string;
  send: (envelope: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>;
  /** Fixture a2o.<tipo> com a empresa do simulador e alterações opcionais. */
  event: (name: string, patch?: (e: Record<string, any>) => void) => Record<string, any>;
}

export async function linkCompany(db: Db, opts: { atlasCompanyId?: string; document?: string; name?: string } = {}): Promise<AtlasCompanySim> {
  const atlasCompanyId = opts.atlasCompanyId ?? randomUUID();
  const keyId = `atlas-co-${atlasCompanyId.slice(0, 8)}`;
  const secret = `segredo-${randomUUID()}-${randomUUID()}`;
  const body = JSON.stringify({
    atlas_company_id: atlasCompanyId,
    key_id: keyId,
    secret,
    company: { name: opts.name ?? "Alfa Indústria", document: opts.document ?? null },
    admin: null,
  });
  const r = await handlePostLink(db, request("POST", "/api/atlas/v1/links", body, INSTALL.keyId, INSTALL.secret), testEnv());
  if (r.status >= 300) throw new Error(`link falhou: ${JSON.stringify(r.body)}`);
  const orionCompanyId = String(r.body.orion_company_id);
  const send = (envelope: Record<string, unknown>) =>
    handleEvent(db, request("POST", "/api/atlas/v1/events", JSON.stringify(envelope), keyId, secret));
  const event = (name: string, patch?: (e: Record<string, any>) => void) => {
    const e = fixture<Record<string, any>>(`a2o.${name}`);
    e.atlas_company_id = atlasCompanyId;
    e.orion_company_id = orionCompanyId;
    if (e.payload.company?.atlas_company_id) e.payload.company.atlas_company_id = atlasCompanyId;
    if (e.payload.atlas_company_id) e.payload.atlas_company_id = atlasCompanyId;
    if (e.type.startsWith("company.")) e.aggregate.id = atlasCompanyId;
    patch?.(e);
    return e;
  };
  return { atlasCompanyId, orionCompanyId, keyId, secret, send, event };
}

/** Par de chaves ES256 do "ATLAS" e JWKS local. */
export async function ssoKeys(kid = "atlas-sso-teste") {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const sign = async (claims: Record<string, unknown>, o: { iat?: number; ttl?: number; aud?: string; iss?: string; key?: CryptoKey; kid?: string } = {}) => {
    const iat = o.iat ?? Math.floor(Date.now() / 1000);
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: o.kid ?? kid })
      .setIssuer(o.iss ?? ISSUER)
      .setAudience(o.aud ?? "orion-wms")
      .setIssuedAt(iat)
      .setNotBefore(iat)
      .setExpirationTime(iat + (o.ttl ?? 60))
      .setJti(randomUUID())
      .sign(o.key ?? privateKey);
  };
  return { jwks, sign, jwk };
}
