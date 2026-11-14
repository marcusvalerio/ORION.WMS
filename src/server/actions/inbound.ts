"use server";

import type { ActionState } from "@/lib/action-state";
import { DomainError } from "../errors";
import { runAction } from "./run";
import * as nfe from "../services/nfe";
import * as docks from "../services/docks";
import * as returns from "../services/returns";
import { MAX_NFE_BYTES } from "../integrations/nfe/parser";
import { createReceiptFromPurchaseOrder } from "../services/receiving";

// ----------------------------- NF-e -----------------------------

export async function importNfeAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, key }) => {
    const file = fd.get("xmlFile");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("Selecione o arquivo XML da NF-e.", "VALIDATION");
    if (file.size > MAX_NFE_BYTES) throw new DomainError(`Arquivo XML acima do limite de ${MAX_NFE_BYTES / 1024} KB.`, "NFE_TOO_LARGE");
    const xml = await file.text();
    const r = await nfe.importNfe(ctx, { xml }, { idempotencyKey: key });
    return { message: r.duplicate ? "Esta NF-e já estava importada e pendente." : "NF-e importada.", redirectTo: `/recebimentos/nfe/${r.id}` };
  });
}

export async function linkNfeSupplierAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await nfe.linkNfeSupplier(ctx, id, data);
    return "Emitente vinculado ao fornecedor; CNPJ registrado.";
  });
}

export async function linkNfeItemAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await nfe.linkNfeItem(ctx, id, data);
    return "Vínculo confirmado e salvo para as próximas notas deste fornecedor.";
  });
}

export async function setNfePurchaseOrderAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await nfe.setNfePurchaseOrder(ctx, id, data);
    return "Pedido de compra atualizado.";
  });
}

export async function createReceiptFromNfeAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await nfe.createReceiptFromNfe(ctx, id, data, { idempotencyKey: key });
    return { message: `Recebimento ${r.code} criado a partir da NF-e.`, redirectTo: `/recebimentos/${r.id}` };
  });
}

export async function discardNfeAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id }) => {
    await nfe.discardNfe(ctx, id);
    return { message: "NF-e descartada.", redirectTo: "/recebimentos/novo" };
  });
}

// ----------------------------- Docas -----------------------------

export async function createDockAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    await docks.createDock(ctx, data, { idempotencyKey: key });
    return "Doca cadastrada.";
  });
}

export async function toggleDockAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await docks.setDockActive(ctx, id, data.active === "true");
    return data.active === "true" ? "Doca ativada." : "Doca desativada.";
  });
}

export async function createAppointmentAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await docks.createAppointment(ctx, data, { idempotencyKey: key });
    return `Agendamento ${r.code} criado.`;
  });
}

export async function changeAppointmentStatusAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await docks.changeAppointmentStatus(ctx, id, data);
    return "Agendamento atualizado.";
  });
}

export async function receiptFromAppointmentAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await createReceiptFromPurchaseOrder(ctx, { ...data, appointmentId: id }, { idempotencyKey: key });
    return { message: `Recebimento ${r.code} criado a partir do agendamento.`, redirectTo: `/recebimentos/${r.id}` };
  });
}

// ----------------------------- Devoluções -----------------------------

export async function createReturnAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await returns.createReturn(ctx, data, { idempotencyKey: key });
    return { message: `Devolução ${r.code} registrada.`, redirectTo: `/devolucoes/${r.id}` };
  });
}

export async function inspectReturnItemAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await returns.inspectReturnItem(ctx, id, data, { idempotencyKey: key });
    const t = r.tasks.length ? ` Tarefa(s) de armazenagem: ${r.tasks.join(", ")}.` : "";
    return `${r.completed ? "Inspeção concluída; ERP notificado pela fila de integração." : "Item inspecionado."}${t}`;
  });
}

export async function cancelReturnAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await returns.cancelReturn(ctx, id, data);
    return "Devolução cancelada.";
  });
}
