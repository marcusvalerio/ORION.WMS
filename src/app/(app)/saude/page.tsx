import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { getSystemHealth } from "@/server/services/health";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { can } from "@/lib/permissions";
import type { Tone } from "@/lib/labels";

export const metadata = { title: "Saúde do sistema" };

const OVERALL: Record<string, { label: string; tone: Tone }> = {
  ok: { label: "Operacional", tone: "success" },
  degraded: { label: "Com pendências", tone: "warning" },
  error: { label: "Indisponível", tone: "danger" },
};

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <Badge tone={ok ? "success" : "warning"}>{children}</Badge>;
}

export default async function HealthPage() {
  const ctx = await requireCtx();
  if (!can(ctx.user.role, "system.health")) {
    return (
      <>
        <PageHeader title="Saúde do sistema" breadcrumbs={[{ label: "Gestão" }, { label: "Saúde" }]} />
        <Alert level="warning">Acesso restrito a administradores.</Alert>
      </>
    );
  }
  const h = await getSystemHealth(ctx);
  const overall = OVERALL[h.status];
  const q = h.queue_detail ?? {};
  return (
    <>
      <PageHeader
        title="Saúde do sistema"
        description="Estado do banco, das migrations, da fila de integração e das configurações. A versão pública (sem dados sensíveis) está em /api/health, para monitoramento."
        breadcrumbs={[{ label: "Gestão" }, { label: "Saúde" }]}
        badges={<Badge tone={overall.tone}>{overall.label}</Badge>}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Aplicação e banco" />
          <CardBody>
            <DefinitionList
              className="lg:grid-cols-2"
              items={[
                ["Versão", h.version],
                ["Node.js", h.node],
                ["Verificado em", fmtDateTime(h.time)],
                ["Banco", <Check key="db" ok={h.database.ok}>{h.database.ok ? `OK · ${h.database.latency_ms} ms` : "Sem conexão"}</Check>],
                ["Driver", h.driver === "pglite" ? "PGlite (embarcado)" : h.driver === "postgres" ? "PostgreSQL" : "—"],
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Migrations" />
          <CardBody className="space-y-3">
            <DefinitionList
              className="lg:grid-cols-2"
              items={[
                ["Aplicadas", h.migrations ? `${h.migrations.applied} de ${h.migrations.available}` : "—"],
                ["Última aplicada", h.last_migration ?? "—"],
              ]}
            />
            {h.pending_migrations.length ? (
              <Alert level="warning" title="Migrations pendentes">
                {h.pending_migrations.join(", ")} — rode <code>npm run db:migrate</code> ou <code>supabase db push</code>.
              </Alert>
            ) : h.migrations ? (
              <Alert level="success">Todas as migrations estão aplicadas.</Alert>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Fila de integração"
            actions={
              <Link href="/integracao" className="link text-xs">
                Abrir painel
              </Link>
            }
          />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(q).map(([status, n]) => (
                <span key={status} className="flex items-center gap-1.5 text-sm">
                  <StatusBadge kind="integration" status={status} /> <span className="font-semibold tabular-nums">{n}</span>
                </span>
              ))}
            </div>
            <p className="text-sm text-slate-600">
              Evento mais antigo na fila: {h.oldest_pending_at ? `${fmtDateTime(h.oldest_pending_at)} (${fmtRelative(h.oldest_pending_at)})` : "nenhum"}
            </p>
            {q.failed ? <Alert level="warning">Há {q.failed} evento(s) que esgotaram as tentativas. Reenvie ou descarte no painel de integração.</Alert> : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Configuração" description="Somente se as variáveis existem; valores nunca são exibidos." />
          <CardBody>
            <DefinitionList
              className="lg:grid-cols-1"
              items={[
                ["Transporte da outbox", <Check key="t" ok={h.transport.ok}>{h.transport.description}</Check>],
                ["ATLAS_DATABASE_URL (dados da empresa)", <Check key="a" ok={h.atlas_configured}>{h.atlas_configured ? "Configurada" : "Não configurada"}</Check>],
                ["CRON_SECRET (processamento agendado)", <Check key="c" ok={h.cron_configured}>{h.cron_configured ? "Configurada" : "Não configurada"}</Check>],
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
