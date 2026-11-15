import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingBars, Notice, SuccessHero } from "@/components/ui/states";
import { ConfirmDemo } from "./confirm-demo";

export const metadata = { title: "Estados do sistema" };

/** Catálogo dos estados reutilizáveis (referência para quem constrói telas). */
export default async function EstadosPage() {
  await requireCtx();
  return (
    <>
      <PageHeader
        title="Estados do sistema"
        description="Vazio, carregando, erro, avisos, confirmação destrutiva e sucesso — os mesmos componentes usados nas telas."
        breadcrumbs={[{ label: "Sobre", href: "/sobre" }, { label: "Estados" }]}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <p className="px-5 pt-4 text-xs font-semibold text-muted">Vazio</p>
          <EmptyState
            title="Nenhum recebimento hoje"
            description="Quando chegar uma nota ou um pedido de compra, ele aparece aqui."
            action={
              <Link href="/docas" className={buttonClass("primary", "md", "rounded-full")}>
                Agendar recebimento
              </Link>
            }
          />
        </Card>
        <Card>
          <p className="px-5 pt-4 text-xs font-semibold text-muted">Carregando</p>
          <LoadingBars label="Buscando o estoque do CD…" skeleton className="px-5 py-8" />
        </Card>
        <Card>
          <p className="px-5 pt-4 text-xs font-semibold text-muted">Erro</p>
          <ErrorState
            title="Não conseguimos falar com o ATLAS"
            description="Os dados da empresa podem estar desatualizados. O armazém continua funcionando normalmente."
            actions={
              <>
                <span className={buttonClass("primary", "md", "rounded-full")}>Tentar de novo</span>
                <Link href="/integracao" className={buttonClass("secondary", "md", "rounded-full")}>
                  Ver detalhes
                </Link>
              </>
            }
          />
        </Card>
        <Card className="space-y-3 p-5">
          <p className="text-xs font-semibold text-muted">Avisos</p>
          <Notice tone="neutral" action={<span className="text-ceu-400">Desfazer</span>}>
            Contagem de <span className="font-mono whitespace-nowrap">ARM-02-07-02</span> confirmada
          </Notice>
          <Notice tone="warn">
            Lote <span className="font-mono whitespace-nowrap">L2410</span> vence em 12 dias
          </Notice>
          <Notice tone="crit" action="Recontar">
            Divergência de 2 un em <span className="font-mono whitespace-nowrap">ARM-02-03-04</span>
          </Notice>
          <Notice tone="info">Pedido sincronizado com o ATLAS</Notice>
        </Card>
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="text-xs font-semibold text-muted">Confirmação destrutiva</p>
          <p className="text-sm text-fg-2">Todas as ações com confirmação (cancelar recebimento, onda, devolução, descartar NF-e…) usam este diálogo.</p>
          <ConfirmDemo />
        </Card>
        <SuccessHero
          value="98,4%"
          title="Inventário concluído"
          detail="+1,2 pp sobre o ciclo anterior · 340 endereços · 7 ajustes"
          action={
            <Link href="/inventario" className="inline-flex h-10 items-center rounded-full bg-creme-100 px-5 text-sm font-semibold text-noite-900">
              Ver relatório
            </Link>
          }
        />
      </div>
    </>
  );
}
