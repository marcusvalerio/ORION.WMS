import type { NextRequest } from "next/server";
import { handleBatch } from "@/server/integrations/atlas/api";
import { serve } from "@/server/integrations/atlas/route-helpers";

export const dynamic = "force-dynamic";

/** Alias legado de /api/atlas/v1/events/batch (mesmo corpo e resposta). */
export function POST(request: NextRequest) {
  return serve(request, handleBatch);
}
