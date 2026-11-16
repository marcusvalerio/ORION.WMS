import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getPackingList } from "@/server/services/comex";
import { PrintToolbar } from "@/components/labels/print-toolbar";
import { PackingListDocument } from "@/components/labels/packing-list-document";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Packing list" };

/** Packing list bilíngue (PT/EN) por volume, para impressão em A4. */
export default async function PackingListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const list = await getPackingList(ctx, id);
  if (!list || !list.order.is_export) notFound();
  const { order, packages } = list;

  return (
    <>
      <PrintToolbar backHref={`/separacao/${id}`} title={`Packing list — ${order.code}`} count={packages.length} />
      <PackingListDocument list={list} />
    </>
  );
}
