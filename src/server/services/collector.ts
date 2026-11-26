import "server-only";
import { z } from "zod";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError } from "../errors";
import { parse, nonNegQty, optionalText } from "../validation";
import type { OpOptions } from "./common";
import { evaluateDestination } from "./stock-core";
import { completeTask, getTask, listTasks, startTask, type TaskRow } from "./tasks";
import { can } from "@/lib/permissions";
import { addInventoryItem, canSubmitInventory, getInventory, listInventories, recordCounts, startLocationCount } from "./inventory";

/**
 * Coletor (operador no celular / leitor de código de barras).
 *
 * Este serviço só traduz leituras (código do endereço, EAN/SKU do produto) em
 * identificadores e valida o passo a passo. Toda alteração de estado é feita
 * pelos serviços de tarefas e inventário — as regras de negócio não são duplicadas.
 */

export interface ScanLocation {
  id: string;
  code: string;
  warehouse_id: string;
  zone_code: string;
  zone_type: string;
  status: string;
}

export interface ScanProduct {
  id: string;
  sku: string;
  description: string;
  barcode: string | null;
  uom: string;
}

const scanCode = (label: string) =>
  z
    .string({ error: `Leia ou digite o ${label}.` })
    .trim()
    .min(1, `Leia ou digite o ${label}.`)
    .max(200, `Código de ${label} muito longo.`);

/** Normaliza a leitura: leitores costumam enviar espaços ou quebras de linha ao redor. */
function clean(code: string): string {
  return code.replace(/[\r\n\t]/g, "").trim();
}

export async function resolveLocationCode(ctx: Ctx, code: string): Promise<ScanLocation> {
  const value = clean(parse(scanCode("endereço"), code)).toUpperCase();
  const [loc] = await ctx.db.query<ScanLocation>(
    `select l.id, l.code, l.warehouse_id, z.code as zone_code, z.zone_type, l.status
     from wms.locations l join wms.zones z on z.id = l.zone_id
     where l.company_id = $1 and upper(l.code) = $2`,
    [ctx.user.companyId, value],
  );
  if (!loc) throw new DomainError(`Endereço "${value}" não encontrado.`, "LOCATION_NOT_FOUND");
  return loc;
}

/** Aceita o código de barras (EAN/GTIN) ou o SKU do produto. */
export async function resolveProductCode(ctx: Ctx, code: string): Promise<ScanProduct> {
  const value = clean(parse(scanCode("produto"), code));
  const [product] = await ctx.db.query<ScanProduct>(
    `select id, sku, description, barcode, uom from erp.products p
     where company_id = $1 and (barcode = $2 or upper(sku) = upper($2)
       or exists (select 1 from wms.packaging_units pu where pu.product_id = p.id and pu.code = 'ATLAS-SKU' and pu.active and pu.barcode = $2))
     order by (barcode = $2) desc, (upper(sku) = upper($2)) desc limit 1`,
    [ctx.user.companyId, value],
  );
  if (!product) throw new DomainError(`Produto "${value}" não encontrado (use o EAN ou o SKU).`, "PRODUCT_NOT_FOUND");
  return product;
}

// -----------------------------------------------------------------------------
// Tarefas
// -----------------------------------------------------------------------------

const COLLECTOR_TYPES = ["putaway", "picking", "transfer"] as const;

/** Tarefas abertas (pendentes ou em execução) atribuídas ao usuário ou sem responsável. */
export async function listCollectorTasks(ctx: Ctx): Promise<TaskRow[]> {
  assertCan(ctx, "task.execute");
  const { rows } = await listTasks(ctx, { status: "pending,in_progress", sort: "priority", pageSize: 500 });
  return rows.filter(
    (t) =>
      (COLLECTOR_TYPES as readonly string[]).includes(t.task_type) && (t.assigned_to === null || t.assigned_to === ctx.user.id),
  );
}

