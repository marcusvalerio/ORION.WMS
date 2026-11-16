import type { NextRequest } from "next/server";
import { handleDeleteLink } from "@/server/integrations/atlas/api";
import { serve } from "@/server/integrations/atlas/route-helpers";

export const dynamic = "force-dynamic";

/** Desvínculo (contrato 6.3): credencial de instalação. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ atlasCompanyId: string }> }) {
  const { atlasCompanyId } = await params;
  return serve(request, (db, req) => handleDeleteLink(db, req, atlasCompanyId));
}
