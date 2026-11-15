import "server-only";
import type { Ctx } from "../context";
import { DomainError } from "../errors";
import { versaoValida } from "@/lib/novidades";

/** Versões de novidades que o usuário já viu (persistidas no banco). */
export async function versoesVistas(ctx: Ctx): Promise<string[]> {
  const rows = await ctx.db.query<{ version: string }>(
    `select version from wms.release_notes_seen where user_id = $1 and company_id = $2`,
    [ctx.user.id, ctx.user.companyId],
  );
  return rows.map((r) => r.version);
}

/** Marca a versão como vista pelo usuário (idempotente). */
export async function marcarVersaoVista(ctx: Ctx, versao: string): Promise<void> {
  if (!versaoValida(versao)) throw new DomainError("Versão inválida.", "VALIDATION");
  await ctx.db.query(
    `insert into wms.release_notes_seen (user_id, company_id, version) values ($1, $2, $3)
     on conflict (user_id, version) do nothing`,
    [ctx.user.id, ctx.user.companyId, versao],
  );
}
