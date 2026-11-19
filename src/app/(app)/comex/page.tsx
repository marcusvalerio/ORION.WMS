import type { ReactNode } from "react";
import Link from "next/link";
import { Download, PackageOpen, Printer, Ship, Tag } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import {
  exportIndicators,
  importFilterOptions,
  importIndicators,
  listExportOrders,
  listImportProcesses,
  type ExportOrderRow,
  type ImportProcessRow,
} from "@/server/services/comex-panel";
import type { Kpi } from "@/server/services/dashboard";
import { toUserMessage } from "@/server/errors";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { FilterBar, FilterField } from "@/components/ui/filter-bar";
import { Input, Select } from "@/components/ui/fields";
import { TableWrap } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { KpiCard } from "@/components/ui/kpi";
import { cn } from "@/components/ui/cn";
import { ImportTimeline } from "@/components/comex/import-timeline";
import { ContainerMini } from "@/components/comex/container-iso";
import { containerLoad } from "@/lib/container";
import {
  CUSTOMS_CHANNEL_LABELS,
  EXPORT_SITUATION_LABELS,
  EXPORT_SITUATIONS,
  IMPORT_SITUATION_LABELS,
  IMPORT_SITUATIONS,
  TRANSPORT_DOC_LABELS,
  TRANSPORT_MODE_LABELS,
  type CustomsChannel,
  type TransportMode,
} from "@/lib/comex-panel";
import { fmtDay, fmtQty } from "@/lib/format";
import { can } from "@/lib/permissions";
import { readParams, type SearchParams } from "@/lib/params";

export const metadata = { title: "Comex — importação e exportação" };

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Tab = "importacao" | "exportacao";

function qs(values: Record<string, string | undefined>) {
  return new URLSearchParams(Object.entries(values).filter(([, v]) => v) as [string, string][]).toString();
}

