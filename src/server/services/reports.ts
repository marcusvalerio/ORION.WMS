import "server-only";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError } from "../errors";
import { listStock, listMovements } from "./stock";
import { listReceipts } from "./receiving";
import { listDivergences } from "./divergences";
import { listTasks } from "./tasks";
import { listInventories } from "./inventory";
import { listOrders, listShipments } from "./outbound";
import { MOVEMENT_LABELS, statusLabel, TASK_TYPE_LABELS, DIVERGENCE_TYPE_LABELS } from "@/lib/labels";

export const REPORTS = {
  estoque: "Estoque por depósito e endereço",
  movimentacoes: "Histórico de movimentações",
  recebimentos: "Recebimentos",
  divergencias: "Divergências",
  tarefas: "Tarefas por status",
  inventarios: "Inventários",
  pedidos: "Pedidos de saída / separação",
  expedicoes: "Expedições",
} as const;
export type ReportKey = keyof typeof REPORTS;

type Cell = string | number | null | undefined;
export interface Table {
  headers: string[];
  rows: Cell[][];
}

/** Gera os dados de um relatório respeitando filtros e permissões. */
export async function buildReport(ctx: Ctx, key: string, params: URLSearchParams): Promise<Table> {
  assertCan(ctx, "reports.export");
  const p = (k: string) => params.get(k) || null;
  switch (key as ReportKey) {
    case "estoque": {
      const { rows } = await listStock(ctx, {
        q: p("q"),
        warehouseId: p("warehouseId"),
        lot: p("lot"),
        status: p("status") as never,
        expiryBefore: p("expiryBefore"),
        pageSize: 0,
      });
      return {
        headers: ["Depósito", "Endereço", "SKU", "Descrição", "Lote", "Validade", "Físico", "Reservado", "Bloqueado", "Disponível", "UN"],
        rows: rows.map((r) => [r.warehouse_code, r.location_code, r.sku, r.description, r.lot_code, r.expiry_date, r.quantity, r.reserved_qty, r.blocked_qty, r.available_qty, r.uom]),
      };
    }
    case "movimentacoes": {
      const { rows } = await listMovements(ctx, { q: p("q"), type: p("type"), from: p("from"), to: p("to"), pageSize: 0 });
      return {
        headers: ["Data/hora", "Tipo", "SKU", "Lote", "Quantidade", "Origem", "Destino", "Motivo", "Documento", "Tarefa", "Usuário"],
        rows: rows.map((r) => [r.created_at, MOVEMENT_LABELS[r.movement_type] ?? r.movement_type, r.sku, r.lot_code, r.quantity, r.from_code, r.to_code, r.reason, r.reference_code, r.task_code, r.user_name]),
      };
    }
    case "recebimentos": {
      const rows = await listReceipts(ctx, { status: p("status"), q: p("q") });
      return {
        headers: ["Código", "Status", "Fornecedor", "Pedido de compra", "NF", "Depósito", "Chegada", "Previsto", "Conferido", "Divergências abertas", "Pendente armazenagem"],
        rows: rows.map((r) => [r.code, statusLabel("receipt", r.status), r.supplier_name, r.po_number, r.invoice_number, r.warehouse_code, r.arrived_at, r.expected_total, r.counted_total, r.open_divergences, r.pending_putaway]),
      };
    }
    case "divergencias": {
      const rows = await listDivergences(ctx, { status: p("status"), source: p("source") });
      return {
        headers: ["Data", "Origem", "Tipo", "SKU", "Quantidade", "Descrição", "Documento", "Status", "Tratamento", "Registrado por", "Tratado por"],
        rows: rows.map((r) => [r.created_at, r.source, DIVERGENCE_TYPE_LABELS[r.divergence_type] ?? r.divergence_type, r.sku, r.quantity, r.description, r.receipt_code ?? r.order_code ?? r.inventory_code, statusLabel("divergence", r.status), r.resolution, r.created_by_name, r.resolved_by_name]),
      };
    }
    case "tarefas": {
      const { rows } = await listTasks(ctx, { status: p("status"), type: p("type"), q: p("q"), pageSize: 10000 });
      return {
        headers: ["Código", "Tipo", "Status", "Prioridade", "SKU", "Quantidade", "Origem", "Destino", "Documento", "Responsável", "Criada em", "Concluída em"],
        rows: rows.map((r) => [r.code, TASK_TYPE_LABELS[r.task_type], statusLabel("task", r.status), r.priority, r.sku, r.quantity, r.from_code, r.to_code ?? r.suggested_code, r.receipt_code ?? r.order_code ?? r.inventory_code, r.assigned_name, r.created_at, r.completed_at]),
      };
    }
    case "inventarios": {
      const rows = await listInventories(ctx);
      return {
        headers: ["Código", "Tipo", "Status", "Depósito", "Escopo", "Itens", "Contados", "Com diferença", "Criado por", "Criado em", "Aprovado em"],
        rows: rows.map((r) => [r.code, r.count_type === "general" ? "Geral" : "Rotativo", statusLabel("inventory", r.status), r.warehouse_code, r.scope, r.items, r.counted, r.differences, r.created_by_name, r.created_at, r.approved_at]),
      };
    }
    case "pedidos": {
      const rows = await listOrders(ctx, { status: p("status"), q: p("q") });
      return {
        headers: ["Código", "Status", "Cliente", "Origem", "Pedido ERP", "Depósito", "Prioridade", "Solicitado", "Reservado", "Separado", "Expedido", "Criado em"],
        rows: rows.map((r) => [r.code, statusLabel("outbound", r.status), r.customer_name, r.source, r.so_number, r.warehouse_code, r.priority, r.requested, r.reserved, r.picked, r.shipped, r.created_at]),
      };
    }
    case "expedicoes": {
      const rows = await listShipments(ctx);
      return {
        headers: ["Expedição", "Pedido", "Cliente", "Transportadora", "Placa", "Documento", "Quantidade", "Expedido em", "Responsável"],
        rows: rows.map((r) => [r.code, r.order_code, r.customer_name, r.carrier, r.vehicle_plate, r.document_ref, r.total, r.shipped_at, r.shipped_by_name]),
      };
    }
    default:
      throw new DomainError("Relatório inexistente.", "NOT_FOUND");
  }
}

function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "number" ? String(value).replace(".", ",") : String(value);
  // Evita injeção de fórmulas ao abrir o CSV em planilhas.
  if (/^[=+\-@\t\r]/.test(s) && typeof value !== "number") s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** CSV com separador ";" e BOM UTF-8 (compatível com Excel em pt-BR). */
export function toCsv(table: Table): string {
  const lines = [table.headers, ...table.rows].map((row) => row.map(csvCell).join(";"));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
