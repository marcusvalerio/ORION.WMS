/**
 * Modo demonstração: o app abre direto, sem login, como a administradora da
 * empresa fictícia (usuários `is_demo`), num banco PGlite temporário.
 *
 * Só liga com `WMS_DEMO_MODE=true` explícito. Em produção o sistema usa o banco
 * de `DATABASE_URL` e exige login; sem banco configurado ele não abre (ver
 * `src/server/db/index.ts`) em vez de cair num banco temporário.
 */
export function isDemoMode(): boolean {
  return process.env.WMS_DEMO_MODE === "true";
}