/** Aba Comex: tudo de importação (DI/DUIMP, desembaraço, trânsito) e exportação (volumes, packing list, DU-E) em um só lugar. */
export default async function ComexPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const params = await readParams(searchParams);
  const tab: Tab = params.aba === "exportacao" ? "exportacao" : "importacao";
  const filters = { situacao: params.situacao, fornecedor: params.fornecedor, pais: params.pais, de: params.de, ate: params.ate, q: params.q, due: params.due };
  const canExport = can(ctx.user.role, "reports.export");
  const csvHref = `/api/relatorios/${tab === "importacao" ? "importacoes" : "exportacoes"}?${qs(filters)}`;

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Ship className="size-6 text-link" aria-hidden /> Comex
          </span>
        }
        description="Importação e exportação em um só lugar: processos de importação do embarque à armazenagem e pedidos de exportação da separação ao embarque."
        breadcrumbs={[{ label: "Armazém" }, { label: "Comex" }]}
        actions={
          canExport ? (
            <ButtonLink href={csvHref} size="sm" prefetch={false}>
              <Download className="size-4" aria-hidden /> CSV
            </ButtonLink>
          ) : null
        }
      />

      <nav aria-label="Abas do Comex" className="mb-5 flex gap-1 border-b border-line">
        {(
          [
            ["importacao", "Importação"],
            ["exportacao", "Exportação"],
          ] as const
        ).map(([key, label]) => (
          <Link
            key={key}
            href={`/comex?aba=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === key ? "border-accent text-link" : "border-transparent text-muted hover:border-line-strong hover:text-fg",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {tab === "importacao" ? <ImportTab ctx={ctx} params={params} /> : <ExportTab ctx={ctx} params={params} />}
    </>
  );
}

type TabProps = { ctx: Awaited<ReturnType<typeof requireCtx>>; params: Record<string, string | undefined> };

function LoadError({ error, tab }: { error: unknown; tab: Tab }) {
  return (
    <Card>
      <ErrorState
        title="Não foi possível carregar o Comex"
        description="Tente novamente em instantes. Se persistir, avise o administrador."
        detail={toUserMessage(error)}
        actions={
          <Link href={`/comex?aba=${tab}`} className={buttonClass("primary", "md")}>
            Tentar de novo
          </Link>
        }
      />
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Importação
// -----------------------------------------------------------------------------

async function ImportTab({ ctx, params }: TabProps) {
  let data;
  try {
    const [rows, k, options] = await Promise.all([
      listImportProcesses(ctx, { situation: params.situacao, supplierId: params.fornecedor, country: params.pais, from: params.de, to: params.ate, q: params.q }),
      importIndicators(ctx),
      importFilterOptions(ctx),
    ]);
    data = { rows, k, options };
  } catch (error) {
    return <LoadError error={error} tab="importacao" />;
  }
  const { rows, k, options } = data;
  const kpis: Kpi[] = [
    {
      key: "open",
      label: "Processos em aberto",
      value: k.open,
      definition: "Recebimentos com dados de importação ainda não armazenados (exclui cancelados).",
      href: "/comex?aba=importacao",
    },
    {
      key: "awaiting",
      label: "Aguardando desembaraço",
      value: k.awaiting,
      tone: k.awaiting ? "warning" : "default",
      hint: k.awaiting ? "Armazenagem bloqueada" : "Nenhuma retenção",
      definition: "Recebimentos retidos até o registro do desembaraço aduaneiro; não podem ser liberados para armazenagem.",
      href: "/comex?aba=importacao&situacao=awaiting",
    },
    {
      key: "cleared",
      label: "Desembaraçados no mês",
      value: k.clearedThisMonth,
      tone: "success",
      definition: "Desembaraços registrados com data no mês corrente.",
      series: k.clearedSeries,
      seriesLabel: "Desembaraços por dia",
    },
    {
      key: "transit",
      label: "Em trânsito",
      value: k.inTransit.quantity,
      format: "qty",
      hint: `${k.inTransit.processes} processo(s) · ${brl.format(k.inTransit.value)}`,
      definition:
        "Quantidade prevista dos processos ainda não chegados ao armazém (recebimento previsto, sem chegada registrada). Valor pelo preço unitário do pedido de compra, quando informado.",
    },
  ];
  const hasFilters = Boolean(params.situacao || params.fornecedor || params.pais || params.de || params.ate || params.q);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} />
        ))}
      </div>
      <Card>
        <CardHeader
          title="Processos de importação"
          description="Recebimentos com dados de comércio exterior. Abra o recebimento para informar DI/DUIMP, datas e canal, ou registrar o desembaraço."
        />
        <FilterBar resetHref="/comex?aba=importacao">
          <input type="hidden" name="aba" value="importacao" />
          <FilterField label="Buscar" className="w-full sm:w-64">
            <Input name="q" defaultValue={params.q} placeholder="DI/DUIMP, invoice, contêiner, BL/AWB, NF" />
          </FilterField>
          <FilterField label="Situação">
            <Select
              name="situacao"
              defaultValue={params.situacao}
              placeholder="Todas"
              options={IMPORT_SITUATIONS.map((s) => ({ value: s, label: IMPORT_SITUATION_LABELS[s].label }))}
            />
          </FilterField>
          <FilterField label="Fornecedor">
            <Select name="fornecedor" defaultValue={params.fornecedor} placeholder="Todos" options={options.suppliers.map((s) => ({ value: s.id, label: s.name }))} />
          </FilterField>
          <FilterField label="País de origem" className="w-full sm:w-32">
            <Select name="pais" defaultValue={params.pais} placeholder="Todos" options={options.countries.map((c) => ({ value: c, label: c }))} />
          </FilterField>
          <FilterField label="Aberto de" className="w-[calc(50%-6px)] sm:w-40">
            <Input type="date" name="de" defaultValue={params.de} />
          </FilterField>
          <FilterField label="até" className="w-[calc(50%-6px)] sm:w-40">
            <Input type="date" name="ate" defaultValue={params.ate} />
          </FilterField>
        </FilterBar>
        {rows.length ? (
          <ImportTable rows={rows} />
        ) : hasFilters ? (
          <EmptyState title="Nenhum processo com esses filtros" description="Ajuste a busca ou limpe os filtros." />
        ) : (
          <EmptyState
            title="Nenhum processo de importação"
            description="Informe os dados de importação (DI/DUIMP, Incoterm, origem, contêiner) no cartão “Importação” de um recebimento."
            action={
              <ButtonLink href="/recebimentos" size="sm">
                Ir para recebimentos
              </ButtonLink>
            }
          />
        )}
      </Card>
    </div>
  );
}

function ImportTable({ rows }: { rows: ImportProcessRow[] }) {
  return (
    <TableWrap>
      <table className="table-base">
        <thead>
          <tr>
            <th>Contêiner</th>
            <th>Recebimento</th>
            <th>Situação</th>
            <th>Fornecedor / origem</th>
            <th>Declaração</th>
            <th>Documentos</th>
            <th>Linha do tempo</th>
            <th className="num">Previsto</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const mode = r.transport_mode as TransportMode | null;
            const channel = r.customs_channel ? CUSTOMS_CHANNEL_LABELS[r.customs_channel as CustomsChannel] : null;
            return (
              <tr key={r.id}>
                <td>
                  <ContainerMini load={containerLoad({ type: r.container_type, m3: r.cargo_m3, kg: r.cargo_kg, missing: r.cargo_missing })} pallet={r.pallet_type} />
                </td>
                <td>
                  <Link href={`/recebimentos/${r.id}`} className="link font-mono">
                    {r.code}
                  </Link>
                  {r.is_demo ? <DemoBadge className="ml-2" /> : null}
                  <span className="block text-xs text-muted">{r.warehouse_code}</span>
                </td>
                <td>
                  <Badge tone={IMPORT_SITUATION_LABELS[r.situation].tone}>{IMPORT_SITUATION_LABELS[r.situation].label}</Badge>
                </td>
                <td>
                  <span className="block max-w-56 truncate">{r.supplier_name}</span>
                  <span className="block text-xs text-muted">
                    {[r.origin_country ? <span key="o" className="font-mono">{r.origin_country}</span> : null, r.incoterm, mode ? TRANSPORT_MODE_LABELS[mode] : null]
                      .filter(Boolean)
                      .reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, " · ", el] : [el]), [])}
                    {!r.origin_country && !r.incoterm && !mode ? "—" : null}
                  </span>
                </td>
                <td>
                  {r.import_doc_type ? (
                    <>
                      <span className="text-xs text-muted">{r.import_doc_type}</span>{" "}
                      <span className="font-mono text-xs">{r.import_doc_number}</span>
                    </>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                  {channel ? (
                    <span className="mt-1 block" title={channel.hint}>
                      <Badge tone={channel.tone}>Canal {channel.label.toLowerCase()}</Badge>
                    </span>
                  ) : null}
                </td>
                <td className="text-xs">
                  <DocLine label="Invoice" value={r.commercial_invoice} />
                  <DocLine label={mode ? TRANSPORT_DOC_LABELS[mode] : "BL/AWB"} value={r.transport_doc} />
                  <DocLine label="Contêiner" value={r.container_number} />
                  <DocLine label="NF" value={r.invoice_number?.replace(/^NF\s*/i, "") ?? null} />
                  {!r.commercial_invoice && !r.transport_doc && !r.container_number && !r.invoice_number ? <span className="text-muted">—</span> : null}
                </td>
                <td>
                  <ImportTimeline row={r} />
                </td>
                <td className="num">{fmtQty(r.expected_total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}

function DocLine({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <span className="block whitespace-nowrap">
      <span className="text-muted">{label}</span> <span className="font-mono">{value}</span>
    </span>
  );
}

// -----------------------------------------------------------------------------
// Exportação
// -----------------------------------------------------------------------------

async function ExportTab({ ctx, params }: TabProps) {
  let data;
  try {
    const [rows, k] = await Promise.all([
      listExportOrders(ctx, { situation: params.situacao, country: params.pais, due: params.due, from: params.de, to: params.ate, q: params.q }),
      exportIndicators(ctx),
    ]);
    data = { rows, k };
  } catch (error) {
    return <LoadError error={error} tab="exportacao" />;
  }
  const { rows, k } = data;
  const countries = [...new Set(rows.map((r) => r.destination_country).filter(Boolean) as string[])].sort();
  if (params.pais && !countries.includes(params.pais.toUpperCase())) countries.push(params.pais.toUpperCase());
  const kpis: Kpi[] = [
    { key: "open", label: "Pedidos em aberto", value: k.open, definition: "Pedidos de exportação ainda não expedidos (exclui cancelados)." },
    {
      key: "packing",
      label: "Montando volumes",
      value: k.packing,
      tone: k.packing ? "warning" : "default",
      definition: "Pedidos separados cujo packing list ainda não foi fechado. Sem packing list fechado o pedido não é expedido.",
      href: "/comex?aba=exportacao&situacao=packing",
    },
    {
      key: "due",
      label: "Sem DU-E",
      value: k.withoutDue,
      tone: k.withoutDue ? "warning" : "default",
      definition: "Pedidos de exportação em aberto sem o número da RE/DU-E informado.",
      href: "/comex?aba=exportacao&due=without",
    },
    { key: "shipped", label: "Expedidos no mês", value: k.shippedThisMonth, tone: "success", definition: "Pedidos de exportação expedidos no mês corrente." },
  ];
  const hasFilters = Boolean(params.situacao || params.pais || params.due || params.de || params.ate || params.q);
  const printable = rows.filter((r) => r.packages > 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} />
        ))}
      </div>
      <Card>
        <CardHeader
          title="Pedidos de exportação"
          description="Pedidos de saída marcados como exportação. Volumes, packing list e estufagem são registrados no detalhe da separação."
        />
        <FilterBar resetHref="/comex?aba=exportacao">
          <input type="hidden" name="aba" value="exportacao" />
          <FilterField label="Buscar" className="w-full sm:w-64">
            <Input name="q" defaultValue={params.q} placeholder="Pedido, cliente, invoice, DU-E, contêiner" />
          </FilterField>
          <FilterField label="Situação">
            <Select
              name="situacao"
              defaultValue={params.situacao}
              placeholder="Todas"
              options={EXPORT_SITUATIONS.map((s) => ({ value: s, label: EXPORT_SITUATION_LABELS[s].label }))}
            />
          </FilterField>
          <FilterField label="DU-E" className="w-full sm:w-36">
            <Select
              name="due"
              defaultValue={params.due}
              placeholder="Todos"
              options={[
                { value: "with", label: "Informada" },
                { value: "without", label: "Sem DU-E" },
              ]}
            />
          </FilterField>
          <FilterField label="Destino" className="w-full sm:w-32">
            <Select name="pais" defaultValue={params.pais?.toUpperCase()} placeholder="Todos" options={countries.map((c) => ({ value: c, label: c }))} />
          </FilterField>
          <FilterField label="Criado de" className="w-[calc(50%-6px)] sm:w-40">
            <Input type="date" name="de" defaultValue={params.de} />
          </FilterField>
          <FilterField label="até" className="w-[calc(50%-6px)] sm:w-40">
            <Input type="date" name="ate" defaultValue={params.ate} />
          </FilterField>
        </FilterBar>
        {rows.length ? (
          <form method="get" action="/etiquetas/packing-list/lote" target="_blank">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
              <span className="text-xs text-muted">
                {printable.length} pedido(s) com volumes · marque e imprima os packing lists em lote
              </span>
              <button type="submit" className={buttonClass("secondary", "sm", "ml-auto")} disabled={!printable.length}>
                <Printer className="size-4" aria-hidden /> Imprimir packing lists
              </button>
            </div>
            <ExportTable rows={rows} />
          </form>
        ) : hasFilters ? (
          <EmptyState title="Nenhum pedido com esses filtros" description="Ajuste a busca ou limpe os filtros." />
        ) : (
          <EmptyState
            title="Nenhum pedido de exportação"
            description="Marque um pedido de saída como exportação no cartão “Exportação” do detalhe da separação."
            action={
              <ButtonLink href="/separacao" size="sm">
                Ir para separação
              </ButtonLink>
            }
          />
        )}
      </Card>
    </div>
  );
}

function ExportTable({ rows }: { rows: ExportOrderRow[] }) {
  return (
    <TableWrap>
      <table className="table-base">
        <thead>
          <tr>
            <th className="w-8">
              <span className="sr-only">Selecionar</span>
            </th>
            <th>Contêiner</th>
            <th>Pedido</th>
            <th>Situação</th>
            <th>Cliente / destino</th>
            <th>Documentos</th>
            <th className="num">Volumes</th>
            <th className="num">Peso bruto</th>
            <th>Imprimir</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.packages ? (
                  <input
                    type="checkbox"
                    name="ids"
                    value={r.id}
                    defaultChecked={r.situation === "packed" || r.situation === "stuffed"}
                    className="size-4 accent-[var(--color-action)]"
                    aria-label={`Incluir o packing list de ${r.code}`}
                  />
                ) : null}
              </td>
              <td>
                <ContainerMini load={containerLoad({ type: r.container_type, m3: r.cargo_m3, kg: r.gross_weight_kg })} pallet={r.pallet_type} />
              </td>
              <td>
                <Link href={`/separacao/${r.id}`} className="link font-mono">
                  {r.code}
                </Link>
                {r.is_demo ? <DemoBadge className="ml-2" /> : null}
                <span className="block text-xs text-muted">{r.warehouse_code}</span>
              </td>
              <td>
                <Badge tone={EXPORT_SITUATION_LABELS[r.situation].tone}>{EXPORT_SITUATION_LABELS[r.situation].label}</Badge>
                {r.shipped_at ? <span className="mt-0.5 block text-xs text-muted">{fmtDay(r.shipped_at)}</span> : null}
              </td>
              <td>
                <span className="block max-w-56 truncate">{r.customer_name}</span>
                <span className="block text-xs text-muted">
                  {r.destination_country ? <span className="font-mono">{r.destination_country}</span> : "—"}
                  {r.export_incoterm ? ` · ${r.export_incoterm}` : ""}
                </span>
              </td>
              <td className="text-xs">
                <DocLine label="Invoice" value={r.commercial_invoice} />
                {r.export_declaration ? <DocLine label="DU-E" value={r.export_declaration} /> : <Badge tone="warning">Sem DU-E</Badge>}
                <DocLine label="Contêiner" value={r.container_number} />
              </td>
              <td className="num">{r.packages || "—"}</td>
              <td className="num whitespace-nowrap">{r.gross_weight_kg ? `${fmtQty(r.gross_weight_kg)} kg` : "—"}</td>
              <td>
                {r.packages ? (
                  <span className="flex flex-wrap gap-1.5">
                    <Link href={`/etiquetas/packing-list/${r.id}`} className={buttonClass("ghost", "sm")}>
                      <PackageOpen className="size-4" aria-hidden /> Packing list
                    </Link>
                    <Link href={`/etiquetas/volumes/${r.id}`} className={buttonClass("ghost", "sm")}>
                      <Tag className="size-4" aria-hidden /> Etiquetas
                    </Link>
                  </span>
                ) : (
                  <span className="text-xs text-muted">Sem volumes</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
