import { accessCheckResponseSchema, type AccessCheckResponse } from "./contract";
import { signedHeaders } from "./crypto";

/** Chamadas do ORION à API do ATLAS, assinadas com o HMAC da empresa (X-Astraeus-*, contrato 3.2). */

export interface AtlasCredentials {
  keyId: string;
  secret: string;
}

export interface ClientOptions {
  apiUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class AtlasHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "AtlasHttpError";
  }
}

export async function atlasRequest(
  cred: AtlasCredentials,
  o: ClientOptions,
  method: "GET" | "POST",
  path: string,
  body = "",
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
  const url = new URL(path, o.apiUrl.endsWith("/") ? o.apiUrl : `${o.apiUrl}/`);
  // O caminho assinado é o pathname+query completo da URL chamada.
  const signedPath = `${url.pathname}${url.search}`;
  const timeoutMs = o.timeoutMs ?? 10_000;
  let response: Response;
  try {
    response = await (o.fetchImpl ?? fetch)(url, {
      method,
      headers: {
        ...signedHeaders(cred.keyId, cred.secret, method, signedPath, body),
        ...(method === "POST" ? { "Content-Type": "application/json; charset=utf-8" } : {}),
        "User-Agent": "orion-wms-atlas",
        ...extraHeaders,
      },
      body: method === "POST" ? body : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch (error) {
    const e = error as Error;
    throw new AtlasHttpError(e?.name === "TimeoutError" ? `Tempo esgotado após ${timeoutMs} ms.` : `Falha de rede: ${e?.message ?? String(error)}`, null, true);
  }
  return { status: response.status, text: await response.text().catch(() => "") };
}

/** GET /api/integrations/orion/v1/access?atlas_user_id=… (contrato 2.7). */
export async function checkAtlasAccess(cred: AtlasCredentials, o: ClientOptions, atlasUserId: string): Promise<AccessCheckResponse> {
  const { status, text } = await atlasRequest(cred, o, "GET", `api/integrations/orion/v1/access?atlas_user_id=${encodeURIComponent(atlasUserId)}`);
  if (status !== 200) throw new AtlasHttpError(`ATLAS respondeu HTTP ${status} na checagem de acesso.`, status, status >= 500 || status === 429);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AtlasHttpError("Resposta da checagem de acesso não é JSON.", status, true);
  }
  const parsed = accessCheckResponseSchema.safeParse(json);
  if (!parsed.success) throw new AtlasHttpError("Resposta da checagem de acesso fora do contrato.", status, true);
  if (parsed.data.atlas_user_id !== atlasUserId) throw new AtlasHttpError("Resposta da checagem de acesso para outro usuário.", status, false);
  return parsed.data;
}
