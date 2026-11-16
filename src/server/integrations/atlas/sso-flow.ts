import "server-only";
import type { JWTVerifyGetKey } from "jose";
import { randomBytes } from "node:crypto";
import type { Db } from "../../db/types";
import { atlasEnv, safeReturnTo, type AtlasEnv } from "./config";
import { remoteJwks, SsoError, verifyLaunchToken } from "./sso";
import { auditSsoDenied, consumeLaunchClaims } from "../../services/atlas-sync";

export const SSO_STATE_COOKIE = "orion_sso_state";
export const SSO_STATE_TTL_SECONDS = 600;

export type SsoOutcome =
  | { ok: true; userId: string; companyId: string; returnTo: string; accessVersion: number }
  | { ok: false; code: string; status: number; message: string };

/**
 * POST /api/sso/atlas (contrato 2.4): valida o token (assinatura ES256/JWKS,
 * iss, aud, exp/nbf, idade, claims, return_to, state), bloqueia replay (jti),
 * confere a empresa vinculada e provisiona/atualiza o usuário (JIT).
 */
export async function completeAtlasSso(
  db: Db,
  input: { token: unknown; stateCookie: string | null },
  deps: { env?: AtlasEnv; jwks?: JWTVerifyGetKey; now?: Date } = {},
): Promise<SsoOutcome> {
  const env = deps.env ?? atlasEnv();
  if (!env.ssoEnabled || !env.issuer || !env.jwksUrl) return { ok: false, code: "sso_disabled", status: 503, message: "SSO do ATLAS não configurado." };
  let claims: Awaited<ReturnType<typeof verifyLaunchToken>> | null = null;
  try {
    claims = await verifyLaunchToken(String(input.token ?? ""), {
      issuer: env.issuer,
      jwks: deps.jwks ?? remoteJwks(env.jwksUrl),
      expectedState: input.stateCookie,
      currentDate: deps.now,
    });
    const r = await consumeLaunchClaims(db, claims);
    return { ok: true, userId: r.userId, companyId: r.companyId, returnTo: claims.return_to, accessVersion: claims.access_version };
  } catch (error) {
    if (error instanceof SsoError) {
      await auditSsoDenied(db, claims, error.code);
      return { ok: false, code: error.code, status: error.status, message: error.message };
    }
    console.error("[sso]", (error as Error)?.message);
    return { ok: false, code: "default", status: 500, message: "Falha ao processar o login pelo ATLAS." };
  }
}

/** Início pelo ORION (fluxo B): state aleatório + URL de autorização no ATLAS. */
export function buildAuthorizeRedirect(returnTo: unknown, env: AtlasEnv = atlasEnv()): { url: string; state: string } | null {
  if (!env.url) return null;
  const state = randomBytes(32).toString("base64url");
  const target = new URL(`${env.url}/api/integrations/orion/v1/sso/authorize`);
  target.searchParams.set("state", state);
  target.searchParams.set("return_to", safeReturnTo(returnTo) ?? "/");
  return { url: target.toString(), state };
}
