import { requireCtx } from "@/server/auth/session";
import { getPackingList, type PackingList } from "@/server/services/comex";
import { PrintToolbar } from "@/components/labels/print-toolbar";
import { PackingListDocument } from "@/components/labels/packing-list-document";
import { EmptyState } from "@/components/ui/empty-state";
import { isUuid, type SearchParams } from "@/lib/params";

export const metadata = { title: "Packing lists em lote" };

/** Impressão em lote dos packing lists selecionados na aba Comex (um por página A4). */
export default async function PackingListBatchPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).ids;
  const ctx = await requireCtx();
  // aceita ?ids=a&ids=b (formulário com caixas de seleção) e ?ids=a,b
  const ids = [...new Set((Array.isArray(raw) ? raw : [raw ?? ""]).flatMap((v) => v.split(",")).filter(isUuid))].slice(0, 50);
  const lists: PackingList[] = [];
  for (const id of ids) {
    const list = await getPackingList(ctx, id);
    if (list?.order.is_export && list.packages.length) lists.push(list);
  }
  return (
    <>
      <PrintToolbar backHref="/comex?aba=exportacao" title="Packing lists em lote" count={lists.length} />
      {lists.length ? (
        lists.map((list, i) => <PackingListDocument key={list.order.id} list={list} className={i < lists.length - 1 ? "label-break mb-6" : ""} />)
      ) : (
        <div className="mx-auto max-w-xl rounded-lg bg-surface">
          <EmptyState title="Nenhum packing list para imprimir" description="Selecione pedidos de exportação com volumes montados na aba Comex." />
        </div>
      )}
    </>
  );
}
