import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { listDayAppointments, listDocks, todayInAgendaTz, WMS_TIMEZONE, type AppointmentRow } from "@/server/services/docks";
import { listWarehouses } from "@/server/services/warehouse";
import { listPurchaseOrdersWithBalance } from "@/server/services/receiving";
import { createAppointmentAction, createDockAction, toggleDockAction } from "@/server/actions/inbound";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Field, Input, Select } from "@/components/ui/fields";
import { ButtonLink } from "@/components/ui/button";
import { TableWrap } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { DOCK_TYPE_LABELS, STATUS } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { readParams, type SearchParams } from "@/lib/params";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Agenda de docas" };

const PX_PER_MIN = 0.8;
const TONE_BG: Record<string, string> = {
  scheduled: "border-info-line bg-info-bg text-info-fg",
  checked_in: "border-accent bg-accent-soft text-link",
  completed: "border-ok-line bg-ok-bg text-ok-fg",
  no_show: "border-crit-line bg-crit-bg text-crit-fg opacity-70",
  cancelled: "border-line bg-canvas text-muted line-through opacity-60",
};

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function DocksPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  const date = params.data && /^\d{4}-\d{2}-\d{2}$/.test(params.data) ? params.data : todayInAgendaTz();
  const warehouseId = params.deposito ?? null;
  const [docks, appointments, warehouses, purchaseOrders, outboundOrders] = await Promise.all([
    listDocks(ctx, warehouseId),
    listDayAppointments(ctx, date, warehouseId),
    listWarehouses(ctx),
    listPurchaseOrdersWithBalance(ctx),
    ctx.db.query<{ id: string; code: string; customer_name: string }>(
      `select id, code, customer_name from wms.outbound_orders where company_id = $1 and status not in ('shipped', 'cancelled') order by code`,
      [ctx.user.companyId],
    ),
  ]);
  const role = ctx.user.role;
  const activeDocks = docks.filter((d) => d.active);
  const visible = appointments.filter((a) => a.status !== "cancelled");
  const startHour = Math.min(6, ...visible.map((a) => Math.floor(a.start_min / 60)));
  const endHour = Math.max(20, ...visible.map((a) => Math.ceil(Math.min(a.end_min, 24 * 60) / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const height = (endHour - startHour) * 60 * PX_PER_MIN;
  const qs = (d: string) => `?${new URLSearchParams(Object.entries({ data: d, deposito: warehouseId ?? undefined }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <PageHeader
        title="Agenda de docas"
        description={`Janelas de carga e descarga por doca. Não há sobreposição na mesma doca (garantido no banco). Horários no fuso ${WMS_TIMEZONE}.`}
        breadcrumbs={[{ label: "Entrada" }, { label: "Agenda de docas" }]}
        actions={
          <div className="flex items-center gap-1">
            <ButtonLink href={qs(shiftDate(date, -1))} size="sm" aria-label="Dia anterior">
              <ChevronLeft className="size-4" />
            </ButtonLink>
            <ButtonLink href={qs(todayInAgendaTz())} size="sm">
              Hoje
            </ButtonLink>
            <ButtonLink href={qs(shiftDate(date, 1))} size="sm" aria-label="Próximo dia">
              <ChevronRight className="size-4" />
            </ButtonLink>
          </div>
        }
      />
      <Card className="mb-5">
        <FilterBar resetHref="/docas">
          <FilterField label="Data">
            <Input name="data" type="date" defaultValue={date} />
          </FilterField>
          <FilterField label="Depósito">
            <Select name="deposito" defaultValue={warehouseId ?? ""} placeholder="Todos" options={warehouses.map((w) => ({ value: w.id, label: w.code }))} />
          </FilterField>
        </FilterBar>
        <CardHeader
          title={`Grade do dia ${date.split("-").reverse().join("/")}`}
          description={`${visible.length} agendamento(s) · ${activeDocks.length} doca(s) ativa(s)`}
          className="border-t"
        />
        {activeDocks.length ? (
          <div className="overflow-x-auto p-4">
            <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `56px repeat(${activeDocks.length}, minmax(160px, 1fr))` }}>
              <div />
              {activeDocks.map((d) => (
                <div key={d.id} className="border-b border-line px-2 pb-2 text-xs font-semibold text-fg-2">
                  {d.code} <span className="font-normal text-muted">· {DOCK_TYPE_LABELS[d.dock_type]}</span>
                </div>
              ))}
              <div className="relative" style={{ height }}>
                {hours.map((h) => (
                  <span key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-muted" style={{ top: (h - startHour) * 60 * PX_PER_MIN }}>
                    {String(h).padStart(2, "0")}:00
                  </span>
                ))}
              </div>
              {activeDocks.map((d) => (
                <div key={d.id} className="relative border-l border-line" style={{ height }}>
                  {hours.map((h) => (
                    <div key={h} className="absolute inset-x-0 border-t border-dashed border-line" style={{ top: (h - startHour) * 60 * PX_PER_MIN }} />
                  ))}
                  {visible
                    .filter((a) => a.dock_id === d.id)
                    .map((a) => (
                      <Block key={a.id} a={a} top={(a.start_min - startHour * 60) * PX_PER_MIN} h={(Math.min(a.end_min, endHour * 60) - a.start_min) * PX_PER_MIN} />
                    ))}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState title="Nenhuma doca ativa" description="Cadastre as docas do depósito para usar a agenda." />
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {can(role, "dock.schedule") && activeDocks.length ? (
            <Card>
              <CardHeader title="Agendar janela" description="Vincule um pedido de compra (entrada) ou um pedido de saída. Doca de entrada não aceita pedido de saída e vice-versa." />
              <CardBody>
                <ActionForm action={createAppointmentAction} resetOnSuccess className="grid gap-3 md:grid-cols-4">
                  <Field label="Doca" required>
                    <Select name="dockId" required options={activeDocks.map((d) => ({ value: d.id, label: `${d.warehouse_code} · ${d.code} (${DOCK_TYPE_LABELS[d.dock_type]})` }))} />
                  </Field>
                  <Field label="Data" required>
                    <Input name="date" type="date" required defaultValue={date} />
                  </Field>
                  <Field label="Início" required>
                    <Input name="startTime" type="time" required defaultValue="08:00" />
                  </Field>
                  <Field label="Fim" required>
                    <Input name="endTime" type="time" required defaultValue="09:00" />
                  </Field>
                  <Field label="Transportadora">
                    <Input name="carrier" maxLength={120} />
                  </Field>
                  <Field label="Placa">
                    <Input name="vehiclePlate" maxLength={10} placeholder="ABC1D23" />
                  </Field>
                  <Field label="Pedido de compra">
                    <Select
                      name="purchaseOrderId"
                      placeholder="—"
                      options={purchaseOrders.filter((p) => ["open", "partially_received"].includes(p.status)).map((p) => ({ value: p.id, label: `${p.number} — ${p.supplier_name}` }))}
                    />
                  </Field>
                  <Field label="Pedido de saída">
                    <Select name="outboundOrderId" placeholder="—" options={outboundOrders.map((o) => ({ value: o.id, label: `${o.code} — ${o.customer_name}` }))} />
                  </Field>
                  <Field label="Observações" className="md:col-span-3">
                    <Input name="notes" maxLength={500} />
                  </Field>
                  <div className="flex items-end">
                    <SubmitButton>Agendar</SubmitButton>
                  </div>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Agendamentos do dia" />
            {appointments.length ? (
              <TableWrap>
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Doca</th>
                      <th>Janela</th>
                      <th>Status</th>
                      <th>Transportadora / placa</th>
                      <th>Documento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appointments.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <Link className="link" href={`/docas/${a.id}`}>
                            {a.code}
                          </Link>
                        </td>
                        <td>{a.dock_code}</td>
                        <td className="whitespace-nowrap">
                          {a.local_start}–{a.local_end}
                        </td>
                        <td>
                          <StatusBadge kind="appointment" status={a.status} />
                        </td>
                        <td>
                          {a.carrier ?? "—"}
                          {a.vehicle_plate ? <span className="block font-mono text-xs text-muted">{a.vehicle_plate}</span> : null}
                        </td>
                        <td>{a.po_number ?? a.outbound_code ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <EmptyState title="Nenhum agendamento neste dia" />
            )}
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Docas" description="Cadastro por depósito." />
            <ul className="divide-y divide-line text-sm">
              {docks.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <span>
                    <span className="font-medium">
                      {d.warehouse_code} · {d.code}
                    </span>{" "}
                    {d.name}
                    <span className="block text-xs text-muted">{DOCK_TYPE_LABELS[d.dock_type]}</span>
                  </span>
                  {can(role, "dock.manage") ? (
                    <ActionForm action={toggleDockAction}>
                      <input type="hidden" name="_id" value={d.id} />
                      <input type="hidden" name="active" value={String(!d.active)} />
                      <SubmitButton size="sm" variant="ghost">
                        {d.active ? "Desativar" : "Ativar"}
                      </SubmitButton>
                    </ActionForm>
                  ) : (
                    <Badge tone={d.active ? "success" : "neutral"}>{d.active ? "Ativa" : "Inativa"}</Badge>
                  )}
                </li>
              ))}
            </ul>
            {can(role, "dock.manage") ? (
              <CardBody className="border-t border-line">
                <Disclosure title="Cadastrar doca">
                  <ActionForm action={createDockAction} resetOnSuccess className="grid gap-3">
                    <Field label="Depósito" required>
                      <Select name="warehouseId" required options={warehouses.filter((w) => w.active).map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` }))} />
                    </Field>
                    <Field label="Código" required>
                      <Input name="code" required maxLength={20} placeholder="DOC-04" />
                    </Field>
                    <Field label="Nome" required>
                      <Input name="name" required maxLength={80} />
                    </Field>
                    <Field label="Tipo" required>
                      <Select name="dockType" options={Object.entries(DOCK_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
                    </Field>
                    <SubmitButton variant="secondary">Cadastrar</SubmitButton>
                  </ActionForm>
                </Disclosure>
              </CardBody>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}

function Block({ a, top, h }: { a: AppointmentRow; top: number; h: number }) {
  return (
    <Link
      href={`/docas/${a.id}`}
      className={cn("absolute inset-x-1 overflow-hidden rounded border px-1.5 py-1 text-[11px] leading-tight shadow-xs hover:z-10 hover:shadow", TONE_BG[a.status])}
      style={{ top, height: Math.max(h, 22) }}
      title={`${a.code} · ${a.local_start}–${a.local_end} · ${STATUS.appointment[a.status]?.label ?? a.status}`}
    >
      <span className="font-semibold">
        {a.local_start}–{a.local_end}
      </span>{" "}
      {a.code}
      <span className="block truncate">{[a.po_number ?? a.outbound_code, a.carrier, a.vehicle_plate].filter(Boolean).join(" · ")}</span>
    </Link>
  );
}