/**
 * Mesmo critério do serviço de tarefas e do painel (D2): abertas (pendentes ou em
 * execução) dos tipos do coletor. "Suas" = atribuídas a você ou livres; "da equipe" =
 * em execução com outro operador.
 */
export async function collectorTaskCounts(ctx: Ctx) {
  assertCan(ctx, "task.execute");
  const { rows } = await listTasks(ctx, { status: "pending,in_progress", sort: "priority", pageSize: 500 });
  const open = rows.filter((t) => (COLLECTOR_TYPES as readonly string[]).includes(t.task_type));
  const mine = open.filter((t) => t.assigned_to === null || t.assigned_to === ctx.user.id).length;
  return { mine, team: open.length - mine };
}

async function openTask(ctx: Ctx, taskId: string): Promise<TaskRow> {
  const task = await getTask(ctx, taskId);
  if (!task) throw new DomainError("Tarefa não encontrada.", "NOT_FOUND");
  if (task.status === "completed") throw new DomainError(`A tarefa ${task.code} já foi concluída.`, "TASK_CLOSED");
  if (task.status === "cancelled") throw new DomainError(`A tarefa ${task.code} está cancelada.`, "TASK_CLOSED");
  if (!(COLLECTOR_TYPES as readonly string[]).includes(task.task_type)) {
    throw new DomainError("Este tipo de tarefa não é executado pelo coletor.", "VALIDATION");
  }
  return task;
}

/** Pega a tarefa: inicia e atribui ao operador (se já estiver em execução com ele, apenas retorna). */
export async function claimTask(ctx: Ctx, taskId: string, opts?: OpOptions) {
  assertCan(ctx, "task.execute");
  const task = await openTask(ctx, taskId);
  if (task.status === "in_progress" && task.assigned_to === ctx.user.id) return { id: task.id, code: task.code };
  await startTask(ctx, taskId, opts);
  return { id: task.id, code: task.code };
}

export interface LocationCheck {
  location: ScanLocation;
  /** true quando o endereço lido é exatamente o esperado/sugerido. */
  expected: boolean;
  expectedCode: string | null;
  message: string;
}

/**
 * Valida o endereço de destino lido (armazenagem/transferência). Se não for o
 * sugerido, avalia a elegibilidade com as mesmas regras da conclusão e explica a recusa.
 */
export async function checkDestination(ctx: Ctx, taskId: string, code: string): Promise<LocationCheck> {
  assertCan(ctx, "task.execute");
  const task = await openTask(ctx, taskId);
  if (task.task_type === "picking") throw new DomainError("Separação não tem destino a ler: o destino é a doca do pedido.");
  const loc = await resolveLocationCode(ctx, code);
  const expectedId = task.to_location_id ?? task.suggested_location_id;
  const expectedCode = task.to_code ?? task.suggested_code;
  if (task.task_type === "transfer" && loc.id === task.from_location_id) {
    throw new DomainError("Origem e destino não podem ser o mesmo endereço.", "LOCATION_MISMATCH");
  }
  if (loc.id === expectedId) {
    return { location: loc, expected: true, expectedCode, message: `Endereço ${loc.code} confirmado.` };
  }
  const evaluation = await evaluateDestination(ctx.db, ctx, {
    locationId: loc.id,
    warehouseId: task.warehouse_id,
    productId: task.product_id!,
    quantity: task.quantity!,
    excludeTaskId: task.id,
  });
  if (!evaluation.ok) {
    throw new DomainError(
      `Endereço ${loc.code} recusado: ${evaluation.reasons.join("; ")}.${expectedCode ? ` Destino sugerido: ${expectedCode}.` : ""}`,
      "LOCATION_NOT_ELIGIBLE",
    );
  }
  return {
    location: loc,
    expected: false,
    expectedCode,
    message: `Endereço ${loc.code} é elegível${expectedCode ? ` (diferente do sugerido ${expectedCode})` : ""}.`,
  };
}

