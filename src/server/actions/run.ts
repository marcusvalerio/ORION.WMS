import "server-only";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import type { Ctx } from "../context";
import { requireCtx } from "../auth/session";
import { toUserMessage } from "../errors";
import { formToObject, type ActionState } from "@/lib/action-state";

export interface ActionInput {
  ctx: Ctx;
  data: Record<string, unknown>;
  /** Chave de idempotência enviada pelo formulário. */
  key: string | undefined;
  id: string;
}

type Outcome = string | { message: string; redirectTo?: string; ok?: boolean };

/**
 * Executa uma Server Action com autenticação, tratamento de erro padronizado,
 * idempotência e atualização dos dados da interface.
 */
export async function runAction(formData: FormData, fn: (input: ActionInput) => Promise<Outcome>): Promise<ActionState> {
  let redirectTo: string | undefined;
  let result: ActionState;
  try {
    const ctx = await requireCtx();
    const data = formToObject(formData);
    const key = (formData.get("_key") as string | null) || undefined;
    const id = String(formData.get("_id") ?? "");
    const outcome = await fn({ ctx, data, key, id });
    const o = typeof outcome === "string" ? { message: outcome } : outcome;
    redirectTo = o.redirectTo;
    result = { ok: o.ok ?? true, message: o.message, ts: Date.now() };
    revalidatePath("/", "layout");
  } catch (error) {
    unstable_rethrow(error);
    if (!(error instanceof Error && error.name.endsWith("Error") && "code" in error)) console.error("[action]", error);
    result = { ok: false, message: toUserMessage(error), ts: Date.now() };
  }
  if (redirectTo) redirect(redirectTo);
  return result;
}
