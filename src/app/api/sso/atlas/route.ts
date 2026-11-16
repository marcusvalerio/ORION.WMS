import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/server/db";
import { startSession } from "@/server/auth/session";
import { completeAtlasSso, SSO_STATE_COOKIE } from "@/server/integrations/atlas/sso-flow";

export const dynamic = "force-dynamic";

/**
 * Login único pelo ATLAS (contrato 2.3/2.4): recebe o token de lançamento por
 * form_post (campo `token`), valida, provisiona o usuário e abre a sessão.
 * Erros voltam ao /login com um código (o token nunca aparece na URL).
 */
export async function POST(request: NextRequest) {
  const store = await cookies();
  const stateCookie = store.get(SSO_STATE_COOKIE)?.value ?? null;
  let token: unknown = null;
  try {
    const form = await request.formData();
    token = form.get("token");
  } catch {
    token = null;
  }
  store.delete(SSO_STATE_COOKIE);
  const outcome = await completeAtlasSso(await getDb(), { token, stateCookie });
  const base = request.nextUrl.clone();
  base.search = "";
  if (!outcome.ok) {
    base.pathname = "/login";
    base.searchParams.set("sso_error", outcome.code);
    return NextResponse.redirect(base, { status: 303, headers: { "Cache-Control": "no-store" } });
  }
  await startSession(outcome.userId, { src: "atlas", av: outcome.accessVersion });
  const target = new URL(outcome.returnTo, base);
  return NextResponse.redirect(target, { status: 303, headers: { "Cache-Control": "no-store" } });
}
