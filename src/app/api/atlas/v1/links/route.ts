import type { NextRequest } from "next/server";
import { handlePostLink } from "@/server/integrations/atlas/api";
import { serve } from "@/server/integrations/atlas/route-helpers";

export const dynamic = "force-dynamic";

/** Vínculo de empresa ATLAS ↔ ORION (credencial de instalação, contrato 3.4/6.1). */
export function POST(request: NextRequest) {
  return serve(request, (db, req) => handlePostLink(db, req));
}