/** Valida o endereço de origem lido (separação/transferência). */
export async function checkOrigin(ctx: Ctx, taskId: string, code: string): Promise<LocationCheck> {
  assertCan(ctx, "task.execute");
  const task = await openTask(ctx, taskId);
  if (task.task_type === "putaway") throw new DomainError("Armazenagem não tem endereço de origem a ler.");
  const loc = await resolveLocationCode(ctx, code);
  if (loc.id !== task.from_location_id) {
    throw new DomainError(`Endereço lido (${loc.code}) não é a origem da tarefa (${task.from_code}).`, "LOCATION_MISMATCH");
  }
  return { location: loc, expected: true, expectedCode: task.from_code, message: `Origem ${loc.code} confirmada.` };
}

/** Valida o produto lido contra o produto da tarefa. */
export async function checkTaskProduct(ctx: Ctx, taskId: string, code: string): Promise<ScanProduct> {
  assertCan(ctx, "task.execute");
  const task = await openTask(ctx, taskId);
  const product = await resolveProductCode(ctx, code);
  if (product.id !== task.product_id) {
    throw new DomainError(`Produto lido (${product.sku}) não é o da tarefa (${task.sku}).`, "PRODUCT_MISMATCH");
  }
  return product;
}

const completeSchema = z.object({
  originCode: z.string().trim().nullish(),
  locationCode: z.string().trim().nullish(),
  productCode: scanCode("produto"),
  quantity: nonNegQty(),
  notes: optionalText,
});

/**
 * Conclui a tarefa a partir das leituras do coletor. Revalida cada leitura e
 * delega a execução física a completeTask (mesma transação, locks e regras da tela web).
 *  - armazenagem: destino + produto + quantidade (volume inteiro da tarefa);
 *  - transferência: origem + destino + produto + quantidade (volume inteiro);
 *  - separação: origem + produto + quantidade (a menor gera divergência e libera a reserva restante).
 */
export async function completeFromCollector(ctx: Ctx, taskId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "task.execute");
  const d = parse(completeSchema, input);
  const task = await openTask(ctx, taskId);
  await checkTaskProduct(ctx, taskId, d.productCode);
  const requireWhole = () => {
    if (d.quantity !== task.quantity) {
      throw new DomainError(
        `Confirme a quantidade total da tarefa (${task.quantity} ${task.uom ?? "un"}). Volume parcial deve ser tratado pelo supervisor.`,
        "QTY_MISMATCH",
      );
    }
  };
  let result: { id: string; confirmed: number };
  if (task.task_type === "putaway") {
    if (!d.locationCode) throw new DomainError("Leia o endereço de destino.", "VALIDATION", "locationCode");
    const dest = await checkDestination(ctx, taskId, d.locationCode);
    requireWhole();
    result = await completeTask(ctx, taskId, { locationId: dest.location.id, notes: d.notes }, opts);
  } else if (task.task_type === "transfer") {
    if (!d.originCode) throw new DomainError("Leia o endereço de origem.", "VALIDATION", "originCode");
    if (!d.locationCode) throw new DomainError("Leia o endereço de destino.", "VALIDATION", "locationCode");
    await checkOrigin(ctx, taskId, d.originCode);
    const dest = await checkDestination(ctx, taskId, d.locationCode);
    requireWhole();
    result = await completeTask(ctx, taskId, { locationId: dest.location.id, notes: d.notes }, opts);
  } else {
    const originCode = d.originCode ?? d.locationCode;
    if (!originCode) throw new DomainError("Leia o endereço de origem.", "VALIDATION", "originCode");
    const origin = await checkOrigin(ctx, taskId, originCode);
    if (task.quantity !== null && d.quantity > task.quantity) {
      throw new DomainError(`Quantidade (${d.quantity}) maior que a da tarefa (${task.quantity}).`, "OVER_PICK");
    }
    result = await completeTask(ctx, taskId, { locationId: origin.location.id, quantity: d.quantity, notes: d.notes }, opts);
  }
  const done = await getTask(ctx, taskId);
  const shortfall = task.task_type === "picking" && task.quantity !== null ? task.quantity - result.confirmed : 0;
  return { id: taskId, code: task.code, confirmed: result.confirmed, destinationCode: done?.to_code ?? null, shortfall };
}

