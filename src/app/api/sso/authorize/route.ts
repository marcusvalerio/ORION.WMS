import { NextResponse, type NextRequest } from "next/server";
import { buildAuthorizeRedirect, SSO_STATE_COOKIE, SSO_STATE_TTL_SECONDS } from "@/server/integrations/atlas/sso-flow";

export const dynamic = "force-dynamic";

/** "Entrar com ATLAS" (fluxo B): grava o state em cookie e redireciona ao ATLAS. */
export function GET(request: NextRequest) {
  const target = buildAuthorizeRedirect(request.nextUrl.searchParams.get("return_to"));
  if (!target) {
    const back = request.nextUrl.clone();
    back.pathname = "/login";
    back.search = "?sso_error=sso_disabled";
    return NextResponse.redirect(back, 303);
  }
  const response = NextResponse.redirect(target.url, 303);
  response.cookies.set(SSO_STATE_COOKIE, target.state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.WMS_INSECURE_COOKIES !== "true",
    path: "/api/sso",
    maxAge: SSO_STATE_TTL_SECONDS,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
