/**
 * CONCORRÊNCIA multiempresa: os 49 funcionários das 5 empresas trabalhando ao
 * mesmo tempo (Promise.all) — recebimento/armazenagem, reservas e separações,
 * transferências e ajustes disputando o MESMO saldo, dois supervisores
 * reservando o MESMO pedido, vários operadores tentando concluir a MESMA tarefa,
 * contagens de inventário em paralelo e leituras do auditor.
 *
 * Invariantes verificadas ao final, por empresa:
 *  - nenhum saldo negativo; reservado + bloqueado ≤ físico;
 *  - Σ entradas − Σ saídas das movimentações = saldo de cada endereço/produto/lote;
 *  - reserva por linha de pedido ≤ quantidade pedida (sem reserva duplicada);
 *  - cada tarefa concluída no máximo uma vez (eventos e movimentações);
 *  - nenhuma FK, movimentação ou auditoria cruzando empresas;
 *  - todo erro é DomainError com mensagem (nenhum erro inesperado/deadlock).
 *
 * Banco: PGlite em memória por padrão (uma conexão: as transações se intercalam
 * por operação, sem paralelismo real). Para concorrência REAL no PostgreSQL:
 *   TEST_DATABASE_URL=postgres://usuario:senha@localhost:5432/banco_de_teste npx vitest run tests/multi-tenant-load.test.ts
 * ATENÇÃO: o banco indicado é APAGADO (schemas erp/wms) no início do teste.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "@/server/context";
import { DomainError } from "@/server/errors";
import { LOC, createMultiTenantEnv, crossTenantReferences, freshPostgres, type MultiTenantEnv, type Tenant } from "./fixtures/multi-tenant";
import * as receiving from "@/server/services/receiving";
import * as outbound from "@/server/services/outbound";
import * as tasks from "@/server/services/tasks";
import * as stock from "@/server/services/stock";
import * as inventory from "@/server/services/inventory";
import * as collector from "@/server/services/collector";
import * as dashboard from "@/server/services/dashboard";

const PG_URL = process.env.TEST_DATABASE_URL?.trim();
const ROUNDS = Number(process.env.LOAD_ROUNDS) || 6;

let env: MultiTenantEnv;
const ops = { total: 0, ok: 0, expected: 0 };
const expectedByCode = new Map<string, number>();
const unexpected: string[] = [];
let elapsedMs = 0;

/** Executa uma operação registrando o resultado: sucesso, recusa de negócio (DomainError) ou erro inesperado. */
async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  ops.total++;
  try {
    const v = await fn();
    ops.ok++;
    return v;
  } catch (e) {
    if (e instanceof DomainError && e.message.trim().length > 5) {
      ops.expected++;
      expectedByCode.set(e.code, (expectedByCode.get(e.code) ?? 0) + 1);
      return undefined;
    }
    const err = e as { code?: string; message?: string };
    unexpected.push(`${label}: [${err.code ?? "?"}] ${err.message ?? String(e)}`);
    return undefined;
  }
}

interface Plan {
  t: Tenant;
  orders: string[];
  putaways: string[];
}

async function prepare(t: Tenant): Promise<Plan> {
  const sup = t.supervisor;
  const op = t.operators[1];
  // recebimento conferido e liberado: gera tarefas de armazenagem para a disputa
  const rec = await receiving.createManualReceipt(sup, {
    warehouseId: t.warehouseId, supplierId: t.supplierId,
    items: [{ productId: t.products["SKU-001"], expectedQty: 60 }, { productId: t.products["SKU-002"], expectedQty: 40 }],
  });
  await receiving.startCheck(op, rec.id);
  const r = await receiving.getReceipt(op, rec.id);
  await receiving.saveCounts(op, rec.id, { items: r!.items.map((i) => ({ itemId: i.id, countedQty: i.expected_qty })) });
  await receiving.finishCheck(op, rec.id, {});
  await receiving.releaseReceipt(sup, rec.id);
  const putaways = (await sup.db.query<{ id: string }>(`select id from wms.tasks where receipt_id = $1 and task_type = 'putaway'`, [rec.id])).map((x) => x.id);
  // 4 pedidos de SKU-002 ainda não reservados (os supervisores disputam a reserva)
  const orders: string[] = [];
  for (let i = 0; i < 4; i++) {
    const o = await outbound.createManualOrder(sup, { warehouseId: t.warehouseId, customerName: `Cliente carga ${t.key}${i}`, lines: [{ productId: t.products["SKU-002"], quantity: 30 }] });
    orders.push(o.id);
  }
  return { t, orders, putaways };
}

