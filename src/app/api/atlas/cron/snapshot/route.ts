import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { emitDailySnapshots } from "@/server/services/atlas-sync";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7).trim() : "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Reconciliação diária (contrato 5.4): enfileira stock.balance_snapshot de cada
 * empresa vinculada e ativa (uma vez por dia). Protegida por CRON_SECRET.
 */
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return NextResponse.json({ error: "CRON_SECRET não configurada no servidor." }, { status: 503 });
  if (!authorized(request, secret)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const result = await emitDailySnapshots(await getDb());
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
