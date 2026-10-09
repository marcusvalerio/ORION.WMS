import "server-only";
import type { Ctx } from "../context";
import { can } from "@/lib/permissions";

/**
 * Indicadores do dashboard. Todos são calculados em tempo real a partir dos
 * registros operacionais; a definição de cálculo acompanha cada valor.
 */
export interface Kpi {
  key: string;
  label: string;
  value: number;
  format?: "int" | "percent" | "qty";
  hint?: string;
  definition: string;
  href?: string;
  tone?: "default" | "warning" | "danger" | "success";
}

export async function getKpis(ctx: Ctx): Promise<Kpi[]> {
  const [r] = await ctx.db.query<{
    products: number;
    active_locations: number;
    total_locations: number;
    capacity: number;
    occupied: number;
    receipts_expected: number;
    receipts_checking: number;
    putaway_qty: number;
    putaway_tasks: number;
    open_tasks: number;
    blocked_products: number;
    blocked_qty: number;
    orders_to_pick: number;
    orders_shipped: number;
    shipped_30d: number;
    open_divergences: number;
  }>(
    `select
      (select count(*) from erp.products where company_id = $1 and status = 'active') as products,
      (select count(*) from wms.locations where company_id = $1 and status = 'active') as active_locations,
      (select count(*) from wms.locations where company_id = $1) as total_locations,
      coalesce((select sum(l.capacity_units) from wms.locations l join wms.zones z on z.id = l.zone_id
                where l.company_id = $1 and l.status <> 'inactive' and z.zone_type in ('storage', 'picking')), 0) as capacity,
      coalesce((select sum(b.quantity) from wms.stock_balances b join wms.locations l on l.id = b.location_id
                join wms.zones z on z.id = l.zone_id where b.company_id = $1 and z.zone_type in ('storage', 'picking')), 0) as occupied,
      (select count(*) from wms.receipts where company_id = $1 and status = 'expected') as receipts_expected,
      (select count(*) from wms.receipts where company_id = $1 and status = 'checking') as receipts_checking,
      coalesce((select sum(t.quantity) from wms.tasks t where t.company_id = $1 and t.task_type = 'putaway'
                and t.status in ('pending', 'in_progress')), 0) as putaway_qty,
      (select count(*) from wms.tasks t where t.company_id = $1 and t.task_type = 'putaway' and t.status in ('pending', 'in_progress')) as putaway_tasks,
      (select count(*) from wms.tasks where company_id = $1 and status in ('pending', 'in_progress')) as open_tasks,
      (select count(distinct b.product_id) from wms.stock_balances b join wms.locations l on l.id = b.location_id
       where b.company_id = $1 and b.quantity > 0 and (b.blocked_qty > 0 or l.status = 'blocked')) as blocked_products,
      coalesce((select sum(b.blocked_qty) from wms.stock_balances b where b.company_id = $1), 0) as blocked_qty,
      (select count(*) from wms.outbound_orders where company_id = $1 and status in ('open', 'reserved', 'picking')) as orders_to_pick,
      (select count(*) from wms.outbound_orders where company_id = $1 and status = 'shipped') as orders_shipped,
      (select count(*) from wms.outbound_orders where company_id = $1 and status = 'shipped' and shipped_at >= now() - interval '30 days') as shipped_30d,
      (select count(*) from wms.divergences where company_id = $1 and status = 'open') as open_divergences`,
    [ctx.user.companyId],
  );
  const occupancy = r.capacity > 0 ? (r.occupied / r.capacity) * 100 : 0;
  return [
    {
      key: "products",
      label: "Produtos ativos",
      value: r.products,
      definition: "Quantidade de produtos com status ativo no cadastro do ERP.",
      href: "/produtos",
    },
    {
      key: "locations",
      label: "Endereços ativos",
      value: r.active_locations,
      hint: `de ${r.total_locations} cadastrados`,
      definition: "Endereços com status 'ativo' (exclui bloqueados e inativos).",
      href: "/armazem/enderecos?status=active",
    },
    {
      key: "occupancy",
      label: "Ocupação do armazém",
      value: occupancy,
      format: "percent",
      hint: `${r.occupied} de ${r.capacity} un`,
      definition:
        "Soma do estoque físico em zonas de armazenagem/picking ÷ soma da capacidade (un) dos endereços não inativos dessas zonas.",
      href: "/armazem/estrutura",
      tone: occupancy > 90 ? "danger" : occupancy > 75 ? "warning" : "default",
    },
    {
      key: "receipts_expected",
      label: "Recebimentos pendentes",
      value: r.receipts_expected,
      definition: "Recebimentos com status 'previsto' (ainda sem início de conferência).",
      href: "/recebimentos?status=expected",
    },
    {
      key: "receipts_checking",
      label: "Em conferência",
      value: r.receipts_checking,
      definition: "Recebimentos com conferência iniciada e não finalizada.",
      href: "/recebimentos?status=checking",
    },
    {
      key: "putaway",
      label: "Aguardando armazenagem",
      value: r.putaway_qty,
      format: "qty",
      hint: `${r.putaway_tasks} tarefa(s)`,
      definition: "Soma das quantidades em tarefas de armazenagem pendentes ou em execução (já liberadas, ainda fora do estoque).",
      href: "/armazenagem",
      tone: r.putaway_tasks > 0 ? "warning" : "default",
    },
    {
      key: "open_tasks",
      label: "Tarefas pendentes",
      value: r.open_tasks,
      definition: "Tarefas operacionais com status 'pendente' ou 'em execução', de todos os tipos.",
      href: "/tarefas?status=pending,in_progress",
    },
    {
      key: "blocked",
      label: "Produtos bloqueados",
      value: r.blocked_products,
      hint: `${r.blocked_qty} un bloqueadas`,
      definition: "Produtos distintos com saldo bloqueado ou armazenados em endereço bloqueado.",
      href: "/estoque?status=blocked",
      tone: r.blocked_products > 0 ? "warning" : "default",
    },
    {
      key: "orders_to_pick",
      label: "Pedidos a separar",
      value: r.orders_to_pick,
      definition: "Pedidos de saída com status aberto, reservado ou em separação.",
      href: "/separacao",
    },
    {
      key: "orders_shipped",
      label: "Pedidos expedidos",
      value: r.orders_shipped,
      hint: `${r.shipped_30d} nos últimos 30 dias`,
      definition: "Pedidos de saída com expedição confirmada (total histórico).",
      href: "/expedicao",
      tone: "success",
    },
    {
      key: "divergences",
      label: "Divergências em aberto",
      value: r.open_divergences,
      definition: "Divergências de recebimento, separação, conferência ou inventário ainda não tratadas.",
      href: "/divergencias?status=open",
      tone: r.open_divergences > 0 ? "danger" : "default",
    },
  ];
}