/** Trabalho de cada funcionário conforme o perfil. */
function worker(plan: Plan, ctx: Ctx, index: number): Promise<void> {
  const { t } = plan;
  const role = ctx.user.role;
  const loc = (b: number, l: number) => t.locations[LOC(b, l)];
  return (async () => {
    if (role === "admin") {
      for (let i = 0; i < ROUNDS; i++) {
        // disputa o mesmo saldo (SKU-003 em MOD-01/NIV-01) com as transferências dos operadores
        await run("admin.ajuste-saida", () => stock.adjustStock(ctx, { locationId: loc(1, 1), productId: t.products["SKU-003"], direction: "out", quantity: 40, reason: "Ajuste concorrente da bateria" }));
        await run("admin.ajuste-entrada", () => stock.adjustStock(ctx, { locationId: loc(4, 1), productId: t.products["SKU-001"], direction: "in", quantity: 10, reason: "Ajuste concorrente da bateria" }));
      }
    } else if (role === "supervisor") {
      // os dois supervisores reservam e liberam os MESMOS pedidos, em ordens diferentes
      const order = index % 2 === 0 ? plan.orders : [...plan.orders].reverse();
      for (const o of order) {
        await run("sup.reservar", () => outbound.reserveOrder(ctx, o));
        await run("sup.liberar", () => outbound.releaseForPicking(ctx, o));
      }
    } else if (role === "operator") {
      for (let i = 0; i < ROUNDS; i++) {
        // transferência imediata disputando o mesmo saldo do administrador e dos colegas
        await run("op.transferir", () => tasks.createTransfer(ctx, { fromLocationId: loc(1, 1), productId: t.products["SKU-003"], quantity: 25, toLocationId: loc(3, 2), executeNow: "on" }));
        // todos tentam concluir as mesmas armazenagens
        for (const p of plan.putaways) await run("op.armazenar", () => tasks.completeTask(ctx, p, {}));
        // separações liberadas pelos supervisores: assumir (coletor) e concluir
        const open = await ctx.db.query<{ id: string }>(
          `select id from wms.tasks where company_id = $1 and task_type = 'picking' and status in ('pending', 'in_progress') and order_id = any($2::uuid[])`,
          [t.companyId, plan.orders],
        );
        for (const k of open) {
          await run("op.assumir", () => collector.claimTask(ctx, k.id));
          await run("op.separar", () => tasks.completeTask(ctx, k.id, {}));
        }
        // contagem do inventário do fixture (MOD-02/NIV-01) em paralelo pelo coletor
        const sku = ["SKU-001", "SKU-002", "SKU-003"][(index + i) % 3];
        const [exp] = await ctx.db.query<{ q: number }>(
          `select i.expected_qty as q from wms.inventory_count_items i join erp.products p on p.id = i.product_id
           where i.inventory_id = $1 and p.sku = $2`,
          [t.r.inventoryId, sku],
        );
        if (exp) await run("op.contar", () => collector.countFromCollector(ctx, t.r.inventoryId, { locationCode: LOC(2, 1), productCode: sku, quantity: exp.q }));
      }
    } else {
      for (let i = 0; i < ROUNDS; i++) {
        const st = await run("aud.estoque", () => stock.listStock(ctx, {}));
        await run("aud.kpis", () => dashboard.getKpis(ctx));
        const json = JSON.stringify(st ?? {});
        for (const other of env.tenants) if (other !== t && json.includes(other.companyId)) unexpected.push(`auditor ${t.key} viu ${other.key}`);
      }
    }
  })();
}

