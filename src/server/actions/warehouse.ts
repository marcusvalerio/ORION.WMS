"use server";

import type { ActionState } from "@/lib/action-state";
import { runAction } from "./run";
import * as wh from "../services/warehouse";
import * as products from "../services/products";

export async function createWarehouseAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    await wh.createWarehouse(ctx, data, { idempotencyKey: key });
    return "Depósito cadastrado.";
  });
}

export async function updateWarehouseAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await wh.updateWarehouse(ctx, id, data);
    return "Depósito atualizado.";
  });
}

export async function toggleWarehouseAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id, data }) => {
    const active = data.active === "true";
    await wh.setWarehouseActive(ctx, id, active);
    return active ? "Depósito ativado." : "Depósito desativado.";
  });
}

export async function createZoneAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    await wh.createZone(ctx, data, { idempotencyKey: key });
    return "Zona cadastrada.";
  });
}

export async function toggleZoneAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id, data }) => {
    const active = data.active === "true";
    await wh.setZoneActive(ctx, id, active);
    return active ? "Zona ativada." : "Zona desativada.";
  });
}

export async function createLocationAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await wh.createLocation(ctx, data, { idempotencyKey: key });
    return `Endereço ${r.code} cadastrado.`;
  });
}

export async function generateLocationsAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, key }) => {
    const r = await wh.generateLocations(ctx, data, { idempotencyKey: key });
    return `${r.created} endereço(s) criado(s)${r.skipped ? `, ${r.skipped} já existente(s) ignorado(s)` : ""}.`;
  });
}

export async function updateLocationAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await wh.updateLocation(ctx, id, data);
    return "Endereço atualizado.";
  });
}

export async function setLocationStatusAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await wh.setLocationStatus(ctx, id, data);
    return "Status do endereço atualizado.";
  });
}

export async function deleteLocationAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, id }) => {
    await wh.deleteLocation(ctx, id);
    return { message: "Endereço excluído.", redirectTo: "/armazem/enderecos" };
  });
}

export async function updateProductSettingsAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await products.updateProductSettings(ctx, id, data);
    return "Parâmetros logísticos salvos.";
  });
}

export async function addPackagingAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id, key }) => {
    await products.addPackaging(ctx, id, data, { idempotencyKey: key });
    return "Unidade logística cadastrada.";
  });
}

export async function togglePackagingAction(_: ActionState, fd: FormData) {
  return runAction(fd, async ({ ctx, data, id }) => {
    await products.setPackagingActive(ctx, id, data.active === "true");
    return "Unidade logística atualizada.";
  });
}
