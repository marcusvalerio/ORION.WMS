import "server-only";
import type { Ctx } from "./context";
import { PermissionError } from "./errors";

/**
 * Acesso por depósito (wms.user_warehouses). Usuário sem linhas acessa todos os
 * depósitos da empresa; com linhas, só os listados. A regra vale para consultas
 * (filtro SQL) e operações (validação sob lock do documento).
 */
export function allowedWarehouses(ctx: Ctx): string[] | null {
  const ids = ctx.user.warehouseIds;
  return ids && ids.length ? ids : null;
}

export function hasWarehouseAccess(ctx: Ctx, warehouseId: string): boolean {
  const ids = allowedWarehouses(ctx);
  return !ids || ids.includes(warehouseId);
}

export function assertWarehouseAccess(ctx: Ctx, warehouseId: string): void {
  if (!hasWarehouseAccess(ctx, warehouseId)) {
    throw new PermissionError("Você não tem acesso a este depósito. Solicite ao administrador a liberação.");
  }
}

/**
 * Trecho SQL ` and <coluna> = any($n::uuid[])` para restringir uma consulta aos
 * depósitos do usuário; acrescenta o parâmetro em `params`. Vazio sem restrição.
 */
export function warehouseScope(ctx: Ctx, column: string, params: unknown[]): string {
  const ids = allowedWarehouses(ctx);
  if (!ids) return "";
  params.push(ids);
  return ` and ${column} = any($${params.length}::uuid[])`;
}
