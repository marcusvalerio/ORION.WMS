import "server-only";
import type { Ctx } from "../context";
import { assertCan } from "../context";

export interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_code: string | null;
  details: Record<string, unknown>;
  user_name: string | null;
  user_role: string | null;
  created_at: string;
}

export async function listAudit(
  ctx: Ctx,
  f: { entityType?: string | null; entityId?: string | null; q?: string | null; page?: number; pageSize?: number } = {},
) {
  assertCan(ctx, "audit.view");
  const pageSize = f.pageSize ?? 50;
  const page = Math.max(1, f.page ?? 1);
  const params = [ctx.user.companyId, f.entityType || null, f.entityId || null, f.q || null];
  const where = `where a.company_id = $1 and ($2::text is null or a.entity_type = $2) and ($3::uuid is null or a.entity_id = $3::uuid)
    and ($4::text is null or a.action ilike '%' || $4 || '%' or a.entity_code ilike '%' || $4 || '%' or u.name ilike '%' || $4 || '%')`;
  const [count] = await ctx.db.query<{ total: number }>(
    `select count(*) as total from wms.audit_log a left join wms.users u on u.id = a.user_id ${where}`,
    params,
  );
  const rows = await ctx.db.query<AuditRow>(
    `select a.id, a.action, a.entity_type, a.entity_id, a.entity_code, a.details, u.name as user_name, u.role as user_role,
            a.created_at::text as created_at
     from wms.audit_log a left join wms.users u on u.id = a.user_id ${where}
     order by a.created_at desc, a.id limit ${pageSize} offset ${(page - 1) * pageSize}`,
    params,
  );
  return { rows, total: count.total, page, pageSize };
}

/** Histórico de um registro específico (visível a todos os perfis com acesso ao registro). */
export async function entityHistory(ctx: Ctx, entityType: string, entityId: string) {
  return ctx.db.query<AuditRow>(
    `select a.id, a.action, a.entity_type, a.entity_id, a.entity_code, a.details, u.name as user_name, u.role as user_role,
            a.created_at::text as created_at
     from wms.audit_log a left join wms.users u on u.id = a.user_id
     where a.company_id = $1 and a.entity_type = $2 and a.entity_id = $3 order by a.created_at, a.id`,
    [ctx.user.companyId, entityType, entityId],
  );
}

export async function listIntegrationEvents(ctx: Ctx) {
  assertCan(ctx, "audit.view");
  return ctx.db.query<{
    id: string;
    event_type: string;
    aggregate_type: string;
    status: string;
    attempts: number;
    payload: Record<string, unknown>;
    created_at: string;
  }>(
    `select id, event_type, aggregate_type, status, attempts, payload, created_at::text as created_at
     from wms.integration_events where company_id = $1 order by created_at desc limit 100`,
    [ctx.user.companyId],
  );
}