// -----------------------------------------------------------------------------
// Inventário
// -----------------------------------------------------------------------------

export async function listCountingInventories(ctx: Ctx) {
  assertCan(ctx, "inventory.count");
  return (await listInventories(ctx)).filter((i) => i.status === "counting");
}

async function countingInventory(ctx: Ctx, inventoryId: string) {
  const inv = await getInventory(ctx, inventoryId);
  if (!inv) throw new DomainError("Inventário não encontrado.", "NOT_FOUND");
  if (inv.status !== "counting") throw new DomainError(`O inventário ${inv.code} não está em contagem.`, "INVALID_STATUS");
  return inv;
}

/**
 * Lê o endereço dentro de um inventário em contagem e grava o lock do endereço (1ª
 * leitura). Contagem cega de verdade (A4): NÃO lista os SKUs previstos, só quantos
 * itens o endereço ainda tem a contar e se há recontagem.
 */
export async function inventoryLocation(ctx: Ctx, inventoryId: string, code: string) {
  assertCan(ctx, "inventory.count");
  const inv = await countingInventory(ctx, inventoryId);
  const loc = await resolveLocationCode(ctx, code);
  if (loc.warehouse_id !== inv.warehouse_id) throw new DomainError(`Endereço ${loc.code} não pertence ao depósito do inventário.`);
  const here = inv.items.filter((i) => i.location_id === loc.id);
  if (here.length) await startLocationCount(ctx, inventoryId, loc.id);
  const recount = here.filter((i) => i.status === "recount").length;
  const counted = here.filter((i) => i.status === "counted" || i.status === "closed").length;
  return { location: loc, toCount: here.length - counted, counted, recount, inScope: here.length > 0 };
}

/**
 * Resumo do coletor: progresso ("42 de 72"), lista "A recontar" em destaque e se já
 * dá para submeter para aprovação (A10).
 */
export async function collectorInventorySummary(ctx: Ctx, inventoryId: string) {
  assertCan(ctx, "inventory.count");
  const inv = await countingInventory(ctx, inventoryId);
  const done = inv.items.filter((i) => i.status === "counted" || i.status === "closed").length;
  const recount = inv.items
    .filter((i) => i.status === "recount")
    .map((i) => ({ id: i.id, location_code: i.location_code, sku: i.sku, round: i.round }));
  const state = await canSubmitInventory(ctx.db, ctx.user.companyId, inventoryId);
  return { code: inv.code, done, total: inv.items.length, recount, canSubmit: state.ready && can(ctx.user.role, "inventory.count") };
}

const countSchema = z.object({
  locationCode: scanCode("endereço"),
  productCode: scanCode("produto"),
  lotCode: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v == null ? null : v.toUpperCase())),
  quantity: nonNegQty("Quantidade contada"),
});

/**
 * Registra a contagem de um produto lido em um endereço lido. Se o item já está
 * na folha, grava a quantidade (recordCounts); se não estava previsto, inclui como
 * item encontrado (addInventoryItem). A contagem nunca altera o saldo.
 */
