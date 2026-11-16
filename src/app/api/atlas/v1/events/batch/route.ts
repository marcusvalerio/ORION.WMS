import type { NextRequest } from "next/server";
import { handleBatch } from "@/server/integrations/atlas/api";
import { serve } from "@/server/integrations/atlas/route-helpers";

export const dynamic = "force-dynamic";

/**
 * POST /api/atlas/v1/events/batch (contrato 3.4): corpo `{ events: [...] }`, até
 * 500 envelopes da mesma empresa aplicados em ordem; resposta
 * `{ status: "processed", results: [{ http_status, body }] }`.
 * O caminho antigo `/events:batch` continua como alias.
 */
export function POST(request: NextRequest) {
  return serve(request, handleBatch);
}
