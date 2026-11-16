import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "../../db";
import type { Db } from "../../db/types";
import type { ApiRequest } from "./api";
import type { ApiResult } from "../../services/atlas-sync";

/** Adapta a requisição do Next para a API (corpo bruto: entra na assinatura HMAC). */
export async function toApiRequest(request: NextRequest): Promise<ApiRequest> {
  const body = request.method === "GET" || request.method === "DELETE" ? "" : await request.text();
  return { method: request.method, pathWithQuery: `${request.nextUrl.pathname}${request.nextUrl.search}`, headers: request.headers, body };
}

export function toResponse(r: ApiResult): NextResponse {
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store" } });
}

export async function serve(request: NextRequest, fn: (db: Db, req: ApiRequest) => Promise<ApiResult>): Promise<NextResponse> {
  try {
    return toResponse(await fn(await getDb(), await toApiRequest(request)));
  } catch (error) {
    console.error("[atlas-api]", (error as Error)?.message);
    return NextResponse.json(
      { status: "rejected", event_id: null, error: { code: "internal_error", message: "Erro interno.", retryable: true } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
