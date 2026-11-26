import "server-only";
import { z } from "zod";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { assertWarehouseAccess, warehouseScope } from "../access";
import { DomainError, NotFoundError } from "../errors";
import { parse, optionalText } from "../validation";
import { audit, nextCode, recordTaskEvent, round3, runOperation, type OpOptions } from "./common";
import { addStock, getProductRules, insertMovement, lockBalance, removeStock, suggestLocations } from "./stock-core";

/**
 * Qualidade (R1): o produto acabado e a devolução apta entram "aguardando qualidade",
 * com o saldo bloqueado na quarentena (ou no endereço de origem, se não houver zona de
 * quarentena). Aprovar libera o saldo e gera a armazenagem; Reprovar descarta; Retrabalhar
 * mantém bloqueado. Toda decisão registra laudo (texto e anexo opcional), usuário e data.
 */

export const HOLD_STATUSES = ["pending", "rework", "approved", "rejected"] as const;

async function quarantineLocation(tx: Queryable, companyId: string, warehouseId: string): Promise<{ id: string; code: string } | null> {
  const [l] = await tx.query<{ id: string; code: string }>(
    `select l.id, l.code from wms.locations l join wms.zones z on z.id = l.zone_id
     where l.company_id = $1 and l.warehouse_id = $2 and z.zone_type = 'quarantine' and z.active and l.status = 'active' order by l.code limit 1`,
    [companyId, warehouseId],
  );
  return l ?? null;
}

/** Gera tarefas de armazenagem com sugestão (em lotes do máximo por endereço do produto). */
export async function createPutawayTasks(
  tx: Queryable,
  ctx: Ctx,
  a: {
    warehouseId: string;
    productId: string;
    lotCode: string;
    expiryDate: string | null;
    quantity: number;
    fromLocationId: string | null;
    productionRequisitionId: string | null;
    customerReturnId: string | null;
    note: string | null;
    ref: string;
  },
): Promise<string[]> {
  const rules = await getProductRules(tx, ctx.user.companyId, a.productId);
  const chunk = rules.max_units_per_location ?? a.quantity;
  let remaining = a.quantity;
  const tasks: string[] = [];
  while (remaining > 0) {
    const q = round3(Math.min(chunk, remaining));
    remaining = round3(remaining - q);
    const s = await suggestLocations(tx, ctx, { warehouseId: a.warehouseId, productId: a.productId, lotCode: a.lotCode, quantity: q });
    const code = await nextCode(tx, ctx.user.companyId, "TAR");
    const notes = [a.note, s.best ? null : `Sem sugestão automática: ${s.reason}`].filter(Boolean).join(" — ") || null;
    const [t] = await tx.query<{ id: string }>(
      `insert into wms.tasks (company_id, warehouse_id, code, task_type, priority, product_id, lot_code, expiry_date, quantity,
                              from_location_id, suggested_location_id, production_requisition_id, customer_return_id, notes, created_by)
       values ($1,$2,$3,'putaway',2,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [
        ctx.user.companyId,
        a.warehouseId,
        code,
        a.productId,
        a.lotCode,
        a.expiryDate,
        q,
        a.fromLocationId,
        s.best?.id ?? null,
        a.productionRequisitionId,
        a.customerReturnId,
        notes,
        ctx.user.id,
      ],
    );
    await recordTaskEvent(tx, t.id, ctx.user.id, "created", null, "pending", { ref: a.ref, suggested: s.best?.code ?? null });
    tasks.push(code);
  }
  return tasks;
}

/** Cria a retenção da qualidade e coloca o saldo bloqueado na quarentena. Chamada dentro da transação do fluxo. */
export async function createQualityHold(
  tx: Queryable,
  ctx: Ctx,
  a: {
    source: "production_output" | "customer_return";
    warehouseId: string;
    productionRequisitionId: string | null;
    customerReturnId: string | null;
    referenceCode: string;
    productId: string;
    lotCode: string;
    expiryDate: string | null;
    quantity: number;
    fallbackLocationId: string | null;
  },
) {
  const loc = (await quarantineLocation(tx, ctx.user.companyId, a.warehouseId))?.id ?? a.fallbackLocationId;
  const code = await nextCode(tx, ctx.user.companyId, "QLD");
  const [h] = await tx.query<{ id: string }>(
    `insert into wms.quality_holds (company_id, warehouse_id, code, source, production_requisition_id, customer_return_id, reference_code,
                                    product_id, lot_code, expiry_date, quantity, location_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
    [
      ctx.user.companyId,
      a.warehouseId,
      code,
      a.source,
      a.productionRequisitionId,
      a.customerReturnId,
      a.referenceCode,
      a.productId,
      a.lotCode,
      a.expiryDate,
      a.quantity,
      loc,
      ctx.user.id,
    ],
  );
  if (loc) {
    await addStock(tx, ctx, {
      warehouseId: a.warehouseId,
      locationId: loc,
      productId: a.productId,
      lotCode: a.lotCode,
      expiryDate: a.expiryDate,
      quantity: a.quantity,
      blocked: a.quantity,
    });
    await insertMovement(tx, ctx, {
      warehouseId: a.warehouseId,
      movementType: a.source === "customer_return" ? "return_in" : "putaway",
      productId: a.productId,
      lotCode: a.lotCode,
      expiryDate: a.expiryDate,
      quantity: a.quantity,
      toLocationId: loc,
      reason: `Aguardando qualidade (${code})`,
      referenceType: a.source === "customer_return" ? "customer_return" : "production_requisition",
      referenceId: a.productionRequisitionId ?? a.customerReturnId,
      referenceCode: a.referenceCode,
    });
  }
  return { id: h.id, code };
}

export async function listQualityHolds(ctx: Ctx, f: { status?: string | null } = {}) {
  assertCan(ctx, "quality.release");
  const params: unknown[] = [ctx.user.companyId];
  const scope = warehouseScope(ctx, "h.warehouse_id", params);
  let where = "";
  if (f.status && (HOLD_STATUSES as readonly string[]).includes(f.status)) {
    params.push(f.status);
    where = ` and h.status = $${params.length}`;
  } else where = ` and h.status in ('pending', 'rework')`;
  return ctx.db.query<{
    id: string;
    code: string;
    source: string;
    reference_code: string;
    sku: string;
    description: string;
    uom: string;
    lot_code: string;
    expiry_date: string | null;
    quantity: number;
    location_code: string | null;
    status: string;
    report: string | null;
    created_at: string;
    decided_by_name: string | null;
    decided_at: string | null;
  }>(
    `select h.id, h.code, h.source, h.reference_code, p.sku, p.description, p.uom, h.lot_code, h.expiry_date::text as expiry_date, h.quantity,
            l.code as location_code, h.status, h.report, h.created_at::text as created_at, u.name as decided_by_name, h.decided_at::text as decided_at
     from wms.quality_holds h join erp.products p on p.id = h.product_id left join wms.locations l on l.id = h.location_id
     left join wms.users u on u.id = h.decided_by
     where h.company_id = $1${scope}${where} order by h.created_at desc limit 200`,
    params,
  );
}

const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected", "rework"], { error: "Escolha Aprovar, Reprovar ou Retrabalhar." }),
  report: z.string().trim().min(5, "Registre o laudo (mínimo de 5 caracteres).").max(4000),
  attachmentUrl: optionalText,
});

