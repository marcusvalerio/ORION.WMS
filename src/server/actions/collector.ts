"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import type { Ctx } from "../context";
import { requireCtx } from "../auth/session";
import { toUserMessage } from "../errors";
import * as collector from "../services/collector";

/**
 * Server Actions do coletor. São chamadas diretamente pelos componentes de leitura
 * (sem FormData): cada leitura do scanner devolve dados + mensagem para o feedback.
 * Mesma política de runAction: sessão obrigatória, permissão e regra no serviço,
 * erros convertidos em mensagem segura.
 */
export type CollectorResult<T> = { ok: true; message: string; data: T } | { ok: false; message: string; code?: string };

async function run<T>(
  fn: (ctx: Ctx) => Promise<{ data: T; message: string }>,
  mutates = false,
): Promise<CollectorResult<T>> {
  try {
    const ctx = await requireCtx();
    const r = await fn(ctx);
    if (mutates) revalidatePath("/", "layout");
    return { ok: true, message: r.message, data: r.data };
  } catch (error) {
    unstable_rethrow(error);
    if (!(error instanceof Error && "code" in error)) console.error("[coletor]", error);
    const code = (error as { code?: unknown })?.code;
    return { ok: false, message: toUserMessage(error), code: typeof code === "string" ? code : undefined };
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function claimTaskAction(taskId: string, key?: string) {
  return run(async (ctx) => {
    const r = await collector.claimTask(ctx, str(taskId), { idempotencyKey: key });
    return { data: r, message: `Tarefa ${r.code} com você.` };
  }, true);
}

export async function checkDestinationAction(taskId: string, code: string) {
  return run(async (ctx) => {
    const r = await collector.checkDestination(ctx, str(taskId), str(code));
    return { data: { code: r.location.code, expected: r.expected }, message: r.message };
  });
}

export async function checkOriginAction(taskId: string, code: string) {
  return run(async (ctx) => {
    const r = await collector.checkOrigin(ctx, str(taskId), str(code));
    return { data: { code: r.location.code }, message: r.message };
  });
}

export async function checkProductAction(taskId: string, code: string) {
  return run(async (ctx) => {
    const p = await collector.checkTaskProduct(ctx, str(taskId), str(code));
    return { data: { sku: p.sku, description: p.description, code: str(code).trim() }, message: `Produto ${p.sku} confirmado.` };
  });
}

export async function completeFromCollectorAction(
  taskId: string,
  input: { originCode?: string; locationCode?: string; productCode: string; quantity: string | number; notes?: string },
  key: string,
) {
  return run(async (ctx) => {
    const r = await collector.completeFromCollector(ctx, str(taskId), input, { idempotencyKey: key });
    const msg =
      r.shortfall > 0
        ? `Tarefa ${r.code} concluída com ${r.confirmed} un. Falta de ${r.shortfall} un registrada como divergência.`
        : `Tarefa ${r.code} concluída (${r.confirmed} un).`;
    return { data: r, message: msg };
  }, true);
}

export async function resolveProductAction(code: string) {
  return run(async (ctx) => {
    const p = await collector.resolveProductCode(ctx, str(code));
    return { data: p, message: `${p.sku} — ${p.description}` };
  });
}

export async function inventoryLocationAction(inventoryId: string, code: string) {
  return run(async (ctx) => {
    const r = await collector.inventoryLocation(ctx, str(inventoryId), str(code));
    return { data: { code: r.location.code, items: r.items }, message: `Endereço ${r.location.code}: ${r.items.length} item(ns) previsto(s).` };
  });
}

export async function countFromCollectorAction(
  inventoryId: string,
  input: { locationCode: string; productCode: string; lotCode?: string | null; quantity: string | number },
  key: string,
) {
  return run(async (ctx) => {
    const r = await collector.countFromCollector(ctx, str(inventoryId), input, { idempotencyKey: key });
    return {
      data: r,
      message: r.added
        ? `${r.sku} não estava previsto em ${r.location}: incluído com a contagem.`
        : `Contagem de ${r.sku}${r.lotCode ? ` (lote ${r.lotCode})` : ""} registrada.`,
    };
  }, true);
}

export async function lookupAction(code: string) {
  return run(async (ctx) => {
    const r = await collector.lookupCode(ctx, str(code));
    const message =
      r.kind === "location"
        ? `Endereço ${r.location.code}: ${r.balances.length} saldo(s).`
        : `${r.product.sku}: ${r.total} ${r.product.uom} em ${r.balances.length} endereço(s).`;
    return { data: r, message };
  });
}
