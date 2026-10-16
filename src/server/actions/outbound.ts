"use server";

import { dropBlankRows, type ActionState } from "@/lib/action-state";
import { runAction } from "./run";
import * as outbound from "../services/outbound";

export async function importSalesOrderAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await outbound.importSalesOrder(ctx, data, { idempotencyKey: key });
    return { message: `Pedido ${r.code} importado.`, redirectTo: `/separacao/${r.id}` };
  });
}

export async function createOutboundAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    dropBlankRows(data, "lines", "productId");
    const r = await outbound.createManualOrder(ctx, data, { idempotencyKey: key });
    return { message: `Pedido ${r.code} criado.`, redirectTo: `/separacao/${r.id}` };
  });
}

export async function reserveOrderAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id, key }) => {
    const r = await outbound.reserveOrder(ctx, id, { idempotencyKey: key });
    return `Estoque reservado (${r.reservations} reserva(s)). Nenhuma baixa física foi feita.`;
  });
}

export async function releasePickingAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id, key }) => {
    const r = await outbound.releaseForPicking(ctx, id, { idempotencyKey: key });
    return `Separação liberada. Tarefas: ${r.tasks.join(", ")}.`;
  });
}

export async function checkOrderAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await outbound.checkOrder(ctx, id, data, { idempotencyKey: key });
    if (!r.ok) return { ok: false, message: `Divergência registrada: ${r.mismatches.join("; ")}. Reconfira antes de expedir.` };
    return "Conferência aprovada. Pedido pronto para expedição.";
  });
}

export async function shipOrderAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await outbound.shipOrder(ctx, id, data, { idempotencyKey: key });
    return `Expedição ${r.shipment} confirmada (${r.total} un).`;
  });
}

export async function cancelOrderAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await outbound.cancelOrder(ctx, id, data);
    return "Pedido cancelado e reservas liberadas.";
  });
}
