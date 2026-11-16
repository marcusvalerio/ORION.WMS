import type { NextRequest } from "next/server";
import { handleBalances } from "@/server/integrations/atlas/api";
import { serve } from "@/server/integrations/atlas/route-helpers";

export const dynamic = "force-dynamic";

/** Saldo físico paginado (?cursor=&limit=), para reconciliação sob demanda. */
export function GET(request: NextRequest) {
  return serve(request, handleBalances);
}
