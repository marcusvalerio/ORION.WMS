import "server-only";
import type { Ctx } from "../context";
import { DomainError } from "../errors";
import { atlasVinculado } from "@/lib/onboarding";
import { marcarVersaoVista } from "./novidades";

export interface PrimeiroAcesso {
  /** Tour ainda não concluído nem pulado por este usuário. */
  pendente: boolean;
  /** Empresa com vínculo ATLAS ativo ou ativando. */
  vinculadaAtlas: boolean;
}

/** Estado do onboarding do usuário e vínculo ATLAS da empresa. */
export async function estadoOnboarding(ctx: Ctx): Promise<PrimeiroAcesso> {
  const [seen] = await ctx.db.query<{ user_id: string }>(
    `select user_id from wms.onboarding_seen where user_id = $1 and company_id = $2`,
    [ctx.user.id, ctx.user.companyId],
  );
  return { pendente: !seen, vinculadaAtlas: await empresaVinculadaAtlas(ctx) };
}

export async function empresaVinculadaAtlas(ctx: Ctx): Promise<boolean> {
  const [link] = await ctx.db.query<{ status: string }>(`select status from wms.atlas_links where company_id = $1`, [ctx.user.companyId]);
  return atlasVinculado(link?.status);
}

/**
 * Primeiro acesso: com o onboarding pendente, as Novidades da versão atual são
 * marcadas como vistas para o usuário (as duas janelas nunca abrem juntas).
 */
export async function prepararPrimeiroAcesso(ctx: Ctx, versaoAtual: string | undefined): Promise<PrimeiroAcesso> {
  const estado = await estadoOnboarding(ctx);
  if (estado.pendente && versaoAtual) await marcarVersaoVista(ctx, versaoAtual);
  return estado;
}

/** Registra que o usuário concluiu ou pulou o tour (idempotente). */
export async function marcarOnboardingVisto(ctx: Ctx, outcome: "completed" | "skipped" = "completed"): Promise<void> {
  if (outcome !== "completed" && outcome !== "skipped") throw new DomainError("Resultado inválido.", "VALIDATION");
  await ctx.db.query(
    `insert into wms.onboarding_seen (user_id, company_id, outcome) values ($1, $2, $3)
     on conflict (user_id) do nothing`,
    [ctx.user.id, ctx.user.companyId, outcome],
  );
}
