"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { formToObject } from "@/lib/action-state";
import { runAction } from "./run";
import { requireCtx } from "../auth/session";
import { toUserMessage } from "../errors";
import * as users from "../services/users";
import { updateSettings } from "../services/settings";

export async function createUserAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await users.createUser(ctx, data, { idempotencyKey: key });
    return { message: "Usuário criado. A troca de senha será exigida no primeiro acesso.", redirectTo: `/usuarios/${r.id}` };
  });
}

export async function updateUserAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    await users.updateUser(ctx, id, data, { idempotencyKey: key });
    return "Dados do usuário atualizados.";
  });
}

export async function setUserActiveAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const active = data.active === "true";
    await users.setUserActive(ctx, id, active, { idempotencyKey: key });
    return active ? "Usuário ativado." : "Usuário inativado. O acesso foi bloqueado imediatamente.";
  });
}

export async function setUserWarehousesAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await users.setUserWarehouses(ctx, id, data, { idempotencyKey: key });
    return r.warehouses ? `Acesso restrito a ${r.warehouses} depósito(s).` : "Acesso liberado a todos os depósitos.";
  });
}

export interface ResetPasswordState extends ActionState {
  temporaryPassword?: string;
}

/** Devolve a senha temporária só nesta resposta (não é gravada em claro em lugar nenhum). */
export async function resetPasswordAction(_: ResetPasswordState, fd: FormData): Promise<ResetPasswordState> {
  let temporaryPassword: string | undefined;
  const state = await runAction(fd, async ({ ctx, id }) => {
    const r = await users.resetUserPassword(ctx, id);
    temporaryPassword = r.temporaryPassword;
    return "Senha redefinida. Informe a senha temporária ao usuário: ela será exibida só agora.";
  });
  return state.ok ? { ...state, temporaryPassword } : state;
}

export async function saveSettingsAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await updateSettings(ctx, data, { idempotencyKey: key });
    return r.changed ? `${r.changed} parâmetro(s) alterado(s).` : "Nenhuma alteração.";
  });
}

/**
 * Troca da própria senha. Não usa runAction porque precisa funcionar justamente
 * quando a troca é obrigatória (runAction bloqueia as demais operações).
 */
export async function changeOwnPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let ok = false;
  let result: ActionState;
  try {
    const ctx = await requireCtx();
    await users.changeOwnPassword(ctx, formToObject(fd));
    ok = true;
    result = { ok: true, message: "Senha alterada.", ts: Date.now() };
    revalidatePath("/", "layout");
  } catch (error) {
    unstable_rethrow(error);
    result = { ok: false, message: toUserMessage(error), ts: Date.now() };
  }
  if (ok) redirect("/?senha=alterada");
  return result;
}
