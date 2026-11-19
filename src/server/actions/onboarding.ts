"use server";

import { cookies } from "next/headers";
import { getSessionUser } from "../auth/session";
import { getDb } from "../db";
import { isDemoMode } from "../demo-mode";
import { marcarOnboardingVisto } from "../services/onboarding";
import { ONBOARDING_COOKIE } from "@/lib/onboarding";
import { NOVIDADES_COOKIE, parseVistas, versaoValida } from "@/lib/novidades";

const ANO = 60 * 60 * 24 * 365;

/**
 * Tour de primeiros passos concluído ou pulado. No modo demonstração guarda em
 * cookie e também marca as Novidades da versão atual como vistas.
 */
export async function concluirOnboardingAction(pulou: boolean, versaoNovidades?: string): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  if (isDemoMode()) {
    const store = await cookies();
    store.set(ONBOARDING_COOKIE, "1", { path: "/", sameSite: "lax", maxAge: ANO });
    if (versaoNovidades && versaoValida(versaoNovidades)) {
      const vistas = new Set(parseVistas(store.get(NOVIDADES_COOKIE)?.value));
      vistas.add(versaoNovidades);
      store.set(NOVIDADES_COOKIE, [...vistas].join(","), { path: "/", sameSite: "lax", maxAge: ANO });
    }
    return;
  }
  await marcarOnboardingVisto({ db: await getDb(), user }, pulou ? "skipped" : "completed");
}