beforeAll(async () => {
  env = await createMultiTenantEnv(PG_URL ? await freshPostgres(PG_URL) : undefined);
}, 600_000);

afterAll(async () => {
  console.log(
    `[carga] driver=${env.db.driver} funcionarios=${env.all.length} operacoes=${ops.total} sucesso=${ops.ok} ` +
      `recusas-de-negocio=${ops.expected} (${[...expectedByCode].map(([k, v]) => `${k}:${v}`).join(", ")}) ` +
      `inesperados=${unexpected.length} tempo-da-fase-concorrente=${(elapsedMs / 1000).toFixed(1)}s`,
  );
  if (PG_URL) await env.db.close();
});

describe(`Carga concorrente multiempresa (${PG_URL ? "PostgreSQL" : "PGlite"})`, () => {
  it("49 funcionários trabalhando ao mesmo tempo, sem erro inesperado", async () => {
    const plans = await Promise.all(env.tenants.map((t) => prepare(t)));
    const t0 = Date.now();
    await Promise.all(
      plans.flatMap((plan) =>
        plan.t.staff.map((s, i) => worker(plan, s.ctx, i)),
      ),
    );
    // fechamento: o que sobrou de separação é concluído, conferido e expedido; inventário aprovado
    await Promise.all(
      plans.map(async ({ t, orders }) => {
        const left = await env.db.query<{ id: string }>(
          `select id from wms.tasks where company_id = $1 and task_type in ('picking', 'putaway') and status in ('pending', 'in_progress')`,
          [t.companyId],
        );
        for (const k of left) await run("fim.concluir", () => tasks.completeTask(t.operators[0], k.id, {}));
        for (const o of orders) {
          const order = await outbound.getOrder(t.supervisor, o);
          if (order?.status !== "picked") continue;
          await run("fim.conferir", () => outbound.checkOrder(t.operators[2], o, { lines: order.lines.map((l) => ({ lineId: l.id, checkedQty: l.picked_qty })) }));
          await run("fim.expedir", () => outbound.shipOrder(t.operators[2], o, {}));
        }
        const inv = await inventory.getInventory(t.supervisor, t.r.inventoryId);
        const pending = inv!.items.filter((i) => i.counted_qty == null);
        if (pending.length) await run("fim.contar", () => inventory.recordCounts(t.operators[3], t.r.inventoryId, { items: pending.map((i) => ({ itemId: i.id, countedQty: i.expected_qty })) }));
        await run("fim.submeter", () => inventory.submitInventory(t.operators[3], t.r.inventoryId));
        await run("fim.aprovar", () => inventory.approveInventory(t.admin, t.r.inventoryId, {}));
      }),
    );
    elapsedMs = Date.now() - t0;
    expect(unexpected).toEqual([]);
    expect(ops.ok).toBeGreaterThan(200);
    expect(ops.expected).toBeGreaterThan(0); // houve disputa de verdade
  }, 600_000);

  it("nenhum saldo negativo e reservado + bloqueado ≤ físico", async () => {
    const [bad] = await env.db.query<{ n: number }>(
      `select count(*)::int as n from wms.stock_balances where quantity < 0 or reserved_qty < 0 or blocked_qty < 0 or reserved_qty + blocked_qty > quantity`,
    );
    expect(bad.n).toBe(0);
  });

  it("Σ movimentações = saldo final, por empresa/endereço/produto/lote", async () => {
    for (const t of env.tenants) {
      const diff = await env.db.query<{ location_id: string; product_id: string; lot_code: string; bal: number; mov: number }>(
        `with mov as (
           select to_location_id as location_id, product_id, lot_code, quantity as q from wms.stock_movements
            where company_id = $1 and to_location_id is not null and movement_type not in ('block', 'unblock')
           union all
           select from_location_id, product_id, lot_code, -quantity from wms.stock_movements
            where company_id = $1 and from_location_id is not null and movement_type not in ('block', 'unblock')
         ), m as (select location_id, product_id, lot_code, sum(q) as mov from mov group by 1, 2, 3),
         b as (select location_id, product_id, lot_code, quantity as bal from wms.stock_balances where company_id = $1)
         select coalesce(b.location_id, m.location_id) as location_id, coalesce(b.product_id, m.product_id) as product_id,
                coalesce(b.lot_code, m.lot_code) as lot_code, coalesce(b.bal, 0) as bal, coalesce(m.mov, 0) as mov
         from b full join m using (location_id, product_id, lot_code)
         where coalesce(b.bal, 0) <> coalesce(m.mov, 0)`,
        [t.companyId],
      );
      expect(diff, `empresa ${t.key}`).toEqual([]);
    }
  });

  it("sem reserva duplicada: reservado por linha ≤ pedido e saldo reservado = reservas ativas", async () => {
    const [over] = await env.db.query<{ n: number }>(
      `select count(*)::int as n from wms.outbound_order_lines l
       where (select coalesce(sum(r.quantity), 0) from wms.stock_reservations r
              where r.order_line_id = l.id and r.status in ('active', 'picked', 'consumed', 'returning')) > l.requested_qty`,
    );
    expect(over.n).toBe(0);
    // endereços de armazenagem: reserved_qty do saldo = soma das reservas ativas (pedidos + produção)
    const mismatch = await env.db.query(
      `select b.id, b.reserved_qty,
              coalesce((select sum(r.quantity) from wms.stock_reservations r where r.balance_id = b.id and r.status = 'active'), 0)
            + coalesce((select sum(v.quantity) from wms.production_reservations v where v.balance_id = b.id and v.status = 'active'), 0) as expected
       from wms.stock_balances b join wms.locations l on l.id = b.location_id join wms.zones z on z.id = l.zone_id
       where z.zone_type = 'storage'
         and b.reserved_qty <> coalesce((select sum(r.quantity) from wms.stock_reservations r where r.balance_id = b.id and r.status = 'active'), 0)
            + coalesce((select sum(v.quantity) from wms.production_reservations v where v.balance_id = b.id and v.status = 'active'), 0)`,
    );
    expect(mismatch).toEqual([]);
    // cada pedido disputado pelos dois supervisores foi reservado uma única vez
    const [dupRes] = await env.db.query<{ n: number }>(
      `select count(*)::int as n from (select order_line_id from wms.stock_reservations where status <> 'released'
        group by order_line_id, balance_id having count(*) > 1) d`,
    );
    expect(dupRes.n).toBe(0);
  });

  it("nenhuma tarefa executada duas vezes", async () => {
    const [twice] = await env.db.query<{ n: number }>(
      `select count(*)::int as n from (select task_id from wms.task_events where to_status = 'completed' group by task_id having count(*) > 1) d`,
    );
    expect(twice.n).toBe(0);
    const [mov] = await env.db.query<{ n: number }>(
      `select count(*)::int as n from (select m.task_id from wms.stock_movements m join wms.tasks t on t.id = m.task_id
        where t.task_type in ('putaway', 'transfer', 'picking') group by m.task_id having count(*) > 1) d`,
    );
    expect(mov.n).toBe(0);
    const [done] = await env.db.query<{ n: number }>(`select count(*)::int as n from wms.tasks where status = 'completed'`);
    expect(done.n).toBeGreaterThan(50);
  });

  it("nenhum dado cruzado entre empresas", async () => {
    expect((await crossTenantReferences(env.db)).filter((r) => r.rows > 0)).toEqual([]);
    const [mv] = await env.db.query<{ n: number }>(
      `select count(*)::int as n from wms.stock_movements m join wms.users u on u.id = m.created_by where u.company_id <> m.company_id`,
    );
    expect(mv.n).toBe(0);
    const [au] = await env.db.query<{ n: number }>(
      `select count(*)::int as n from wms.audit_log a join wms.users u on u.id = a.user_id where u.company_id <> a.company_id`,
    );
    expect(au.n).toBe(0);
    const [ev] = await env.db.query<{ n: number }>(
      `select count(*)::int as n from wms.task_events e join wms.tasks t on t.id = e.task_id join wms.users u on u.id = e.user_id
       where u.company_id <> t.company_id`,
    );
    expect(ev.n).toBe(0);
  });
});
