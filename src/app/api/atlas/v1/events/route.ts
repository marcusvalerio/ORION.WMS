import type { NextRequest } from "next/server";
import { handleEvent } from "@/server/integrations/atlas/api";
import { serve } from "@/server/integrations/atlas/route-helpers";

export const dynamic = "force-dynamic";

/** Entrada única de eventos do ATLAS (um envelope por requisição, HMAC da empresa). */
export function POST(request: NextRequest) {
  return serve(request, handleEvent);
}
