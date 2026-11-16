/**
 * Configuração da integração com o ATLAS.ERP (todas opcionais; sem elas o ORION
 * funciona só com login local e o vínculo fica indisponível):
 *
 * - ATLAS_URL ............ base do ATLAS (ex.: https://atlas.exemplo.com.br)
 * - ATLAS_ISSUER / ATLAS_SSO_ISSUER  `iss` exigido no token de SSO (padrão ATLAS_URL)
 * - ATLAS_JWKS_URL ....... JWKS do ATLAS (padrão `${ATLAS_URL}/.well-known/astraeus-jwks.json`)
 * - ATLAS_API_URL ........ base da API do ATLAS para a outbox e a checagem de acesso (padrão ATLAS_URL)
 * - ORION_INSTALL_KEY_ID / ORION_INSTALL_SECRET  credencial de instalação (POST/DELETE /api/atlas/v1/links)
 * - ATLAS_INTEGRATION_ENCRYPTION_KEY  chave AES-256-GCM dos segredos por empresa
 * - ORION_ATLAS_ACCESS_CHECK_SECONDS (900) / ORION_ATLAS_ACCESS_GRACE_SECONDS (3600)
 */
export interface AtlasEnv {
  url: string | null;
  issuer: string | null;
  jwksUrl: string | null;
  apiUrl: string | null;
  installKeyId: string | null;
  installSecret: string | null;
  checkSeconds: number;
  graceSeconds: number;
  ssoEnabled: boolean;
}

const trim = (v: string | undefined) => (v?.trim() ? v.trim().replace(/\/+$/, "") : null);
const positive = (v: string | undefined, fallback: number) => (Number(v) > 0 ? Number(v) : fallback);

export function atlasEnv(env: Record<string, string | undefined> = process.env): AtlasEnv {
  const url = trim(env.ATLAS_URL);
  const issuer = env.ATLAS_SSO_ISSUER?.trim() || env.ATLAS_ISSUER?.trim() || url;
  const jwksUrl = trim(env.ATLAS_JWKS_URL) ?? (url ? `${url}/.well-known/astraeus-jwks.json` : null);
  const installSecret = env.ORION_INSTALL_SECRET?.trim() || null;
  return {
    url,
    issuer: issuer || null,
    jwksUrl,
    apiUrl: trim(env.ATLAS_API_URL) ?? url,
    installKeyId: env.ORION_INSTALL_KEY_ID?.trim() || null,
    installSecret: installSecret && installSecret.length >= 32 ? installSecret : null,
    checkSeconds: positive(env.ORION_ATLAS_ACCESS_CHECK_SECONDS, 900),
    graceSeconds: positive(env.ORION_ATLAS_ACCESS_GRACE_SECONDS, 3600),
    ssoEnabled: Boolean(issuer && jwksUrl),
  };
}

/** Caminho relativo seguro do ORION (começa com "/", sem "//" nem barra invertida). */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return null;
  if (value.length > 500) return null;
  return value;
}
