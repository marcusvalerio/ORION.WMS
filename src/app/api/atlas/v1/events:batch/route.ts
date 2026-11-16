import type { NextRequest } from "next/server";
import { handleBatch } from "@/server/integrations/atlas/api";
import { serve } from "@/server/integrations/atlas/route-helpers";

export const dynamic = "force-dynamic";

/** Até 500 envelopes da mesma empresa, aplicados em ordem; resposta por item. */
export function POST(request: NextRequest) {
  return serve(request, handleBatch);
}
