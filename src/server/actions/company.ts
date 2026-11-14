"use server";

import type { ActionState } from "@/lib/action-state";
import { runAction } from "./run";
import * as company from "../services/company";

export async function updateCompanyAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await company.updateCompanyProfile(ctx, data, { idempotencyKey: key });
    return r.changed ? `Dados da empresa atualizados (${r.changed} campo(s)).` : "Nenhuma alteração para salvar.";
  });
}

export async function linkAtlasCompanyAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await company.linkAtlasCompany(ctx, data.externalId, undefined, { idempotencyKey: key });
    return {
      message: `Empresa vinculada ao ATLAS.ERP (${r.changed} campo(s) atualizados).${r.warnings.length ? ` Avisos: ${r.warnings.join(" ")}` : ""}`,
      redirectTo: "/empresa",
    };
  });
}

export async function syncCompanyAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await company.syncCompany(ctx, { expected: typeof data.expected === "string" ? data.expected : null }, undefined, {
      idempotencyKey: key,
    });
    return {
      message: r.changed ? `Sincronizado: ${r.changed} campo(s) atualizados a partir do ATLAS.ERP.` : "Sincronizado: nenhum campo mudou.",
      redirectTo: "/empresa",
    };
  });
}

export async function unlinkAtlasCompanyAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, key }) => {
    await company.unlinkAtlasCompany(ctx, { idempotencyKey: key });
    return "Vínculo com o ATLAS.ERP removido. Os dados passam a ser editados no WMS.";
  });
}
