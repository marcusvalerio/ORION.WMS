import "server-only";
import { z } from "zod";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError, NotFoundError } from "../errors";
import { parse, uuid, optionalText, optionalUuid } from "../validation";
import { audit, enqueueIntegrationEvent, nextCode, runOperation, type OpOptions } from "./common";

/** Fuso usado para interpretar data/hora digitadas na agenda (configurável). */
export const WMS_TIMEZONE = process.env.WMS_TIMEZONE || "America/Sao_Paulo";

export const DOCK_TYPES = ["inbound", "outbound", "both"] as const;
export const APPOINTMENT_STATUSES = ["scheduled", "checked_in", "no_show", "completed", "cancelled"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

// -----------------------------------------------------------------------------
// Docas
// -----------------------------------------------------------------------------

const dockSchema = z.object({
  warehouseId: uuid("Depósito"),
  code: z.string().trim().min(1, "Informe o código da doca.").max(20).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(2, "Informe o nome da doca.").max(80),
  dockType: z.enum(DOCK_TYPES, { error: "Tipo de doca inválido." }),
});

export async function createDock(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "dock.manage");
  const d = parse(dockSchema, input);
  return runOperation(ctx, "dock.create", opts, async (tx) => {
    const [wh] = await tx.query(`select 1 from wms.warehouses where id = $1 and company_id = $2`, [d.warehouseId, ctx.user.companyId]);
    if (!wh) throw new NotFoundError("Depósito");
    const [dup] = await tx.query(`select 1 from wms.docks where warehouse_id = $1 and code = $2`, [d.warehouseId, d.code]);
    if (dup) throw new DomainError(`Já existe a doca ${d.code} neste depósito.`, "DUPLICATE");
    const [row] = await tx.query<{ id: string }>(
      `insert into wms.docks (company_id, warehouse_id, code, name, dock_type, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
      [ctx.user.companyId, d.warehouseId, d.code, d.name, d.dockType, ctx.user.id],
    );
    await audit(tx, ctx, "dock.created", "dock", row.id, d.code, d);
    return { id: row.id };
  });
}

export async function setDockActive(ctx: Ctx, dockId: string, active: boolean) {
  assertCan(ctx, "dock.manage");
  return runOperation(ctx, "dock.set_active", undefined, async (tx) => {
    const [row] = await tx.query<{ code: string }>(
      `update wms.docks set active = $3 where id = $1 and company_id = $2 returning code`,
      [dockId, ctx.user.companyId, active],
    );
    if (!row) throw new NotFoundError("Doca");
    await audit(tx, ctx, active ? "dock.activated" : "dock.deactivated", "dock", dockId, row.code);
    return { id: dockId };
  });
}

export async function listDocks(ctx: Ctx, warehouseId?: string | null) {
  return ctx.db.query<{ id: string; warehouse_id: string; warehouse_code: string; code: string; name: string; dock_type: string; active: boolean }>(
    `select d.id, d.warehouse_id, w.code as warehouse_code, d.code, d.name, d.dock_type, d.active
     from wms.docks d join wms.warehouses w on w.id = d.warehouse_id
     where d.company_id = $1 and ($2::uuid is null or d.warehouse_id = $2::uuid) order by w.code, d.code`,
    [ctx.user.companyId, warehouseId ?? null],
  );
}

// -----------------------------------------------------------------------------
// Agendamentos
// -----------------------------------------------------------------------------

const time = (label: string) => z.string({ error: `${label} é obrigatória.` }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, `${label} inválida (HH:MM).`);

const appointmentSchema = z
  .object({
    dockId: uuid("Doca"),
    date: z.string({ error: "Data é obrigatória." }).regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use AAAA-MM-DD)."),
    startTime: time("Hora inicial"),
    endTime: time("Hora final"),
    carrier: optionalText,
    vehiclePlate: z
      .string()
      .trim()
      .max(10)
      .nullish()
      .transform((v) => (v ? v.toUpperCase().replace(/[^A-Z0-9]/g, "") : null)),
    purchaseOrderId: optionalUuid,
    outboundOrderId: optionalUuid,
    notes: optionalText,
  })
  .refine((d) => d.endTime > d.startTime, { message: "A hora final deve ser posterior à inicial.", path: ["endTime"] })
  .refine((d) => !(d.purchaseOrderId && d.outboundOrderId), { message: "Vincule um pedido de compra OU um pedido de saída.", path: ["outboundOrderId"] });

/**
 * Agenda uma janela em uma doca. A ausência de sobreposição é garantida no banco
 * (trigger com lock da doca); o serviço apenas antecipa a mensagem amigável.
 */
export async function createAppointment(ctx: Ctx, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "dock.schedule");
  const d = parse(appointmentSchema, input);
  return runOperation(ctx, "dock.schedule", opts, async (tx) => {
    const [dock] = await tx.query<{ id: string; code: string; warehouse_id: string; dock_type: string; active: boolean }>(
      `select id, code, warehouse_id, dock_type, active from wms.docks where id = $1 and company_id = $2 for update`,
      [d.dockId, ctx.user.companyId],
    );
    if (!dock) throw new NotFoundError("Doca");
    if (!dock.active) throw new DomainError(`A doca ${dock.code} está inativa.`);
    const direction = d.outboundOrderId ? "outbound" : d.purchaseOrderId ? "inbound" : dock.dock_type === "outbound" ? "outbound" : "inbound";
    if (dock.dock_type !== "both" && dock.dock_type !== direction) {
      throw new DomainError(`A doca ${dock.code} é exclusiva de ${dock.dock_type === "inbound" ? "entrada" : "saída"}.`, "VALIDATION");
    }
    let reference: { code: string; supplier: string | null; volumes: string | null } | null = null;
    if (d.purchaseOrderId) {
      const [po] = await tx.query<{ status: string; number: string; supplier: string | null; items: number; units: number }>(
        `select po.status, po.number, s.name as supplier,
                (select count(*)::int from erp.purchase_order_items i where i.purchase_order_id = po.id) as items,
                (select coalesce(sum(i.quantity), 0)::float8 from erp.purchase_order_items i where i.purchase_order_id = po.id) as units
         from erp.purchase_orders po left join erp.suppliers s on s.id = po.supplier_id where po.id = $1 and po.company_id = $2`,
        [d.purchaseOrderId, ctx.user.companyId],
      );
      if (!po) throw new NotFoundError("Pedido de compra");
      if (!["open", "partially_received"].includes(po.status)) throw new DomainError(`O pedido ${po.number} não está aberto para recebimento.`);
      reference = { code: po.number, supplier: po.supplier, volumes: `${po.items} item(ns) · ${po.units} un` };
    }
    if (d.outboundOrderId) {
      const [o] = await tx.query<{ status: string; code: string; warehouse_id: string }>(
        `select status, code, warehouse_id from wms.outbound_orders where id = $1 and company_id = $2`,
        [d.outboundOrderId, ctx.user.companyId],
      );
      if (!o) throw new NotFoundError("Pedido de saída");
      if (["shipped", "cancelled"].includes(o.status)) throw new DomainError(`O pedido ${o.code} já foi encerrado.`);
      if (o.warehouse_id !== dock.warehouse_id) throw new DomainError("O pedido de saída é de outro depósito.");
      reference = { code: o.code, supplier: null, volumes: null };
    }
    const [range] = await tx.query<{ starts_at: string; ends_at: string }>(
      `select (($1::date + $2::time) at time zone $4)::text as starts_at, (($1::date + $3::time) at time zone $4)::text as ends_at`,
      [d.date, d.startTime, d.endTime, WMS_TIMEZONE],
    );
    const [conflict] = await tx.query<{ code: string }>(
      `select code from wms.dock_appointments where dock_id = $1 and status in ('scheduled', 'checked_in', 'completed')
         and tstzrange(starts_at, ends_at) && tstzrange($2::timestamptz, $3::timestamptz) limit 1`,
      [dock.id, range.starts_at, range.ends_at],
    );
    if (conflict) throw new DomainError(`Doca ${dock.code} ocupada neste horário (agendamento ${conflict.code}).`, "DOCK_OVERLAP");
    const code = await nextCode(tx, ctx.user.companyId, "AGD");
    const [row] = await tx.query<{ id: string }>(
      `insert into wms.dock_appointments (company_id, warehouse_id, dock_id, code, direction, starts_at, ends_at, carrier, vehicle_plate,
                                          purchase_order_id, outbound_order_id, notes, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [
        ctx.user.companyId,
        dock.warehouse_id,
        dock.id,
        code,
        direction,
        range.starts_at,
        range.ends_at,
        d.carrier,
        d.vehiclePlate,
        d.purchaseOrderId ?? null,
        d.outboundOrderId ?? null,
        d.notes,
        ctx.user.id,
      ],
    );
    await audit(tx, ctx, "appointment.created", "dock_appointment", row.id, code, { dock: dock.code, ...d });
    // aviso (canal de e-mail da outbox): agendamento de doca criado
    await enqueueIntegrationEvent(tx, ctx, "dock.appointment_created", "dock_appointment", row.id, {
      code,
      direction,
      dock: dock.code,
      reference: reference?.code ?? code,
      supplier: reference?.supplier ?? null,
      volumes: reference?.volumes ?? null,
      carrier: d.carrier,
      starts_at: new Date(range.starts_at).toISOString(),
      ends_at: new Date(range.ends_at).toISOString(),
    });
    return { id: row.id, code };
  });
}

async function lockAppointment(tx: Queryable, ctx: Ctx, id: string) {
  const [a] = await tx.query<{ id: string; code: string; status: AppointmentStatus; future: boolean }>(
    `select id, code, status, starts_at > now() as future from wms.dock_appointments where id = $1 and company_id = $2 for update`,
    [id, ctx.user.companyId],
  );
  if (!a) throw new NotFoundError("Agendamento");
  return a;
}

const TRANSITIONS: Record<string, { from: AppointmentStatus[]; to: AppointmentStatus; label: string }> = {
  check_in: { from: ["scheduled"], to: "checked_in", label: "registrar check-in" },
  no_show: { from: ["scheduled"], to: "no_show", label: "registrar não comparecimento" },
  complete: { from: ["checked_in"], to: "completed", label: "concluir" },
  cancel: { from: ["scheduled"], to: "cancelled", label: "cancelar" },
};

/** Check-in, não comparecimento, conclusão ou cancelamento do agendamento. */
export async function changeAppointmentStatus(ctx: Ctx, id: string, input: unknown) {
  assertCan(ctx, "dock.schedule");
  const d = parse(z.object({ action: z.enum(["check_in", "no_show", "complete", "cancel"], { error: "Ação inválida." }), notes: optionalText }), input);
  return runOperation(ctx, `dock.${d.action}`, undefined, async (tx) => {
    const a = await lockAppointment(tx, ctx, id);
    const t = TRANSITIONS[d.action];
    if (!t.from.includes(a.status)) {
      throw new DomainError(`Não é possível ${t.label}: o agendamento ${a.code} está com status "${a.status}".`, "INVALID_STATUS");
    }
    if (d.action === "no_show" && a.future) {
      throw new DomainError("Não comparecimento só pode ser registrado após o início da janela.", "VALIDATION");
    }
    await tx.query(
      `update wms.dock_appointments set status = $2, updated_at = now(),
              checked_in_at = case when $2 = 'checked_in' then now() else checked_in_at end,
              completed_at = case when $2 = 'completed' then now() else completed_at end,
              notes = coalesce($3, notes)
       where id = $1`,
      [id, t.to, d.notes],
    );
    await audit(tx, ctx, `appointment.${d.action}`, "dock_appointment", id, a.code, d);
    return { id };
  });
}

export interface AppointmentRow {
  id: string;
  code: string;
  dock_id: string;
  dock_code: string;
  warehouse_id: string;
  direction: "inbound" | "outbound";
  status: AppointmentStatus;
  starts_at: string;
  ends_at: string;
  /** Minutos desde 00:00 no fuso da agenda (para a grade). */
  start_min: number;
  end_min: number;
  local_start: string;
  local_end: string;
  local_date: string;
  carrier: string | null;
  vehicle_plate: string | null;
  purchase_order_id: string | null;
  po_number: string | null;
  outbound_order_id: string | null;
  outbound_code: string | null;
  receipt_id: string | null;
  receipt_code: string | null;
  notes: string | null;
}

const APPT_SELECT = `
  select a.id, a.code, a.dock_id, d.code as dock_code, a.warehouse_id, a.direction, a.status,
         a.starts_at::text as starts_at, a.ends_at::text as ends_at,
         extract(hour from a.starts_at at time zone $TZ) * 60 + extract(minute from a.starts_at at time zone $TZ) as start_min,
         extract(epoch from (a.ends_at - date_trunc('day', a.starts_at at time zone $TZ) at time zone $TZ)) / 60 as end_min,
         to_char(a.starts_at at time zone $TZ, 'HH24:MI') as local_start, to_char(a.ends_at at time zone $TZ, 'HH24:MI') as local_end,
         to_char(a.starts_at at time zone $TZ, 'YYYY-MM-DD') as local_date,
         a.carrier, a.vehicle_plate, a.purchase_order_id, po.number as po_number, a.outbound_order_id, o.code as outbound_code,
         r.id as receipt_id, r.code as receipt_code, a.notes
  from wms.dock_appointments a join wms.docks d on d.id = a.dock_id
  left join erp.purchase_orders po on po.id = a.purchase_order_id
  left join wms.outbound_orders o on o.id = a.outbound_order_id
  left join wms.receipts r on r.appointment_id = a.id and r.status <> 'cancelled'`;

/** Agendamentos que começam no dia informado (no fuso da agenda). */
export async function listDayAppointments(ctx: Ctx, date: string, warehouseId?: string | null) {
  return ctx.db.query<AppointmentRow>(
    `${APPT_SELECT.replaceAll("$TZ", "$4")}
     where a.company_id = $1 and (a.starts_at at time zone $4)::date = $2::date and ($3::uuid is null or a.warehouse_id = $3::uuid)
     order by a.starts_at, d.code`,
    [ctx.user.companyId, date, warehouseId ?? null, WMS_TIMEZONE],
  );
}

export async function getAppointment(ctx: Ctx, id: string) {
  const [row] = await ctx.db.query<AppointmentRow>(`${APPT_SELECT.replaceAll("$TZ", "$3")} where a.id = $1 and a.company_id = $2`, [
    id,
    ctx.user.companyId,
    WMS_TIMEZONE,
  ]);
  return row ?? null;
}

/** Data de hoje no fuso da agenda (AAAA-MM-DD). */
export function todayInAgendaTz(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: WMS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
