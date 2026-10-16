import "server-only";
import { z } from "zod";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError, NotFoundError } from "../errors";
import { parse } from "../validation";
import { audit, runOperation } from "./common";

export interface DivergenceRow {
  id: string;
  source: string;
  divergence_type: string;
  sku: string | null;
  quantity: number | null;
  description: string;
  status: string;
  resolution: string | null;
  receipt_id: string | null;
  receipt_code: string | null;
  order_id: string | null;
  order_code: string | null;
  inventory_id: string | null;
  inventory_code: string | null;
  task_code: string | null;
  created_by_name: string;
  created_at: string;
  resolved_by_name: string | null;
  resolved_at: string | null;
}

export async function listDivergences(ctx: Ctx, f: { status?: string | null; source?: string | null; receiptId?: string | null; orderId?: string | null } = {}) {
  return ctx.db.query<DivergenceRow>(
    `select d.id, d.source, d.divergence_type, p.sku, d.quantity, d.description, d.status, d.resolution,
            d.receipt_id, r.code as receipt_code, d.order_id, o.code as order_code, d.inventory_id, i.code as inventory_code,
            t.code as task_code, u.name as created_by_name, d.created_at::text as created_at, ur.name as resolved_by_name,
            d.resolved_at::text as resolved_at
     from wms.divergences d join wms.users u on u.id = d.created_by
     left join erp.products p on p.id = d.product_id left join wms.receipts r on r.id = d.receipt_id
     left join wms.outbound_orders o on o.id = d.order_id left join wms.inventory_counts i on i.id = d.inventory_id
     left join wms.tasks t on t.id = d.task_id left join wms.users ur on ur.id = d.resolved_by
     where d.company_id = $1 and ($2::text is null or d.status = $2) and ($3::text is null or d.source = $3)
       and ($4::uuid is null or d.receipt_id = $4::uuid) and ($5::uuid is null or d.order_id = $5::uuid)
     order by d.status = 'open' desc, d.created_at desc`,
    [ctx.user.companyId, f.status || null, f.source || null, f.receiptId || null, f.orderId || null],
  );
}

const resolveSchema = z.object({
  resolution: z.string().trim().min(10, "Descreva o tratamento (mínimo 10 caracteres).").max(2000),
});

/** Registra o tratamento de uma divergência. O registro original nunca é apagado. */
export async function resolveDivergence(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx, "divergence.resolve");
  const d = parse(resolveSchema, input);
  return runOperation(ctx, "divergence.resolve", undefined, async (tx) => {
    const [row] = await tx.query<{ status: string; source: string }>(
      `select status, source from wms.divergences where id = $1 and company_id = $2 for update`,
      [id, ctx.user.companyId],
    );
    if (!row) throw new NotFoundError("Divergência");
    if (row.status !== "open") throw new DomainError("Divergência já tratada.");
    if (row.source === "inventory") throw new DomainError("Divergências de inventário são tratadas pela aprovação do inventário.");
    await tx.query(
      `update wms.divergences set status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now() where id = $1`,
      [id, d.resolution, ctx.user.id],
    );
    await audit(tx, ctx, "divergence.resolved", "divergence", id, null, d);
    return { id };
  });
}
