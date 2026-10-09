"use server";

import type { ActionState } from "@/lib/action-state";
import { runAction } from "./run";
import * as inventory from "../services/inventory";

export async function createInventoryAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await inventory.createInventory(ctx, data, { idempotencyKey: key });
    return { message: `Inventário ${r.code} aberto.`, redirectTo: `/inventario/${r.id}` };
  });
}

export async function recordCountsAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    await inventory.recordCounts(ctx, id, data, { idempotencyKey: key });
    return "Contagens salvas. O saldo só muda após a aprovação.";
  });
}

export async function addInventoryItemAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    await inventory.addInventoryItem(ctx, id, data, { idempotencyKey: key });
    return "Item incluído na contagem.";
  });
}

export async function submitInventoryAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id, key }) => {
    const r = await inventory.submitInventory(ctx, id, { idempotencyKey: key });
    return `Inventário submetido com ${r.differences} diferença(s) para aprovação.`;
  });
}

export async function approveInventoryAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await inventory.approveInventory(ctx, id, data, { idempotencyKey: key });
    return `Inventário aprovado. ${r.adjustments} ajuste(s) aplicado(s).`;
  });
}

export async function rejectInventoryAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await inventory.rejectInventory(ctx, id, data);
    return "Inventário devolvido para recontagem.";
  });
}

export async function cancelInventoryAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await inventory.cancelInventory(ctx, id, data);
    return "Inventário cancelado.";
  });
}
