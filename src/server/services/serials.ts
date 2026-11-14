import "server-only";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { DomainError } from "../errors";

/**
 * Números de série. Para produtos com `serial_controlled`, cada unidade separada
 * ou expedida precisa de um número de série. O registro wms.serial_numbers impede
 * (por índice único parcial) a mesma série duas vezes em estoque, e
 * wms.movement_serials liga cada série à movimentação que a transportou.
 */

export async function isSerialControlled(tx: Queryable, productId: string): Promise<boolean> {
  const [row] = await tx.query<{ serial: boolean }>(
    `select coalesce(serial_controlled, false) as serial from wms.product_settings where product_id = $1`,
    [productId],
  );
  return row?.serial ?? false;
}

/** Aceita lista separada por quebra de linha, vírgula, ponto e vírgula ou espaço. */
export function parseSerials(input: unknown): string[] {
  if (Array.isArray(input)) return input.flatMap((v) => parseSerials(v));
  if (typeof input !== "string") return [];
  return input
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function assertSerialCount(serials: string[], quantity: number, sku: string) {
  if (!Number.isInteger(quantity)) {
    throw new DomainError(`O produto ${sku} controla número de série: a quantidade deve ser inteira.`, "VALIDATION");
  }
  if (new Set(serials).size !== serials.length) throw new DomainError("Há números de série repetidos na lista informada.", "DUPLICATE_SERIAL");
  if (serials.length !== quantity) {
    throw new DomainError(
      `Informe ${quantity} número(s) de série para ${sku} (informados: ${serials.length}).`,
      "SERIAL_COUNT",
      "serials",
    );
  }
}

interface SerialRow {
  id: string;
  serial: string;
  status: string;
  location_id: string | null;
}

/**
 * Registra as séries separadas: cada série precisa estar no endereço de origem
 * (se já conhecida) e não pode estar em estoque em outro lugar. Passa a "separada"
 * na doca, vinculada ao pedido, e é ligada à movimentação de separação.
 */
export async function pickSerials(
  tx: Queryable,
  ctx: Ctx,
  a: {
    productId: string;
    sku: string;
    serials: string[];
    quantity: number;
    fromLocationId: string;
    dockLocationId: string;
    orderId: string;
    orderLineId: string;
    movementId: string;
  },
): Promise<void> {
  assertSerialCount(a.serials, a.quantity, a.sku);
  for (const serial of a.serials) {
    const [existing] = await tx.query<SerialRow>(
      `select id, serial, status, location_id from wms.serial_numbers
       where company_id = $1 and product_id = $2 and serial = $3 and status in ('in_stock', 'picked') for update`,
      [ctx.user.companyId, a.productId, serial],
    );
    let id: string;
    if (existing) {
      if (existing.status !== "in_stock" || existing.location_id !== a.fromLocationId) {
        throw new DomainError(`Série ${serial} já está em estoque em outro endereço ou separada para outro pedido.`, "DUPLICATE_SERIAL");
      }
      await tx.query(
        `update wms.serial_numbers set status = 'picked', location_id = $2, order_id = $3, order_line_id = $4, updated_at = now() where id = $1`,
        [existing.id, a.dockLocationId, a.orderId, a.orderLineId],
      );
      id = existing.id;
    } else {
      const [row] = await tx.query<{ id: string }>(
        `insert into wms.serial_numbers (company_id, product_id, serial, status, location_id, order_id, order_line_id)
         values ($1, $2, $3, 'picked', $4, $5, $6) returning id`,
        [ctx.user.companyId, a.productId, serial, a.dockLocationId, a.orderId, a.orderLineId],
      );
      id = row.id;
    }
    await tx.query(`insert into wms.movement_serials (movement_id, serial_id) values ($1, $2)`, [a.movementId, id]);
  }
}

/** Séries separadas (na doca) de uma linha de pedido. */
export async function pickedSerialsOfLine(tx: Queryable, orderLineId: string): Promise<SerialRow[]> {
  return tx.query<SerialRow>(
    `select id, serial, status, location_id from wms.serial_numbers where order_line_id = $1 and status = 'picked' order by serial for update`,
    [orderLineId],
  );
}

/**
 * Expedição: as séries lidas precisam ser exatamente as separadas para a linha.
 * Marca como expedidas e liga à movimentação de expedição.
 */
export async function shipSerials(
  tx: Queryable,
  a: { orderLineId: string; sku: string; serials: string[]; quantity: number; movementId: string },
): Promise<void> {
  assertSerialCount(a.serials, a.quantity, a.sku);
  const picked = await pickedSerialsOfLine(tx, a.orderLineId);
  const bySerial = new Map(picked.map((p) => [p.serial, p]));
  const unknown = a.serials.filter((s) => !bySerial.has(s));
  if (unknown.length || picked.length !== a.serials.length) {
    throw new DomainError(
      `As séries lidas de ${a.sku} não conferem com as separadas${unknown.length ? ` (não separadas: ${unknown.join(", ")})` : ""}.`,
      "SERIAL_MISMATCH",
    );
  }
  for (const s of a.serials) {
    const row = bySerial.get(s)!;
    await tx.query(`update wms.serial_numbers set status = 'shipped', location_id = null, updated_at = now() where id = $1`, [row.id]);
    await tx.query(`insert into wms.movement_serials (movement_id, serial_id) values ($1, $2)`, [a.movementId, row.id]);
  }
}

/** Devolução após cancelamento: as séries separadas voltam ao estoque no endereço de destino. */
export async function returnSerials(tx: Queryable, a: { orderLineId: string; toLocationId: string; quantity: number; movementId: string }) {
  const picked = await pickedSerialsOfLine(tx, a.orderLineId);
  for (const row of picked.slice(0, a.quantity)) {
    await tx.query(
      `update wms.serial_numbers set status = 'in_stock', location_id = $2, order_id = null, order_line_id = null, updated_at = now() where id = $1`,
      [row.id, a.toLocationId],
    );
    await tx.query(`insert into wms.movement_serials (movement_id, serial_id) values ($1, $2)`, [a.movementId, row.id]);
  }
}

export async function serialsOfOrder(ctx: Ctx, orderId: string) {
  return ctx.db.query<{ order_line_id: string; sku: string; serial: string; status: string }>(
    `select s.order_line_id, p.sku, s.serial, s.status from wms.serial_numbers s join erp.products p on p.id = s.product_id
     join wms.outbound_order_lines l on l.id = s.order_line_id
     where l.order_id = $1 and s.company_id = $2 order by p.sku, s.serial`,
    [orderId, ctx.user.companyId],
  );
}
