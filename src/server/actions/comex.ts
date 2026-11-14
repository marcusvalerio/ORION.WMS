"use server";

import { dropBlankRows, type ActionState } from "@/lib/action-state";
import { runAction } from "./run";
import * as comex from "../services/comex";
import * as production from "../services/production";

// -----------------------------------------------------------------------------
// Comércio exterior
// -----------------------------------------------------------------------------

export async function saveReceiptImportAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await comex.saveReceiptImport(ctx, id, data, { idempotencyKey: key });
    return r.customsStatus === "awaiting"
      ? "Dados de importação salvos. Recebimento retido até o registro do desembaraço."
      : "Dados de importação salvos.";
  });
}

export async function clearCustomsAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    await comex.clearCustoms(ctx, id, data, { idempotencyKey: key });
    return "Desembaraço registrado. O recebimento pode ser liberado para armazenagem.";
  });
}

export async function saveOrderExportAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    await comex.saveOrderExport(ctx, id, data, { idempotencyKey: key });
    return "Dados de exportação salvos.";
  });
}

export async function addExportPackageAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    dropBlankRows(data, "items", "quantity");
    const r = await comex.addExportPackage(ctx, id, data, { idempotencyKey: key });
    return `Volume ${r.packageNo} incluído no packing list.`;
  });
}

export async function removeExportPackageAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id, key }) => {
    await comex.removeExportPackage(ctx, id, { idempotencyKey: key });
    return "Volume removido.";
  });
}

export async function finishPackingAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id, key }) => {
    const r = await comex.finishPacking(ctx, id, { idempotencyKey: key });
    return `Packing list fechado: ${r.totals.packages} volume(s), ${r.totals.grossWeightKg} kg brutos.`;
  });
}

export async function stuffContainerAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    await comex.stuffContainer(ctx, id, data, { idempotencyKey: key });
    return "Estufagem registrada.";
  });
}

// -----------------------------------------------------------------------------
// Produção
// -----------------------------------------------------------------------------

export async function createRequisitionAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await production.createRequisition(ctx, data, { idempotencyKey: key });
    return { message: `Requisição ${r.code} criada.`, redirectTo: `/producao/${r.id}` };
  });
}

export async function reserveRequisitionAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id, key }) => {
    const r = await production.reserveRequisition(ctx, id, { idempotencyKey: key });
    return r.shortages.length
      ? `${r.reservations} reserva(s) criada(s). Pendências: ${r.shortages.join("; ")}.`
      : `${r.reservations} reserva(s) criada(s) — todos os componentes reservados.`;
  });
}

export async function releaseRequisitionAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id, key }) => {
    const r = await production.releaseRequisition(ctx, id, { idempotencyKey: key });
    return `Tarefas de separação geradas: ${r.tasks.join(", ")}.`;
  });
}

export async function deliverToLineAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await production.deliverToLine(ctx, id, data, { idempotencyKey: key });
    return `Entrega ${r.delivery} confirmada na linha.`;
  });
}

export async function returnLeftoversAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await production.returnLeftovers(ctx, id, data, { idempotencyKey: key });
    return `Sobra devolvida ao endereço ${r.location}.`;
  });
}

export async function receiveOutputAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await production.receiveOutput(ctx, id, data, { idempotencyKey: key });
    return `Produto acabado (lote ${r.lot}) registrado. Tarefa(s) de armazenagem: ${r.tasks.join(", ")}.`;
  });
}

export async function completeRequisitionAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id, key }) => {
    await production.completeRequisition(ctx, id, { idempotencyKey: key });
    return "Requisição encerrada.";
  });
}

export async function cancelRequisitionAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    await production.cancelRequisition(ctx, id, data, { idempotencyKey: key });
    return "Requisição cancelada e reservas liberadas.";
  });
}
