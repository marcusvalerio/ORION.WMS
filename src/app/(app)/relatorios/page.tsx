import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { buildReport, REPORTS, type ReportKey } from "@/server/services/reports";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap } from "@/components/ui/table";
import { can } from "@/lib/permissions";
import { readParams, type SearchParams } from "@/lib/params";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Relatórios" };

const DESCRIPTIONS: Record<ReportKey, string> = {
  estoque: "Saldo físico, reservado, bloqueado e disponível por depósito, endereço, produto e lote.",
  movimentacoes: "Todas as movimentações com origem, destino, documento, motivo e usuário.",
  recebimentos: "Recebimentos com status, quantidades previstas e conferidas e pendências.",
  divergencias: "Divergências de recebimento, separação, conferência e inventário, com tratamento.",
  tarefas: "Tarefas operacionais por tipo, status, responsável e datas.",
  inventarios: "Sessões de inventário, escopo, itens contados e diferenças.",
  pedidos: "Pedidos de saída em separação e seu progresso por etapa.",
  expedicoes: "Expedições confirmadas com transportadora, documento e quantidades.",
};

const DEEP_LINKS: Partial<Record<ReportKey, string>> = {
  estoque: "/estoque",
  movimentacoes: "/estoque/movimentacoes",
  recebimentos: "/recebimentos",
  divergencias: "/divergencias",
  tarefas: "/tarefas",
  inventarios: "/inventario",
  pedidos: "/separacao",
  expedicoes: "/expedicao",
};

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  if (!can(ctx.user.role, "reports.export")) {
    return (
      <>
        <PageHeader title="Relatórios" breadcrumbs={[{ label: "Gestão" }, { label: "Relatórios" }]} />
        <Alert level="warning">Relatórios consolidados e exportação estão disponíveis para administradores, supervisores e auditores. As consultas operacionais continuam acessíveis pelo menu.</Alert>
      </>
    );
  }
  const selected = (params.r && params.r in REPORTS ? params.r : "estoque") as ReportKey;
  const preview = await buildReport(ctx, selected, new URLSearchParams());
  return (
    <>
      <PageHeader
        title="Relatórios"
        description="Consultas consolidadas com exportação CSV (separador ponto e vírgula, compatível com Excel). Para filtrar, use a tela operacional correspondente e exporte por lá — o CSV respeita os filtros aplicados."
        breadcrumbs={[{ label: "Gestão" }, { label: "Relatórios" }]}
      />
      <div className="grid gap-5 lg:grid-cols-4">
        <nav className="space-y-1.5" aria-label="Relatórios">
          {(Object.keys(REPORTS) as ReportKey[]).map((key) => (
            <Link
              key={key}
              href={`?r=${key}`}
              className={cn(
                "flex items-start gap-2 rounded-lg border px-3 py-2.5",
                key === selected ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-200",
              )}
            >
              <FileText className={cn("mt-0.5 size-4 shrink-0", key === selected ? "text-brand-600" : "text-slate-400")} aria-hidden />
              <span>
                <span className="block text-sm font-medium text-slate-800">{REPORTS[key]}</span>
                <span className="block text-xs text-slate-500">{DESCRIPTIONS[key]}</span>
              </span>
            </Link>
          ))}
        </nav>
        <Card className="lg:col-span-3">
          <CardHeader
            title={REPORTS[selected]}
            description={`${preview.rows.length} registro(s). Pré-visualização das primeiras 50 linhas.`}
            actions={
              <>
                {DEEP_LINKS[selected] ? (
                  <Link href={DEEP_LINKS[selected]!} className={buttonClass("secondary", "sm")}>
                    Abrir com filtros
                  </Link>
                ) : null}
                <a href={`/api/relatorios/${selected}`} className={buttonClass("primary", "sm")}>
                  <Download className="size-4" /> Exportar CSV
                </a>
              </>
            }
          />
          {preview.rows.length ? (
            <TableWrap>
              <table className="table-base">
                <thead>
                  <tr>
                    {preview.headers.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 50).map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j} className={typeof cell === "number" ? "num" : "max-w-[260px] truncate"} title={cell === null || cell === undefined ? "" : String(cell)}>
                          {cell === null || cell === undefined || cell === "" ? "—" : typeof cell === "number" ? cell.toLocaleString("pt-BR") : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <EmptyState title="Sem dados para este relatório" />
          )}
        </Card>
      </div>
    </>
  );
}
