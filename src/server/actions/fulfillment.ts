"use server";

import type { ActionState } from "@/lib/action-state";
import { runAction } from "./run";
import * as waves from "../services/waves";
import * as repl from "../services/replenishment";
import * as slotting from "../services/slotting";
import * as outbound from "../services/outbound";

// ---------------------------------------------------------------- Ondas

export async function createWaveAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await waves.createWave(ctx, data, { idempotencyKey: key });
    return { message: `Onda ${r.code} criada com ${r.orders} pedido(s).`, redirectTo: `/ondas/${r.id}` };
  });
}

export async function addOrderToWaveAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    await waves.addOrderToWave(ctx, id, data, { idempotencyKey: key });
    return "Pedido incluído na onda.";
  });
}

export async function removeOrderFromWaveAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    await waves.removeOrderFromWave(ctx, id, data, { idempotencyKey: key });
    return "Pedido retirado da onda.";
  });
}

export async function releaseWaveAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id, key }) => {
    const r = await waves.releaseWave(ctx, id, { idempotencyKey: key });
    return `Onda liberada: ${r.tasks.length} tarefa(s) consolidada(s) em sequência de roteiro.`;
  });
}

export async function cancelWaveAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await waves.cancelWave(ctx, id, data);
    return "Onda cancelada. Os pedidos voltaram a Reservado.";
  });
}

export async function distributeWaveOrderAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await waves.distributeWaveOrder(ctx, id, data, { idempotencyKey: key });
    return `Pedido ${r.order} distribuído: pronto para a conferência.`;
  });
}

// ---------------------------------------------------------------- Reposição

export async function saveReplenishmentSettingAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    await repl.saveReplenishmentSetting(ctx, data, { idempotencyKey: key });
    return "Configuração de reposição salva.";
  });
}

export async function runReplenishmentCheckAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await repl.runReplenishmentCheck(ctx, data, { idempotencyKey: key });
    return r.tasks.length ? `Reposição gerada: ${r.tasks.join(", ")}.` : "Nenhum endereço de picking precisa de reposição agora.";
  });
}

// ---------------------------------------------------------------- Curva ABC / slotting

export async function saveSlottingSettingsAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    await slotting.saveSlottingSettings(ctx, data, { idempotencyKey: key });
    return "Parâmetros da curva ABC salvos.";
  });
}

export async function createSlottingTransferAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await slotting.createSlottingTransfer(ctx, data, { idempotencyKey: key });
    return `Transferência ${r.code} gerada a partir da sugestão.`;
  });
}

// ---------------------------------------------------------------- Pedido de saída (complementos)

export async function setOrderPlanningAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    await outbound.setOrderPlanning(ctx, id, data, { idempotencyKey: key });
    return "Planejamento de saída salvo.";
  });
}

export async function cancelOrderLineAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await outbound.cancelOrderLine(ctx, id, data, { idempotencyKey: key });
    const ret = r.returns.length ? ` Devolução ao endereço: ${r.returns.join(", ")}.` : "";
    return `${r.orderCancelled ? "Linha cancelada e pedido cancelado (sem linhas restantes)." : "Linha cancelada."}${ret}`;
  });
}
