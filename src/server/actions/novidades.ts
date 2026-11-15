"use server";

import { cookies } from "next/headers";
import { getSessionUser } from "../auth/session";
import { getDb } from "../db";
import { isDemoMode } from "../demo-mode";
import { marcarVersaoVista } from "../services/novidades";
import { registrarLead } from "../services/site-leads";
import { toUserMessage } from "../errors";
import { NOVIDADES_COOKIE, parseVistas, versaoValida } from "@/lib/novidades";
import type { ActionState } from "@/lib/action-state";

/**
 * Registra que o usuário viu as novidades da versão. No modo demonstração (banco
 * temporário, todos entram como a mesma administradora) guarda em cookie.
 */
export async function marcarNovidadesVistasAction(versao: string): Promise<void> {
  if (!versaoValida(versao)) return;
  const user = await getSessionUser();
  if (!user) return;
  if (isDemoMode()) {
    const store = await cookies();
    const vistas = new Set(parseVistas(store.get(NOVIDADES_COOKIE)?.value));
    vistas.add(versao);
    store.set(NOVIDADES_COOKIE, [...vistas].join(","), { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
    return;
  }
  await marcarVersaoVista({ db: await getDb(), user }, versao);
}

/** Formulário público "Garantir minha vaga" (página /site). */
export async function registrarLeadAction(_: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { created } = await registrarLead(await getDb(), { email: formData.get("email") });
    return {
      ok: true,
      message: created
        ? "Vaga pré-reservada! Em até 1 dia útil a equipe ASTRAEUS entra em contato para agendar a conversa."
        : "Este e-mail já está na lista da turma 2027. Logo entraremos em contato.",
      ts: Date.now(),
    };
  } catch (error) {
    return { ok: false, message: toUserMessage(error), ts: Date.now() };
  }
}
