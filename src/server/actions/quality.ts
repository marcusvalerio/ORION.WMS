"use server";

import type { ActionState } from "@/lib/action-state";
import { runAction } from "./run";
import * as quality from "../services/quality";
import * as traceability from "../services/traceability";

const LABEL = { approved: "aprovada", rejected: "reprovada", rework: "enviada para retrabalho" } as const;

export async function decideQualityHoldAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    const r = await quality.decideQualityHold(ctx, id, data, { idempotencyKey: key });
    return `Retenção ${r.code} ${LABEL[r.status]}.${r.tasks.length ? ` Armazenagem: ${r.tasks.join(", ")}.` : ""}`;
  });
}

export async function startRecallAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await traceability.startRecall(ctx, data, { idempotencyKey: key });
    return `Recall ${r.code} iniciado: ${r.blocked} un bloqueadas em ${r.lots} lote(s); ${r.customers.length} cliente(s) a avisar.`;
  });
}
