"use server";

import type { ActionState } from "@/lib/action-state";
import { runAction } from "./run";
import * as integration from "../services/integration";

export async function processQueueAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx }) => {
    const r = await integration.processQueue(ctx);
    if (!r.claimed) return "Nenhum evento elegível na fila agora.";
    const parts = [`${r.sent} enviado(s)`];
    if (r.retrying) parts.push(`${r.retrying} reagendado(s) para nova tentativa`);
    if (r.failed) parts.push(`${r.failed} com falha definitiva`);
    return { message: `Fila processada: ${parts.join(", ")}.`, ok: r.retrying + r.failed === 0 };
  });
}

export async function retryEventAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id, key }) => {
    await integration.retryOutboxEvent(ctx, id, { idempotencyKey: key });
    return "Evento devolvido à fila para reenvio.";
  });
}

export async function discardEventAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id, data, key }) => {
    await integration.discardOutboxEvent(ctx, id, data, { idempotencyKey: key });
    return "Evento descartado.";
  });
}
