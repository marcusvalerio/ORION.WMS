"use server";

import type { ActionState } from "@/lib/action-state";
import { runAction } from "./run";
import * as stock from "../services/stock";

export async function adjustStockAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    await stock.adjustStock(ctx, data, { idempotencyKey: key });
    return "Ajuste registrado e auditado.";
  });
}

export async function blockStockAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    await stock.blockStock(ctx, id, data, { idempotencyKey: key });
    return "Quantidade bloqueada.";
  });
}

export async function unblockStockAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    await stock.unblockStock(ctx, id, data, { idempotencyKey: key });
    return "Quantidade desbloqueada.";
  });
}