/**
 * Decide a retenção. Aprovar: desbloqueia, retira da quarentena e gera a armazenagem
 * (o saldo fica disponível na confirmação). Reprovar: descarta o saldo bloqueado.
 * Retrabalhar: mantém bloqueado para nova decisão.
 */
export async function decideQualityHold(ctx: Ctx, holdId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "quality.release");
  const d = parse(decisionSchema, input);
  return runOperation(ctx, "quality.decide", opts, async (tx) => {
    const [h] = await tx.query<{
      id: string;
      code: string;
      status: string;
      warehouse_id: string;
      source: string;
      production_requisition_id: string | null;
      customer_return_id: string | null;
      reference_code: string;
      product_id: string;
      lot_code: string;
      expiry_date: string | null;
      quantity: number;
      location_id: string | null;
    }>(
      `select id, code, status, warehouse_id, source, production_requisition_id, customer_return_id, reference_code, product_id, lot_code,
              expiry_date::text as expiry_date, quantity, location_id
       from wms.quality_holds where id = $1 and company_id = $2 for update`,
      [holdId, ctx.user.companyId],
    );
    if (!h) throw new NotFoundError("Retenção da qualidade");
    assertWarehouseAccess(ctx, h.warehouse_id);
    if (!["pending", "rework"].includes(h.status)) throw new DomainError(`A retenção ${h.code} já foi decidida.`, "INVALID_STATUS");
    const ref = {
      referenceType: h.source === "customer_return" ? "customer_return" : "production_requisition",
      referenceId: h.production_requisition_id ?? h.customer_return_id,
      referenceCode: h.reference_code,
    };
    const base = { warehouseId: h.warehouse_id, productId: h.product_id, lotCode: h.lot_code, expiryDate: h.expiry_date };
    let tasks: string[] = [];
    if (d.decision !== "rework" && h.location_id) {
      const bal = await lockBalance(tx, ctx.user.companyId, h.location_id, h.product_id, h.lot_code);
      if (!bal || bal.blocked_qty < h.quantity) throw new DomainError("Saldo bloqueado da retenção não encontrado na quarentena.", "STOCK_MISMATCH");
      await tx.query(`update wms.stock_balances set blocked_qty = blocked_qty - $2, version = version + 1, updated_at = now() where id = $1`, [
        bal.id,
        h.quantity,
      ]);
      await removeStock(tx, ctx, { balanceId: bal.id, quantity: h.quantity });
      await insertMovement(tx, ctx, {
        ...base,
        ...ref,
        movementType: d.decision === "approved" ? "unblock" : "discard",
        quantity: h.quantity,
        fromLocationId: h.location_id,
        reason: d.decision === "approved" ? `Liberado pela qualidade (${h.code}) — segue para armazenagem` : `Reprovado pela qualidade (${h.code})`,
      });
    }
    if (d.decision === "approved") {
      tasks = await createPutawayTasks(tx, ctx, {
        ...base,
        quantity: h.quantity,
        fromLocationId: h.location_id,
        productionRequisitionId: h.production_requisition_id,
        customerReturnId: h.customer_return_id,
        note: `Liberado pela qualidade (${h.code})`,
        ref: h.code,
      });
    }
    await tx.query(
      `update wms.quality_holds set status = $2, report = $3, attachment_url = $4, decided_by = $5, decided_at = now() where id = $1`,
      [h.id, d.decision, d.report, d.attachmentUrl, ctx.user.id],
    );
    await tx.query(
      `insert into wms.quality_hold_events (company_id, hold_id, decision, report, attachment_url, decided_by) values ($1,$2,$3,$4,$5,$6)`,
      [ctx.user.companyId, h.id, d.decision, d.report, d.attachmentUrl, ctx.user.id],
    );
    await audit(tx, ctx, `quality.${d.decision}`, "quality_hold", h.id, h.code, { ...d, tasks });
    return { id: h.id, code: h.code, status: d.decision, tasks };
  });
}
