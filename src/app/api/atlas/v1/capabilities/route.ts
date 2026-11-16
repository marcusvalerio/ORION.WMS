import type { NextRequest } from "next/server";
import { handleCapabilities } from "@/server/integrations/atlas/api";
import { serve } from "@/server/integrations/atlas/route-helpers";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return serve(request, handleCapabilities);
}
