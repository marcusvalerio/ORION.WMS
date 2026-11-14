import "server-only";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError } from "../errors";
import { warehouseScope } from "../access";
import { TASK_TYPES, type TaskType } from "./tasks";

/**
 * Produtividade por operador, calculada dos registros operacionais:
 *  - tarefas concluídas por tipo e tempo médio (wms.tasks: completed_by, started_at → completed_at);
 *  - unidades movimentadas (wms.stock_movements do usuário: armazenagem, transferência, separação e expedição);
 *  - itens separados (quantidade confirmada nas tarefas de separação concluídas);
 *  - linhas conferidas (itens de recebimento e de inventário contados pelo usuário);
 *  - acuracidade de separação (tarefas de separação concluídas sem divergência registrada).
 * O período é por data (inclusive) e o filtro de depósito respeita o acesso do usuário.
 */
export interface ProductivityFilters {
  from?: string | null;
  to?: string | null;
  warehouseId?: string | null;
  userId?: string | null;
}

export interface ProductivityRow {
  user_id: string;
  user_name: string;
  role: string;
  active: boolean;
  tasks_total: number;
  tasks_by_type: Record<TaskType, number>;
  avg_task_seconds: number | null;
  units_moved: number;
  units_picked: number;
  picks_total: number;
  picks_accurate: number;
  accuracy: number | null;
  lines_checked: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function defaultPeriod(today = new Date()): { from: string; to: string } {
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

export async function productivityByUser(ctx: Ctx, f: ProductivityFilters = {}) {
  assertCan(ctx, "productivity.view");
  const period = { ...defaultPeriod(), ...Object.fromEntries(Object.entries({ from: f.from, to: f.to }).filter(([, v]) => v)) } as {
    from: string;
    to: string;
  };
  if (!DATE.test(period.from) || !DATE.test(period.to)) throw new DomainError("Período inválido (use AAAA-MM-DD).", "VALIDATION");
  if (period.from > period.to) throw new DomainError("A data inicial deve ser anterior à final.", "VALIDATION");

  // $1 empresa, $2 início, $3 fim, $4 depósito (opcional), $5 usuário (opcional); depois o escopo de acesso.
  const base = [ctx.user.companyId, period.from, period.to, f.warehouseId || null, f.userId || null];
  const run = async <T,>(build: (scope: (col: string) => string) => string) => {
    const params: unknown[] = [...base];
    const sql = build((col) => `and ($4::uuid is null or ${col} = $4::uuid)${warehouseScope(ctx, col, params)}`);
    return ctx.db.query<T>(sql, params);
  };
  const inPeriod = (col: string) => `${col} >= $2::date and ${col} < ($3::date + 1)`;
  const forUser = (col: string) => `and ($5::uuid is null or ${col} = $5::uuid)`;

  const [users, tasks, avg, moved, picks, lines] = await Promise.all([
    ctx.db.query<{ id: string; name: string; role: string; active: boolean }>(
      `select id, name, role, active from wms.users where company_id = $1 and ($2::uuid is null or id = $2::uuid) order by name`,
      [ctx.user.companyId, f.userId || null],
    ),
    run<{ user_id: string; task_type: TaskType; n: number }>(
      (wh) => `select t.completed_by as user_id, t.task_type, count(*)::int as n from wms.tasks t
       where t.company_id = $1 and t.status = 'completed' and ${inPeriod("t.completed_at")} ${forUser("t.completed_by")} ${wh("t.warehouse_id")}
       group by t.completed_by, t.task_type`,
    ),
    run<{ user_id: string; seconds: number | null }>(
      (wh) => `select t.completed_by as user_id, avg(extract(epoch from (t.completed_at - t.started_at)))::float8 as seconds from wms.tasks t
       where t.company_id = $1 and t.status = 'completed' and t.started_at is not null and ${inPeriod("t.completed_at")}
       ${forUser("t.completed_by")} ${wh("t.warehouse_id")}
       group by t.completed_by`,
    ),
    run<{ user_id: string; units: number }>(
      (wh) => `select m.created_by as user_id, sum(m.quantity) as units from wms.stock_movements m
       where m.company_id = $1 and m.movement_type in ('putaway', 'transfer', 'pick', 'shipment') and ${inPeriod("m.created_at")}
       ${forUser("m.created_by")} ${wh("m.warehouse_id")}
       group by m.created_by`,
    ),
    run<{ user_id: string; units: number; total: number; accurate: number }>(
      (wh) => `select t.completed_by as user_id, coalesce(sum(t.confirmed_qty), 0) as units, count(*)::int as total,
              count(*) filter (where not exists (select 1 from wms.divergences d where d.task_id = t.id)
                                 and coalesce(t.confirmed_qty, 0) = t.quantity)::int as accurate
       from wms.tasks t
       where t.company_id = $1 and t.task_type = 'picking' and t.status = 'completed' and ${inPeriod("t.completed_at")}
       ${forUser("t.completed_by")} ${wh("t.warehouse_id")}
       group by t.completed_by`,
    ),
    run<{ user_id: string; n: number }>(
      (wh) => `select user_id, sum(n)::int as n from (
         select i.counted_by as user_id, count(*) as n from wms.receipt_items i join wms.receipts r on r.id = i.receipt_id
         where r.company_id = $1 and i.counted_by is not null and ${inPeriod("i.counted_at")} ${forUser("i.counted_by")} ${wh("r.warehouse_id")}
         group by i.counted_by
         union all
         select i.counted_by, count(*) from wms.inventory_count_items i join wms.inventory_counts c on c.id = i.inventory_id
         where c.company_id = $1 and i.counted_by is not null and ${inPeriod("i.counted_at")} ${forUser("i.counted_by")} ${wh("c.warehouse_id")}
         group by i.counted_by
       ) x group by user_id`,
    ),
  ]);

  const rows: ProductivityRow[] = users.map((u) => {
    const byType = Object.fromEntries(TASK_TYPES.map((t) => [t, 0])) as Record<TaskType, number>;
    for (const t of tasks.filter((x) => x.user_id === u.id)) byType[t.task_type] = Number(t.n);
    const pick = picks.find((p) => p.user_id === u.id);
    const picksTotal = Number(pick?.total ?? 0);
    const picksAccurate = Number(pick?.accurate ?? 0);
    const seconds = avg.find((a) => a.user_id === u.id)?.seconds;
    return {
      user_id: u.id,
      user_name: u.name,
      role: u.role,
      active: u.active,
      tasks_total: Object.values(byType).reduce((a, b) => a + b, 0),
      tasks_by_type: byType,
      avg_task_seconds: seconds === null || seconds === undefined ? null : Number(seconds),
      units_moved: Number(moved.find((m) => m.user_id === u.id)?.units ?? 0),
      units_picked: Number(pick?.units ?? 0),
      picks_total: picksTotal,
      picks_accurate: picksAccurate,
      accuracy: picksTotal ? picksAccurate / picksTotal : null,
      lines_checked: Number(lines.find((l) => l.user_id === u.id)?.n ?? 0),
    };
  });
  // Mostra quem teve atividade no período; usuários sem registro só quando filtrados.
  const active = rows.filter((r) => f.userId || r.tasks_total || r.units_moved || r.lines_checked);
  active.sort((a, b) => b.tasks_total - a.tasks_total || b.units_moved - a.units_moved || a.user_name.localeCompare(b.user_name));
  return { period, rows: active };
}

/** Duração legível em pt-BR (ex.: "1 h 05 min", "12 min", "45 s"). */
export function fmtDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}
