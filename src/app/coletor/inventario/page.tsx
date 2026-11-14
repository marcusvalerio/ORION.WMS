import Link from "next/link";
import { requireCtx } from "@/server/auth/session";
import { listCountingInventories } from "@/server/services/collector";

export const metadata = { title: "Inventário" };

export default async function CollectorInventories() {
  const ctx = await requireCtx();
  const counts = await listCountingInventories(ctx);
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Contagem de inventário</h1>
      {counts.length === 0 ? <p className="rounded-xl border-2 border-line-strong bg-surface p-4 text-lg">Nenhum inventário em contagem.</p> : null}
      {counts.map((c) => (
        <Link key={c.id} href={`/coletor/inventario/${c.id}`} className="block rounded-xl border-2 border-fg bg-surface p-4 active:bg-line">
          <span className="block font-mono text-xl font-bold">{c.code}</span>
          <span className="block text-base text-fg-2">
            {c.count_type === "general" ? "Geral" : "Rotativo"} · {c.warehouse_code}
            {c.scope ? ` · ${c.scope}` : ""}
          </span>
          <span className="block text-base font-semibold">
            {c.counted} de {c.items} item(ns) contado(s)
          </span>
        </Link>
      ))}
    </div>
  );
}
