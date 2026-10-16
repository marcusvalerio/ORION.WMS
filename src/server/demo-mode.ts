/**
 * Modo demonstração: o app abre direto, sem login, como a administradora da
 * empresa fictícia (usuários `is_demo`), num banco PGlite temporário.
 *
 * - `WMS_DEMO_MODE=true` liga; `WMS_DEMO_MODE=false` desliga.
 * - Sem a variável, liga sozinho na Vercel (preview e produção) quando não há
 *   `DATABASE_URL`: sem banco configurado o app só roda com dados de
 *   demonstração. Com `DATABASE_URL`, nunca entra sem login num banco real.
 */
export function isDemoMode(): boolean {
  const flag = process.env.WMS_DEMO_MODE;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return Boolean(process.env.VERCEL_ENV) && !process.env.DATABASE_URL;
}