export async function getFlowSeries(ctx: Ctx, days = 14) {
  return ctx.db.query<{ day: string; received: number; shipped: number }>(
    `select d::date::text as day,
            coalesce((select sum(quantity) from wms.stock_movements m where m.company_id = $1 and m.movement_type = 'putaway'
                      and m.created_at::date = d::date), 0) as received,
            coalesce((select sum(quantity) from wms.stock_movements m where m.company_id = $1 and m.movement_type = 'shipment'
                      and m.created_at::date = d::date), 0) as shipped
     from generate_series(current_date - ($2::int - 1), current_date, interval '1 day') d
     order by d`,
    [ctx.user.companyId, days],
  );
}

export async function getTaskDistribution(ctx: Ctx) {
  return ctx.db.query<{ status: string; task_type: string; n: number }>(
    `select status, task_type, count(*) as n from wms.tasks where company_id = $1 group by status, task_type`,
    [ctx.user.companyId],
  );
}

export interface Alert {
  level: "danger" | "warning" | "info";
  title: string;
  detail: string;
  href: string;
}

export async function getAlerts(ctx: Ctx): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const expiring = await ctx.db.query<{ sku: string; location: string; expiry: string; quantity: number; expired: boolean }>(
    `select p.sku, l.code as location, b.expiry_date::text as expiry, b.quantity, b.expiry_date < current_date as expired
     from wms.stock_balances b join erp.products p on p.id = b.product_id join wms.locations l on l.id = b.location_id
     where b.company_id = $1 and b.quantity > 0 and b.expiry_date is not null and b.expiry_date <= current_date + 30
     order by b.expiry_date limit 5`,
    [ctx.user.companyId],
  );
  for (const e of expiring) {
    alerts.push({
      level: e.expired ? "danger" : "warning",
      title: e.expired ? `${e.sku} vencido` : `${e.sku} vence em breve`,
      detail: `${e.quantity} un em ${e.location} — validade ${e.expiry}`,
      href: `/estoque?q=${encodeURIComponent(e.sku)}`,
    });
  }
  const full = await ctx.db.query<{ code: string; pct: number }>(
    `select l.code, round(100 * sum(b.quantity) / l.capacity_units) as pct
     from wms.locations l join wms.stock_balances b on b.location_id = l.id
     where l.company_id = $1 group by l.id having sum(b.quantity) / l.capacity_units >= 0.9 order by pct desc limit 3`,
    [ctx.user.companyId],
  );
  for (const f of full) {
    alerts.push({ level: "warning", title: `Endereço ${f.pct}% ocupado`, detail: f.code, href: "/armazem/enderecos?occupancy=full" });
  }
  const [noSuggestion] = await ctx.db.query<{ n: number }>(
    `select count(*) as n from wms.tasks where company_id = $1 and task_type = 'putaway' and status in ('pending', 'in_progress')
     and suggested_location_id is null`,
    [ctx.user.companyId],
  );
  if (noSuggestion.n > 0) {
    alerts.push({
      level: "danger",
      title: `${noSuggestion.n} armazenagem(ns) sem endereço elegível`,
      detail: "Não há posição compatível com capacidade. Revise a estrutura ou a classe do produto.",
      href: "/armazenagem",
    });
  }
  const [stale] = await ctx.db.query<{ n: number }>(
    `select count(*) as n from wms.tasks where company_id = $1 and status in ('pending', 'in_progress') and created_at < now() - interval '24 hours'`,
    [ctx.user.companyId],
  );
  if (stale.n > 0) {
    alerts.push({ level: "warning", title: `${stale.n} tarefa(s) abertas há mais de 24h`, detail: "Possível gargalo operacional.", href: "/tarefas?sort=created" });
  }
  const [div] = await ctx.db.query<{ n: number }>(`select count(*) as n from wms.divergences where company_id = $1 and status = 'open'`, [
    ctx.user.companyId,
  ]);
  if (div.n > 0) {
    alerts.push({ level: "info", title: `${div.n} divergência(s) aguardando tratamento`, detail: "Faltas, sobras, avarias ou diferenças de contagem.", href: "/divergencias?status=open" });
  }
  const [pendingEvents] = await ctx.db.query<{ n: number }>(
    `select count(*) as n from wms.integration_events where company_id = $1 and status = 'pending'`,
    [ctx.user.companyId],
  );
  if (pendingEvents.n > 0 && can(ctx.user.role, "audit.view")) {
    alerts.push({
      level: "info",
      title: `${pendingEvents.n} evento(s) de integração na fila`,
      detail: "Aguardando conector de envio ao ERP externo (outbox).",
      href: "/auditoria?tab=integracao",
    });
  }
  return alerts;
}

