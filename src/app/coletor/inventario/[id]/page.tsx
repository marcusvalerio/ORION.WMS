import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/session";
import { getInventory } from "@/server/services/inventory";
import { CountRunner } from "@/components/collector/count-runner";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/params";

export const metadata = { title: "Contagem" };

export default async function CollectorCount({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireCtx();
  const inv = await getInventory(ctx, id);
  if (!inv) notFound();
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">Contagem</h1>
        <span className="font-mono text-lg text-slate-700">{inv.code}</span>
      </div>
      {inv.status !== "counting" ? (
        <p className="rounded-xl bg-slate-900 p-4 text-lg font-semibold text-white">Este inventário não está em contagem.</p>
      ) : !can(ctx.user.role, "inventory.count") ? (
        <p className="rounded-xl bg-red-600 p-4 text-lg font-semibold text-white">Você não tem permissão para contar.</p>
      ) : (
        <CountRunner inventoryId={inv.id} inventoryCode={inv.code} />
      )}
      <p className="text-center text-base text-slate-700">A submissão para aprovação é feita na tela de inventário do sistema.</p>
      <Link href="/coletor/inventario" className="block py-3 text-center text-lg font-semibold underline">
        Voltar aos inventários
      </Link>
    </div>
  );
}
