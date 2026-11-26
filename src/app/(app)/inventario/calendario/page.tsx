import { requireCtx } from "@/server/auth/session";
import { getCycleCalendar } from "@/server/services/inventory";
import { listWarehouses } from "@/server/services/warehouse";
import { generateCycleCountsAction } from "@/server/actions/inventory";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";
import Link from "next/link";

export const metadata = { title: "Calendário do rotativo" };

const WEEK = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export default async function CycleCalendarPage({ searchParams }: { searchParams: Promise<{ deposito?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx.user.role, "inventory.create")) {
    return <Alert level="warning">Seu perfil não gera contagens do rotativo.</Alert>;
  }
  const sp = await searchParams;
  const warehouses = await listWarehouses(ctx);
  const warehouseId = sp.deposito && isUuid(sp.deposito) ? sp.deposito : warehouses[0]?.id;
  if (!warehouseId) return <Alert level="info">Cadastre um depósito para usar o rotativo.</Alert>;
  const cal = await getCycleCalendar(ctx, warehouseId);
  const today = cal.calendar[0];
  return (
    <>
      <PageHeader
        title="Calendário do rotativo"
        description={`Frequência por classe ABC: A a cada ${cal.plans.A} dias, B a cada ${cal.plans.B}, C a cada ${cal.plans.C}. Endereço zerado na separação e falta no picking também abrem contagem.`}
        breadcrumbs={[{ label: "Operações" }, { label: "Inventário", href: "/inventario" }, { label: "Calendário" }]}
      />
      <div className="mb-4 flex flex-wrap gap-2" role="list" aria-label="Depósitos">
        {warehouses.map((w) => (
          <Link
            key={w.id}
            role="listitem"
            href={`/inventario/calendario?deposito=${w.id}`}
            aria-current={w.id === warehouseId ? "page" : undefined}
            className="inline-flex min-h-11 items-center rounded-full border border-line px-4 font-mono text-sm aria-[current=page]:border-focus aria-[current=page]:bg-accent-soft"
          >
            {w.code}
          </Link>
        ))}
      </div>
      <Card className="mb-5">
        <CardHeader title="Hoje" description={`${today.total} endereço(s) vencem hoje · A ${today.byClass.A} · B ${today.byClass.B} · C ${today.byClass.C}`} />
        <CardBody>
          {cal.todayInventory ? (
            <p className="text-sm">
              As contagens de hoje já foram geradas:{" "}
              <Link className="link font-mono" href={`/inventario/${cal.todayInventory.id}`}>
                {cal.todayInventory.code}
              </Link>
            </p>
          ) : (
            <ActionForm action={generateCycleCountsAction}>
              <input type="hidden" name="warehouseId" value={warehouseId} />
              <SubmitButton disabled={!today.total}>Gerar contagens de hoje</SubmitButton>
            </ActionForm>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Próximos 30 dias" />
        <ol className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4 lg:grid-cols-7">
          {cal.calendar.map((d) => {
            const date = new Date(`${d.date}T12:00:00Z`);
            return (
              <li key={d.date} className="bg-surface p-3">
                <p className="text-xs text-muted">
                  {WEEK[date.getUTCDay()]} · {d.date.slice(8, 10)}/{d.date.slice(5, 7)}
                </p>
                <p className={d.total ? "font-display text-2xl tabular-nums" : "font-display text-2xl text-muted tabular-nums"}>{d.total}</p>
                <p className="text-xs text-muted tabular-nums">
                  A {d.byClass.A} · B {d.byClass.B} · C {d.byClass.C}
                </p>
              </li>
            );
          })}
        </ol>
      </Card>
    </>
  );
}
