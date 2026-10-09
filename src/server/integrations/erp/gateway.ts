import "server-only";
import type { Queryable } from "../../db/types";

/**
 * Gateway de integração com o ERP.
 *
 * Esta implementação lê e atualiza o schema `erp` do mesmo banco (fronteira de
 * integração local). Para conectar outro ERP (API REST, outro banco, fila),
 * basta reimplementar estas funções mantendo os contratos. Os eventos que o
 * ERP precisa receber também são gravados na outbox wms.integration_events.
 */

export interface ErpPurchaseOrder {
  id: string;
  number: string;
  status: string;
  supplier_id: string;
  supplier_name: string;
  issue_date: string;
  expected_date: string | null;
  invoice_number: string | null;
  total_qty: number;
  item_count: number;
  receipt_code: string | null;
}

export interface ErpOrderItem {
  id: string;
  line_no: number;
  product_id: string;
  sku: string;
  description: string;
  uom: string;
  quantity: number;
}

export async function listPurchaseOrders(db: Queryable, companyId: string): Promise<ErpPurchaseOrder[]> {
  return db.query<ErpPurchaseOrder>(
    `select po.id, po.number, po.status, po.supplier_id, s.name as supplier_name, po.issue_date::text as issue_date,
            po.expected_date::text as expected_date, po.invoice_number,
            coalesce((select sum(quantity) from erp.purchase_order_items i where i.purchase_order_id = po.id), 0) as total_qty,
            (select count(*) from erp.purchase_order_items i where i.purchase_order_id = po.id) as item_count,
            (select r.code from wms.receipts r where r.purchase_order_id = po.id and r.status <> 'cancelled' limit 1) as receipt_code
     from erp.purchase_orders po join erp.suppliers s on s.id = po.supplier_id
     where po.company_id = $1
     order by po.issue_date desc, po.number desc`,
    [companyId],
  );
}

export async function getPurchaseOrder(
  db: Queryable,
  companyId: string,
  id: string,
): Promise<(ErpPurchaseOrder & { items: ErpOrderItem[] }) | null> {
  const [po] = (await listPurchaseOrders(db, companyId)).filter((p) => p.id === id);
  if (!po) return null;
  const items = await db.query<ErpOrderItem>(
    `select i.id, i.line_no, i.product_id, p.sku, p.description, p.uom, i.quantity
     from erp.purchase_order_items i join erp.products p on p.id = i.product_id
     where i.purchase_order_id = $1 order by i.line_no`,
    [id],
  );
  return { ...po, items };
}

export interface ErpSalesOrder {
  id: string;
  number: string;
  status: string;
  customer_name: string;
  issue_date: string;
  total_qty: number;
  outbound_code: string | null;
}

export async function listSalesOrders(db: Queryable, companyId: string): Promise<ErpSalesOrder[]> {
  return db.query<ErpSalesOrder>(
    `select so.id, so.number, so.status, c.name as customer_name, so.issue_date::text as issue_date,
            coalesce((select sum(quantity) from erp.sales_order_items i where i.sales_order_id = so.id), 0) as total_qty,
            (select o.code from wms.outbound_orders o where o.sales_order_id = so.id and o.status <> 'cancelled' limit 1) as outbound_code
     from erp.sales_orders so join erp.customers c on c.id = so.customer_id
     where so.company_id = $1
     order by so.issue_date desc, so.number desc`,
    [companyId],
  );
}

export async function getSalesOrderItems(db: Queryable, salesOrderId: string): Promise<ErpOrderItem[]> {
  return db.query<ErpOrderItem>(
    `select i.id, i.line_no, i.product_id, p.sku, p.description, p.uom, i.quantity
     from erp.sales_order_items i join erp.products p on p.id = i.product_id
     where i.sales_order_id = $1 order by i.line_no`,
    [salesOrderId],
  );
}

export async function setPurchaseOrderStatus(
  db: Queryable,
  id: string,
  status: "open" | "partially_received" | "received",
): Promise<void> {
  await db.query(`update erp.purchase_orders set status = $2 where id = $1 and status <> 'cancelled'`, [id, status]);
}

export async function setSalesOrderStatus(
  db: Queryable,
  id: string,
  status: "open" | "in_fulfillment" | "shipped",
): Promise<void> {
  await db.query(`update erp.sales_orders set status = $2 where id = $1 and status <> 'cancelled'`, [id, status]);
}
