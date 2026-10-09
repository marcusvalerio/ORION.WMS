"use server";

import type { ActionState } from "@/lib/action-state";
import { runAction } from "./run";
import * as tasks from "../services/tasks";

export async function startTaskAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id, key }) => {
    await tasks.startTask(ctx, id, { idempotencyKey: key });
    return "Tarefa iniciada.";
  });
}

export async function completeTaskAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await tasks.completeTask(ctx, id, data, { idempotencyKey: key });
    return `Tarefa concluída (${r.confirmed} un confirmadas).`;
  });
}

export async function assignTaskAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await tasks.updateTaskAssignment(ctx, id, data);
    return "Atribuição atualizada.";
  });
}

export async function cancelTaskAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await tasks.cancelTask(ctx, id, data);
    return "Tarefa cancelada.";
  });
}

export async function createTransferAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await tasks.createTransfer(ctx, data, { idempotencyKey: key });
    return { message: `Transferência ${r.code} registrada.`, redirectTo: `/tarefas/${r.id}` };
  });
}