export async function getRecentActivity(ctx: Ctx) {
  return ctx.db.query<{ id: string; created_at: string; movement_type: string; sku: string; quantity: number; reference_code: string | null; user_name: string; from_code: string | null; to_code: string | null }>(
    `select m.id, m.created_at::text as created_at, m.movement_type, p.sku, m.quantity, m.reference_code, u.name as user_name,
            lf.code as from_code, lt.code as to_code
     from wms.stock_movements m join erp.products p on p.id = m.product_id join wms.users u on u.id = m.created_by
     left join wms.locations lf on lf.id = m.from_location_id left join wms.locations lt on lt.id = m.to_location_id
     where m.company_id = $1 order by m.created_at desc, m.id limit 8`,
    [ctx.user.companyId],
  );
}

/** Indicadores de desempenho operacional (página Indicadores). */
export async function getPerformance(ctx: Ctx) {
  const [r] = await ctx.db.query<{
    avg_dock_to_stock_h: number | null;
    avg_pick_cycle_h: number | null;
    pick_tasks: number;
    short_picks: number;
    receipt_lines: number;
    receipt_lines_divergent: number;
    inventory_items: number;
    inventory_items_exact: number;
    tasks_completed_7d: number;
  }>(
    `select
      (select avg(extract(epoch from (r.completed_at - r.arrived_at)) / 3600) from wms.receipts r
       where r.company_id = $1 and r.status = 'completed' and r.arrived_at is not null) as avg_dock_to_stock_h,
      (select avg(extract(epoch from (o.shipped_at - o.reserved_at)) / 3600) from wms.outbound_orders o
       where o.company_id = $1 and o.status = 'shipped' and o.reserved_at is not null) as avg_pick_cycle_h,
      (select count(*) from wms.tasks where company_id = $1 and task_type = 'picking' and status = 'completed') as pick_tasks,
      (select count(*) from wms.divergences where company_id = $1 and divergence_type = 'short_pick') as short_picks,
      (select count(*) from wms.receipt_items i join wms.receipts r on r.id = i.receipt_id
       where r.company_id = $1 and r.status in ('checked', 'released', 'completed')) as receipt_lines,
      (select count(distinct d.receipt_item_id) from wms.divergences d where d.company_id = $1 and d.source = 'receipt'
       and d.receipt_item_id is not null) as receipt_lines_divergent,
      (select count(*) from wms.inventory_count_items i join wms.inventory_counts c on c.id = i.inventory_id
       where c.company_id = $1 and c.status in ('submitted', 'approved')) as inventory_items,
      (select count(*) from wms.inventory_count_items i join wms.inventory_counts c on c.id = i.inventory_id
       where c.company_id = $1 and c.status in ('submitted', 'approved') and i.counted_qty = i.expected_qty) as inventory_items_exact,
      (select count(*) from wms.tasks where company_id = $1 and status = 'completed' and completed_at >= now() - interval '7 days') as tasks_completed_7d`,
    [ctx.user.companyId],
  );
  const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);
  return [
    {
      label: "Dock-to-stock médio",
      value: r.avg_dock_to_stock_h,
      unit: "h",
      definition: "Média do tempo entre a chegada física e a conclusão da armazenagem de recebimentos concluídos.",
    },
    {
      label: "Ciclo de pedido (reserva → expedição)",
      value: r.avg_pick_cycle_h,
      unit: "h",
      definition: "Média do tempo entre a reserva e a confirmação de expedição dos pedidos expedidos.",
    },
    {
      label: "Acuracidade de separação",
      value: pct(r.pick_tasks - r.short_picks, r.pick_tasks),
      unit: "%",
      definition: "Tarefas de separação concluídas sem divergência de falta ÷ total de tarefas de separação concluídas.",
    },
    {
      label: "Recebimento sem divergência",
      value: pct(r.receipt_lines - r.receipt_lines_divergent, r.receipt_lines),
      unit: "%",
      definition: "Linhas de recebimento conferidas sem falta, sobra, avaria ou retenção ÷ total de linhas conferidas.",
    },
    {
      label: "Acuracidade de inventário",
      value: pct(r.inventory_items_exact, r.inventory_items),
      unit: "%",
      definition: "Itens contados iguais ao saldo esperado ÷ total de itens contados em inventários submetidos ou aprovados.",
    },
    {
      label: "Tarefas concluídas (7 dias)",
      value: r.tasks_completed_7d,
      unit: "",
      definition: "Quantidade de tarefas concluídas nos últimos 7 dias, todos os tipos.",
    },
  ];
}