export async function countFromCollector(ctx: Ctx, inventoryId: string, input: unknown, opts?: OpOptions) {
  assertCan(ctx, "inventory.count");
  const d = parse(countSchema, input);
  const inv = await countingInventory(ctx, inventoryId);
  const loc = await resolveLocationCode(ctx, d.locationCode);
  if (loc.warehouse_id !== inv.warehouse_id) throw new DomainError(`Endereço ${loc.code} não pertence ao depósito do inventário.`);
  const product = await resolveProductCode(ctx, d.productCode);
  const matches = inv.items.filter(
    (i) =>
      i.location_id === loc.id &&
      i.product_id === product.id &&
      i.status !== "closed" &&
      (d.lotCode === null || i.lot_code === d.lotCode),
  );
  if (matches.length > 1) {
    throw new DomainError(
      `${product.sku} tem mais de um lote em ${loc.code} (${matches.map((m) => m.lot_code || "sem lote").join(", ")}). Informe o lote.`,
      "LOT_REQUIRED",
      "lotCode",
    );
  }
  if (matches.length === 1) {
    const r = await recordCounts(ctx, inventoryId, { items: [{ itemId: matches[0].id, countedQty: d.quantity }], device: "collector" }, opts);
    const res = r.results[0];
    return {
      itemId: matches[0].id,
      added: false,
      sku: product.sku,
      lotCode: matches[0].lot_code,
      location: loc.code,
      recount: res ? !res.closed : false,
      nextRound: res?.nextRound ?? null,
    };
  }
  const added = await addInventoryItem(
    ctx,
    inventoryId,
    {
      locationId: loc.id,
      productId: product.id,
      lotCode: d.lotCode ?? "",
      countedQty: d.quantity,
      notes: "Item não previsto, incluído pelo coletor.",
      device: "collector",
    },
    opts,
  );
  return { itemId: added.id, added: true, sku: product.sku, lotCode: d.lotCode ?? "", location: loc.code, recount: !added.closed, nextRound: added.nextRound };
}

// -----------------------------------------------------------------------------
// Consulta rápida
// -----------------------------------------------------------------------------

export interface LookupBalance {
  location_code: string;
  sku: string;
  description: string;
  uom: string;
  lot_code: string;
  expiry_date: string | null;
  quantity: number;
  reserved_qty: number;
  blocked_qty: number;
  available_qty: number;
}

export type LookupResult =
  | { kind: "location"; location: ScanLocation; balances: LookupBalance[] }
  | { kind: "product"; product: ScanProduct; balances: LookupBalance[]; total: number; available: number };

const LOOKUP_SELECT = `
  select l.code as location_code, p.sku, p.description, p.uom, b.lot_code, b.expiry_date::text as expiry_date,
         b.quantity, b.reserved_qty, b.blocked_qty, (b.quantity - b.reserved_qty - b.blocked_qty) as available_qty
  from wms.stock_balances b join wms.locations l on l.id = b.location_id join erp.products p on p.id = b.product_id`;

/** Lê um código: se for endereço, mostra o que há nele; se for produto, onde está e quanto. */
export async function lookupCode(ctx: Ctx, code: string): Promise<LookupResult> {
  const value = clean(parse(scanCode("código"), code));
  const location = await resolveLocationCode(ctx, value).catch(() => null);
  if (location) {
    const balances = await ctx.db.query<LookupBalance>(
      `${LOOKUP_SELECT} where b.company_id = $1 and b.location_id = $2 and b.quantity > 0 order by p.sku, b.lot_code`,
      [ctx.user.companyId, location.id],
    );
    return { kind: "location", location, balances };
  }
  const product = await resolveProductCode(ctx, value).catch(() => null);
  if (!product) throw new DomainError(`Código "${value}" não corresponde a endereço nem a produto.`, "NOT_FOUND");
  const balances = await ctx.db.query<LookupBalance>(
    `${LOOKUP_SELECT} where b.company_id = $1 and b.product_id = $2 and b.quantity > 0
     order by b.expiry_date nulls last, l.code`,
    [ctx.user.companyId, product.id],
  );
  const total = balances.reduce((s, b) => s + b.quantity, 0);
  const available = balances.reduce((s, b) => s + b.available_qty, 0);
  return { kind: "product", product, balances, total: Math.round(total * 1000) / 1000, available: Math.round(available * 1000) / 1000 };
}
