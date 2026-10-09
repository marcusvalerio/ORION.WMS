import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Token de sessão: base64url(payload).assinaturaHMAC — sem dados sensíveis no payload. */
export interface SessionPayload {
  uid: string;
  exp: number;
}

let cachedSecret: string | null = null;

export function getSessionSecret(): string {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error("SESSION_SECRET deve ter ao menos 32 caracteres.");
    cachedSecret = fromEnv;
    return fromEnv;
  }
  if (process.env.NODE_ENV === "production" && process.env.WMS_ALLOW_LOCAL_SECRET !== "true") {
    throw new Error("Defina SESSION_SECRET em produção.");
  }
  // Desenvolvimento/demonstração: segredo aleatório persistido localmente (fora do controle de versão).
  const dir = path.join(process.cwd(), ".data");
  const file = path.join(dir, "session-secret");
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, randomBytes(48).toString("base64url"), { mode: 0o600 });
  }
  cachedSecret = readFileSync(file, "utf8").trim();
  return cachedSecret;
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createToken(uid: string, ttlSeconds: number, secret = getSessionSecret()): string {
  const payload: SessionPayload = { uid, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data, secret)}`;
}

export function verifyToken(token: string | undefined, secret = getSessionSecret()): SessionPayload | null {
  if (!token) return null;
  const [data, signature] = token.split(".");
  if (!data || !signature) return null;
  const expected = Buffer.from(sign(data, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as SessionPayload;
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
