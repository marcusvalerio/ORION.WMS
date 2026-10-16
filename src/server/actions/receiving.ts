"use server";

import { dropBlankRows, type ActionState } from "@/lib/action-state";
import { runAction } from "./run";
import * as receiving from "../services/receiving";
import { resolveDivergence } from "../services/divergences";

export async function createReceiptFromPoAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await receiving.createReceiptFromPurchaseOrder(ctx, data, { idempotencyKey: key });
    return { message: `Recebimento ${r.code} criado.`, redirectTo: `/recebimentos/${r.id}` };
  });
}

export async function createManualReceiptAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    dropBlankRows(data, "items", "productId");
    const r = await receiving.createManualReceipt(ctx, data, { idempotencyKey: key });
    return { message: `Recebimento ${r.code} criado.`, redirectTo: `/recebimentos/${r.id}` };
  });
}

export async function startCheckAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id, key }) => {
    await receiving.startCheck(ctx, id, { idempotencyKey: key });
    return "Chegada registrada e conferência iniciada.";
  });
}

/** Salva a contagem; com o botão "finalizar", conclui a conferência em seguida. */
export async function saveCountsAction(_: ActionState, fd: FormData) {
  const finish = fd.get("finish") === "1";
  return runAction(fd, async ({ ctx, data, id, key }) => {
    delete data.finish;
    await receiving.saveCounts(ctx, id, data, { idempotencyKey: key });
    if (!finish) return "Contagem salva.";
    const r = await receiving.finishCheck(ctx, id, { notes: data.checkNotes }, { idempotencyKey: key ? `${key}:finish` : undefined });
    return r.divergences
      ? `Conferência finalizada com ${r.divergences} divergência(s) registrada(s).`
      : "Conferência finalizada sem divergências.";
  });
}

export async function finishCheckAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await receiving.finishCheck(ctx, id, data, { idempotencyKey: key });
    return r.divergences
      ? `Conferência finalizada com ${r.divergences} divergência(s) registrada(s).`
      : "Conferência finalizada sem divergências.";
  });
}

export async function releaseReceiptAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id, key }) => {
    const r = await receiving.releaseReceipt(ctx, id, { idempotencyKey: key });
    return r.tasks.length ? `Itens liberados. Tarefas geradas: ${r.tasks.join(", ")}.` : "Nenhum item elegível; recebimento encerrado.";
  });
}

export async function addReceiptDivergenceAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    await receiving.addReceiptDivergence(ctx, id, data, { idempotencyKey: key });
    return "Divergência registrada.";
  });
}

export async function releaseQualityHoldAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await receiving.releaseQualityHold(ctx, id, data, { idempotencyKey: key });
    return `Quantidade liberada. Tarefa(s): ${r.tasks.join(", ")}.`;
  });
}

export async function cancelReceiptAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await receiving.cancelReceipt(ctx, id, data);
    return "Recebimento cancelado.";
  });
}

export async function resolveDivergenceAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await resolveDivergence(ctx, id, data);
    return "Tratamento registrado.";
  });
}
