import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { processOutbox } from "@/server/integrations/outbox/processor";
import { transportFromEnv } from "@/server/integrations/outbox/transports";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7).trim() : "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Processa a outbox de integração de todas as empresas.
 * Protegida por `Authorization: Bearer <CRON_SECRET>` (o Vercel Cron envia este
 * cabeçalho automaticamente quando CRON_SECRET está definida no projeto).
 * Aceita POST (uso manual/agendadores) e GET (o Vercel Cron chama com GET).
 */
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: "CRON_SECRET não configurada no servidor (mínimo 16 caracteres)." }, { status: 503 });
  }
  if (!authorized(request, secret)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const config = transportFromEnv();
  if (!config.ok) return NextResponse.json({ error: `Transporte mal configurado: ${config.error}` }, { status: 500 });
  const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 50));
  try {
    const result = await processOutbox(await getDb(), { transport: config.transport, limit });
    return NextResponse.json(
      {
        transport: config.transport.name,
        claimed: result.claimed,
        sent: result.sent,
        retrying: result.retrying,
        failed: result.failed,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[outbox]", error);
    return NextResponse.json({ error: "Falha ao processar a fila." }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle;
