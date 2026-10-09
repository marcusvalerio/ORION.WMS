import type { Db } from "./db/types";
import type { Role, Permission } from "@/lib/permissions";
import { can } from "@/lib/permissions";
import { PermissionError } from "./errors";

export interface SessionUser {
  id: string;
  companyId: string;
  companyName: string;
  companyIsDemo: boolean;
  name: string;
  email: string;
  role: Role;
}

/** Contexto de execução de todo serviço: conexão + usuário autenticado. */
export interface Ctx {
  db: Db;
  user: SessionUser;
}

export function assertCan(ctx: Ctx, permission: Permission): void {
  if (!can(ctx.user.role, permission)) throw new PermissionError();
}
