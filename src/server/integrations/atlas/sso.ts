import { createRemoteJWKSet, decodeProtectedHeader, errors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { launchClaimsSchema, SSO_AUDIENCE, type LaunchClaims } from "./contract";
import { safeReturnTo } from "./config";
import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Verificação do token de lançamento do ATLAS (contrato 2.4, passos 1–3):
 * ES256 apenas, `kid` obrigatório e presente no JWKS, iss/aud exatos,
 * tolerância de relógio 30 s, idade máxima 120 s, `exp - iat` ≤ 120 s,
 * claims tipadas (Zod), `return_to` relativo e `state` igual ao cookie.
 * Replay (jti) e empresa são conferidos em services/atlas-sync.ts.
 */

export type SsoErrorCode =
  | "invalid_token"
  | "invalid_signature"
  | "token_expired"
  | "invalid_audience"
  | "invalid_issuer"
  | "invalid_claims"
  | "invalid_return_to"
  | "state_mismatch"
  | "token_replayed"
  | "company_not_linked"
  | "access_revoked"
  | "jwks_unavailable";

export class SsoError extends Error {
  constructor(
    public readonly code: SsoErrorCode,
    message: string,
    public readonly status = 401,
  ) {
    super(message);
    this.name = "SsoError";
  }
}

type GlobalJwks = typeof globalThis & { __orionAtlasJwks?: { url: string; get: JWTVerifyGetKey } };
const g = globalThis as GlobalJwks;

/** JWKS remoto com cache (createRemoteJWKSet refaz o fetch ao ver `kid` desconhecido; cooldown 30 s). */
export function remoteJwks(url: string): JWTVerifyGetKey {
  if (!g.__orionAtlasJwks || g.__orionAtlasJwks.url !== url) {
    g.__orionAtlasJwks = { url, get: createRemoteJWKSet(new URL(url), { cacheMaxAge: 5 * 60_000, cooldownDuration: 30_000, timeoutDuration: 5_000 }) };
  }
  return g.__orionAtlasJwks.get;
}

export interface VerifyOptions {
  issuer: string;
  jwks: JWTVerifyGetKey;
  /** `state` do cookie orion_sso_state (fluxo iniciado no ORION), se houver. */
  expectedState?: string | null;
  currentDate?: Date;
}

export async function verifyLaunchToken(token: string, o: VerifyOptions): Promise<LaunchClaims & { return_to: string }> {
  if (typeof token !== "string" || token.length > 8192 || token.split(".").length !== 3) {
    throw new SsoError("invalid_token", "Token de acesso ausente ou malformado.");
  }
  let header;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw new SsoError("invalid_token", "Cabeçalho do token inválido.");
  }
  if (header.alg !== "ES256" || !header.kid) throw new SsoError("invalid_token", "Algoritmo não permitido ou kid ausente.");
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, o.jwks, {
      issuer: o.issuer,
      audience: SSO_AUDIENCE,
      algorithms: ["ES256"],
      clockTolerance: 30,
      maxTokenAge: "120s",
      currentDate: o.currentDate,
      requiredClaims: ["iss", "aud", "sub", "exp", "iat", "nbf", "jti"],
    }));
  } catch (error) {
    if (error instanceof errors.JWTExpired) throw new SsoError("token_expired", "Token expirado.");
    if (error instanceof errors.JWTClaimValidationFailed) {
      if (error.claim === "aud") throw new SsoError("invalid_audience", "Audiência do token inválida.");
      if (error.claim === "iss") throw new SsoError("invalid_issuer", "Emissor do token inválido.");
      if (error.claim === "iat" || error.claim === "nbf") throw new SsoError("token_expired", "Token fora da janela de validade.");
      throw new SsoError("invalid_claims", `Claim inválida: ${error.claim}.`);
    }
    if (error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWSSignatureVerificationFailed) {
      throw new SsoError("invalid_signature", "Assinatura do token inválida.");
    }
    if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) {
      throw new SsoError("jwks_unavailable", "Chaves do ATLAS indisponíveis.", 503);
    }
    throw new SsoError("invalid_token", "Token inválido.");
  }
  const parsed = launchClaimsSchema.safeParse(payload);
  if (!parsed.success) throw new SsoError("invalid_claims", "Claims do token incompletas ou inválidas.");
  const claims = parsed.data;
  if (claims.exp - claims.iat > 120) throw new SsoError("invalid_claims", "Validade do token acima de 120 segundos.");
  const returnTo = claims.return_to == null || claims.return_to === "" ? "/painel" : safeReturnTo(claims.return_to);
  if (!returnTo) throw new SsoError("invalid_return_to", "Destino (return_to) inválido.", 400);
  // Token com state (fluxo iniciado no ORION) exige o mesmo valor no cookie; sem state é o fluxo iniciado no ATLAS.
  if (claims.state && (!o.expectedState || !safeEqual(claims.state, o.expectedState))) {
    throw new SsoError("state_mismatch", "Estado (state) não confere.");
  }
  return { ...claims, return_to: returnTo };
}
