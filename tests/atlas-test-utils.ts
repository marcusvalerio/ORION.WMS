import type { Db } from "@/server/db/types";
import { systemCtx } from "@/server/integrations/atlas/system";
export { enforceAtlasAccess, reprocessAtlasEvent } from "@/server/services/atlas-sync";

/** Contexto de sistema fora de transação (para enfileirar eventos de teste). */
export async function systemCtxForTests(db: Db, companyId: string) {
  const ctx = await systemCtx(db, companyId, db.driver);
  return { ...ctx, db };
}
