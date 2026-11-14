import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { collectHealth, toPublicHealth } from "@/server/services/health";

export const dynamic = "force-dynamic";

/**
 * Saúde do sistema (pública, para monitoramento): versão, banco, migrations e
 * tamanho da fila. Não expõe hosts, segredos nem dados de empresa.
 * 200 = ok/degradado, 503 = banco indisponível.
 */
export async function GET() {
  const health = toPublicHealth(await collectHealth(getDb));
  return NextResponse.json(health, {
    status: health.status === "error" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
