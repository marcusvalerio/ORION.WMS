import Link from "next/link";
import { ArrowRight, ClipboardList, PackagePlus, ScanLine, ArrowLeftRight, CircleAlert, TriangleAlert, Info } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { getAlerts, getFlowSeries, getKpis, getRecentActivity, getTaskDistribution } from "@/server/services/dashboard";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi";
import { FlowChart } from "@/components/charts/flow-chart";
import { TaskDistribution } from "@/components/charts/task-distribution";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { DemoBadge } from "@/components/ui/badge";
import { MOVEMENT_LABELS } from "@/lib/labels";
import { fmtQty, fmtRelative } from "@/lib/format";
import { can } from "@/lib/permissions";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Dashboard" };

const ALERT_ICON = { danger: CircleAlert, warning: TriangleAlert, info: Info };
const ALERT_STYLE = { danger: "text-red-600", warning: "text-amber-600", info: "text-sky-600" };

export default async function DashboardPage() {
  const ctx = await requireCtx();
  const [kpis, flow, distribution, alerts, activity] = await Promise.all([
    getKpis(ctx),
    getFlowSeries(ctx, 14),
    getTaskDistribution(ctx),
    getAlerts(ctx),
    getRecentActivity(ctx),
  ]);
  const quick = [
    { label: "Novo recebimento", href: "/recebimentos/novo", icon: PackagePlus, show: can(ctx.user.role, "receipt.create") },
    { label: "Executar tarefas", href: "/tarefas?status=pending,in_progress", icon: ClipboardList, show: can(ctx.user.role, "task.execute") },
    { label: "Novo pedido de saída", href: "/separacao/novo", icon: ScanLine, show: can(ctx.user.role, "outbound.create") },
    { label: "Transferir estoque", href: "/estoque/transferir", icon: ArrowLeftRight, show: can(ctx.user.role, "stock.transfer") },
  ].filter((q) => q.show);

  return (
    <>
      <PageHeader
        title="Dashboard operacional"
        description="Situação do armazém calculada em tempo real a partir dos registros operacionais. Passe o cursor no ícone de informação para ver a definição de cada indicador."
        badges={ctx.user.companyIsDemo ? <DemoBadge /> : undefined}
        actions={quick.map((q) => (
          <ButtonLink key={q.href} href={q.href} size="sm" variant={q.href === "/recebimentos/novo" ? "primary" : "secondary"}>
            <q.icon className="size-4" aria-hidden />
            {q.label}
          </ButtonLink>
        ))}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <KpiCard key={k.key} kpi={k} />
        ))}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Recebimentos × expedições" description="Unidades armazenadas e expedidas por dia (últimos 14 dias), a partir das movimentações." />
          <CardBody>
            <FlowChart data={flow} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Tarefas por status" description="Todas as tarefas registradas, por tipo." />
          <CardBody>
            <TaskDistribution data={distribution} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <Card>
          <CardHeader title="Alertas operacionais" description="Pontos que exigem atenção agora." />
          {alerts.length ? (
            <ul className="divide-y divide-slate-100">
              {alerts.map((a, i) => {
                const Icon = ALERT_ICON[a.level];
                return (
                  <li key={i}>
                    <Link href={a.href} className="flex items-start gap-2.5 px-4 py-3 hover:bg-slate-50">
                      <Icon className={cn("mt-0.5 size-4 shrink-0", ALERT_STYLE[a.level])} aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-800">{a.title}</span>
                        <span className="block truncate text-xs text-slate-500">{a.detail}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="Nenhum alerta no momento" description="Validades, ocupação, tarefas e divergências estão sob controle." />
          )}
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader
            title="Atividade recente"
            description="Últimas movimentações de estoque."
            actions={
              <Link href="/estoque/movimentacoes" className="link inline-flex items-center gap-1 text-xs">
                Ver histórico <ArrowRight className="size-3" />
              </Link>
            }
          />
          {activity.length ? (
            <ul className="divide-y divide-slate-100">
              {activity.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium text-slate-800">{MOVEMENT_LABELS[m.movement_type]}</span>
                    <span className="text-slate-500"> · {m.sku} · {fmtQty(m.quantity)} un</span>
                    <span className="block truncate text-xs text-slate-500">
                      {m.from_code ?? "—"} → {m.to_code ?? "saída"} {m.reference_code ? `· ${m.reference_code}` : ""}
                    </span>
                  </span>
                  <span className="text-xs text-slate-500">
                    {m.user_name} · {fmtRelative(m.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Sem movimentações ainda" description="Recebimentos armazenados, transferências e expedições aparecerão aqui." />
          )}
        </Card>
      </div>
    </>
  );
}
