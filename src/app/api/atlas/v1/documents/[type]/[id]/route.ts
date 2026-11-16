import type { NextRequest } from "next/server";
import { handleDocument } from "@/server/integrations/atlas/api";
import { serve } from "@/server/integrations/atlas/route-helpers";

export const dynamic = "force-dynamic";

/** Estado do documento no ORION (sales_order, purchase_order, production_order). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  return serve(request, (db, req) => handleDocument(db, req, type, id));
}
