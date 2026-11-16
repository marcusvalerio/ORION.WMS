import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Segredos HMAC por empresa cifrados em repouso (AES-256-GCM, contrato 3.2).
 * Chave: ATLAS_INTEGRATION_ENCRYPTION_KEY — 32 bytes em base64/base64url ou 64
 * caracteres hex. Fora de produção, sem a variável, usa uma chave derivada fixa
 * de desenvolvimento (nunca use em produção: a inicialização recusa).
 */
export function encryptionKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.ATLAS_INTEGRATION_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (env.NODE_ENV === "production" && env.WMS_DEMO_MODE !== "true") {
      throw new Error("Defina ATLAS_INTEGRATION_ENCRYPTION_KEY (32 bytes em base64) para vincular empresas ao ATLAS.");
    }
    return createHash("sha256").update("orion-wms/atlas/dev-only-key").digest();
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const b = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (b.length !== 32) throw new Error("ATLAS_INTEGRATION_ENCRYPTION_KEY deve ter 32 bytes (base64) ou 64 caracteres hex.");
  return b;
}

/** Formato: v1.<iv>.<tag>.<cifrado> (base64url). */
export function encryptSecret(plain: string, key = encryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(stored: string, key = encryptionKey()): string {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Segredo cifrado em formato desconhecido.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

// -----------------------------------------------------------------------------
// HMAC servidor-a-servidor (3.2)
// -----------------------------------------------------------------------------

export const KEY_ID_HEADER = "x-astraeus-key-id";
export const TS_HEADER = "x-astraeus-timestamp";
export const SIG_HEADER = "x-astraeus-signature";
export const MAX_SKEW_SECONDS = 300;

/** hex(HMAC_SHA256(segredo, `${timestamp}.${METHOD}.${path_com_query}.${corpo}`)). */
export function signRequest(secret: string, timestamp: string, method: string, pathWithQuery: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${method.toUpperCase()}.${pathWithQuery}.${body}`).digest("hex");
}

export function signedHeaders(keyId: string, secret: string, method: string, pathWithQuery: string, body: string, now = Date.now()) {
  const timestamp = String(Math.floor(now / 1000));
  return {
    "X-Astraeus-Key-Id": keyId,
    "X-Astraeus-Timestamp": timestamp,
    "X-Astraeus-Signature": `sha256=${signRequest(secret, timestamp, method, pathWithQuery, body)}`,
  };
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type SignatureCheck =
  | { ok: true }
  | { ok: false; code: "invalid_signature" | "stale_timestamp"; message: string };

/** Confere timestamp (janela de 300 s) e assinatura contra os segredos aceitos (atual e, na rotação, o anterior). */
export function verifySignature(
  input: { timestamp: string | null; signature: string | null; method: string; pathWithQuery: string; body: string },
  secrets: string[],
  now = Date.now(),
): SignatureCheck {
  const ts = input.timestamp ?? "";
  if (!/^\d{1,12}$/.test(ts)) return { ok: false, code: "stale_timestamp", message: "Cabeçalho X-Astraeus-Timestamp ausente ou inválido." };
  if (Math.abs(Math.floor(now / 1000) - Number(ts)) > MAX_SKEW_SECONDS) {
    return { ok: false, code: "stale_timestamp", message: "Timestamp fora da janela de 300 segundos." };
  }
  const sig = (input.signature ?? "").replace(/^sha256=/, "");
  if (!/^[0-9a-f]{64}$/.test(sig)) return { ok: false, code: "invalid_signature", message: "Assinatura ausente ou malformada." };
  for (const secret of secrets) {
    if (safeEqualHex(sig, signRequest(secret, ts, input.method, input.pathWithQuery, input.body))) return { ok: true };
  }
  return { ok: false, code: "invalid_signature", message: "Assinatura inválida." };
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** JSON com chaves ordenadas (o jsonb do Postgres reordena chaves; o hash de idempotência não pode depender disso). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
