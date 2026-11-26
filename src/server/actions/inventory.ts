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
    if (r.stale) return `Saldo alterado durante a contagem: ${r.stale} item(ns) voltaram para recontagem.`;
    return `Inventário aprovado. ${r.adjustments} ajuste(s) aplicado(s).`;
  });
}

export async function cancelInventoryAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await inventory.cancelInventory(ctx, id, data);
    return "Inventário cancelado.";
  });
}

export async function returnItemsForRecountAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await inventory.returnItemsForRecount(ctx, id, { itemIds: [], ...data }, { idempotencyKey: key });
    return `${r.items} item(ns) devolvido(s) para recontagem.`;
  });
}

export async function generateCycleCountsAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await inventory.generateCycleCounts(ctx, data, { idempotencyKey: key });
    if (!r.id) return "Nenhum endereço vence hoje.";
    return { message: r.created ? `Inventário ${r.code} gerado com ${r.locations} endereço(s).` : `As contagens de hoje já foram geradas (${r.code}).`, redirectTo: `/inventario/${r.id}` };
  });
}

export async function saveInventoryConfigAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    await inventory.saveInventoryConfig(ctx, data, { idempotencyKey: key });
    return "Parâmetros do inventário salvos.";
  });
}
