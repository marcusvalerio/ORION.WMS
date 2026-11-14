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

// -----------------------------------------------------------------------------
// Ordens de produção (MRP do ERP) — requisição de materiais para o WMS
// -----------------------------------------------------------------------------

export interface ErpProductionOrder {
  id: string;
  number: string;
  status: string;
  product_id: string;
  sku: string;
  description: string;
  uom: string;
  quantity: number;
  due_date: string | null;
  output_lot_code: string | null;
  component_count: number;
  requisition_id: string | null;
  requisition_code: string | null;
}

export interface ErpProductionComponent {
  id: string;
  line_no: number;
  product_id: string;
  sku: string;
  description: string;
  uom: string;
  quantity: number;
}

export async function listProductionOrders(db: Queryable, companyId: string): Promise<ErpProductionOrder[]> {
  return db.query<ErpProductionOrder>(
    `select o.id, o.number, o.status, o.product_id, p.sku, p.description, p.uom, o.quantity, o.due_date::text as due_date,
            o.output_lot_code,
            (select count(*) from erp.production_order_components c where c.production_order_id = o.id) as component_count,
            r.id as requisition_id, r.code as requisition_code
     from erp.production_orders o join erp.products p on p.id = o.product_id
     left join wms.production_requisitions r on r.production_order_id = o.id and r.status <> 'cancelled'
     where o.company_id = $1
     order by o.due_date asc nulls last, o.number`,
    [companyId],
  );
}

export async function getProductionOrder(
  db: Queryable,
  companyId: string,
  id: string,
): Promise<(ErpProductionOrder & { components: ErpProductionComponent[] }) | null> {
  const [order] = (await listProductionOrders(db, companyId)).filter((o) => o.id === id);
  if (!order) return null;
  const components = await db.query<ErpProductionComponent>(
    `select c.id, c.line_no, c.product_id, p.sku, p.description, p.uom, c.quantity
     from erp.production_order_components c join erp.products p on p.id = c.product_id
     where c.production_order_id = $1 order by c.line_no`,
    [id],
  );
  return { ...order, components };
}

export async function setProductionOrderStatus(db: Queryable, id: string, status: "open" | "in_progress" | "completed"): Promise<void> {
  await db.query(`update erp.production_orders set status = $2 where id = $1 and status <> 'cancelled'`, [id, status]);
}
