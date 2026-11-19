import Link from "next/link";
import { ClipboardList, ListTodo, Monitor, Search } from "lucide-react";
import { requireCtx } from "@/server/auth/session";
import { listCollectorTasks, listCountingInventories } from "@/server/services/collector";
import { can } from "@/lib/permissions";

export const metadata = { title: "Menu" };

export default async function CollectorHome() {
  const ctx = await requireCtx();
  const canTasks = can(ctx.user.role, "task.execute");
  const canCount = can(ctx.user.role, "inventory.count");
  const [tasks, counts] = await Promise.all([
    canTasks ? listCollectorTasks(ctx) : Promise.resolve([]),
    canCount ? listCountingInventories(ctx) : Promise.resolve([]),
  ]);
  const items = [
    canTasks && { href: "/coletor/tarefas", label: "Minhas tarefas", detail: `${tasks.length} aberta(s)`, Icon: ListTodo },
    canCount && { href: "/coletor/inventario", label: "Contagem de inventário", detail: `${counts.length} em contagem`, Icon: ClipboardList },
    { href: "/coletor/consulta", label: "Consulta rápida", detail: "Endereço ou produto", Icon: Search },
  ].filter(Boolean) as { href: string; label: string; detail: string; Icon: typeof ListTodo }[];
  return (
    <div className="space-y-3">
      <h1 className="sr-only">Menu do coletor</h1>
      {items.map(({ href, label, detail, Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex min-h-20 items-center gap-4 rounded-xl border-2 border-fg bg-surface px-4 py-3 active:bg-line"
        >
          <Icon className="size-9 shrink-0 text-link" aria-hidden />
          <span>
            <span className="block text-xl font-bold">{label}</span>
            <span className="block text-base text-fg-2">{detail}</span>
          </span>
        </Link>
      ))}
      <Link href="/painel" className="flex min-h-14 items-center justify-center gap-2 rounded-xl px-4 text-lg font-semibold text-fg-2 underline">
        <Monitor className="size-5" aria-hidden />
        Abrir o sistema completo
      </Link>
    </div>
  );
}
