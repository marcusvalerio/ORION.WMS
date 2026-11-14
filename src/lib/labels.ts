export type Tone = "neutral" | "info" | "warning" | "success" | "danger" | "progress";

type StatusMap = Record<string, { label: string; tone: Tone }>;

export const STATUS: Record<
  "receipt" | "task" | "outbound" | "inventory" | "divergence" | "location" | "reservation" | "integration" | "appointment" | "customerReturn" | "nfe",
  StatusMap
> = {
  receipt: {
    expected: { label: "Previsto", tone: "neutral" },
    checking: { label: "Em conferência", tone: "progress" },
    checked: { label: "Conferido", tone: "info" },
    released: { label: "Em armazenagem", tone: "warning" },
    completed: { label: "Concluído", tone: "success" },
    cancelled: { label: "Cancelado", tone: "danger" },
  },
  task: {
    pending: { label: "Pendente", tone: "neutral" },
    in_progress: { label: "Em execução", tone: "progress" },
    completed: { label: "Concluída", tone: "success" },
    cancelled: { label: "Cancelada", tone: "danger" },
  },
  outbound: {
    open: { label: "Aberto", tone: "neutral" },
    reserved: { label: "Reservado", tone: "info" },
    picking: { label: "Em separação", tone: "progress" },
    picked: { label: "Separado", tone: "warning" },
    checked: { label: "Conferido", tone: "info" },
    shipped: { label: "Expedido", tone: "success" },
    cancelled: { label: "Cancelado", tone: "danger" },
  },
  inventory: {
    counting: { label: "Em contagem", tone: "progress" },
    submitted: { label: "Aguardando aprovação", tone: "warning" },
    approved: { label: "Aprovado", tone: "success" },
    cancelled: { label: "Cancelado", tone: "danger" },
  },
  divergence: {
    open: { label: "Em aberto", tone: "danger" },
    resolved: { label: "Tratada", tone: "success" },
  },
  location: {
    active: { label: "Ativo", tone: "success" },
    blocked: { label: "Bloqueado", tone: "warning" },
    inactive: { label: "Inativo", tone: "neutral" },
  },
  reservation: {
    active: { label: "Ativa", tone: "info" },
    picked: { label: "Separada", tone: "warning" },
    released: { label: "Liberada", tone: "neutral" },
    consumed: { label: "Expedida", tone: "success" },
  },
  integration: {
    pending: { label: "Na fila", tone: "warning" },
    sent: { label: "Enviado", tone: "success" },
    failed: { label: "Falhou", tone: "danger" },
  },
  appointment: {
    scheduled: { label: "Agendado", tone: "info" },
    checked_in: { label: "Na doca (check-in)", tone: "progress" },
    no_show: { label: "Não compareceu", tone: "danger" },
    completed: { label: "Concluído", tone: "success" },
    cancelled: { label: "Cancelado", tone: "neutral" },
  },
  customerReturn: {
    pending: { label: "Aguardando inspeção", tone: "warning" },
    completed: { label: "Concluída", tone: "success" },
    cancelled: { label: "Cancelada", tone: "danger" },
  },
  nfe: {
    pending: { label: "Pendente", tone: "warning" },
    received: { label: "Recebida", tone: "success" },
    discarded: { label: "Descartada", tone: "neutral" },
  },
};

export function statusLabel(kind: keyof typeof STATUS, status: string): string {
  return STATUS[kind][status]?.label ?? status;
}

export const TASK_TYPE_LABELS: Record<string, string> = {
  putaway: "Armazenagem",
  transfer: "Transferência",
  inventory: "Inventário",
  picking: "Separação",
  replenishment: "Reposição",
};

export const MOVEMENT_LABELS: Record<string, string> = {
  putaway: "Armazenagem",
  transfer: "Transferência",
  adjustment_in: "Ajuste (entrada)",
  adjustment_out: "Ajuste (saída)",
  pick: "Separação",
  shipment: "Expedição",
  block: "Bloqueio",
  unblock: "Desbloqueio",
  return_in: "Entrada por devolução",
  discard: "Descarte",
};

export const ZONE_TYPE_LABELS: Record<string, string> = {
  receiving: "Recebimento",
  storage: "Armazenagem",
  picking: "Picking",
  shipping: "Expedição",
  quarantine: "Quarentena",
};

export const LOCATION_TYPE_LABELS: Record<string, string> = {
  rack: "Porta-palete",
  shelf: "Prateleira",
  floor: "Piso / blocado",
  dock: "Doca",
  staging: "Área de preparação",
  quarantine: "Quarentena",
};

export const STORAGE_CLASS_LABELS: Record<string, string> = {
  general: "Geral",
  refrigerated: "Refrigerado",
  hazardous: "Perigoso",
  bulky: "Volumoso",
};

export const DIVERGENCE_TYPE_LABELS: Record<string, string> = {
  shortage: "Falta",
  overage: "Sobra",
  damage: "Avaria",
  quality_hold: "Retenção de qualidade",
  short_pick: "Separação a menor",
  count_difference: "Diferença de contagem",
  other: "Outra",
};

export const DIVERGENCE_SOURCE_LABELS: Record<string, string> = {
  receipt: "Recebimento",
  picking: "Separação",
  outbound_check: "Conferência de saída",
  inventory: "Inventário",
  customer_return: "Devolução de cliente",
};

export const PRIORITY_LABELS: Record<number, { label: string; tone: Tone }> = {
  1: { label: "Alta", tone: "danger" },
  2: { label: "Normal", tone: "neutral" },
  3: { label: "Baixa", tone: "info" },
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "receipt.created": "Recebimento criado",
  "receipt.check_started": "Conferência iniciada",
  "receipt.counts_saved": "Contagem registrada",
  "receipt.divergence_added": "Divergência registrada",
  "receipt.check_finished": "Conferência finalizada",
  "receipt.released": "Itens liberados para armazenagem",
  "receipt.quality_released": "Retenção de qualidade liberada",
  "receipt.cancelled": "Recebimento cancelado",
  "receipt.completed": "Recebimento concluído",
  "outbound.created": "Pedido de saída criado",
  "outbound.reserved": "Estoque reservado",
  "outbound.picking_released": "Liberado para separação",
  "outbound.picked": "Separação concluída",
  "outbound.check_divergent": "Conferência com divergência",
  "outbound.checked": "Conferência de saída aprovada",
  "outbound.shipped": "Expedição confirmada",
  "outbound.cancelled": "Pedido cancelado",
  "stock.adjusted": "Ajuste manual de estoque",
  "stock.blocked": "Saldo bloqueado",
  "stock.unblocked": "Saldo desbloqueado",
  "transfer.created": "Transferência criada",
  "inventory.created": "Inventário aberto",
  "inventory.counted": "Contagem registrada",
  "inventory.item_added": "Item incluído na contagem",
  "inventory.submitted": "Inventário submetido",
  "inventory.approved": "Inventário aprovado",
  "inventory.rejected": "Inventário devolvido",
  "inventory.cancelled": "Inventário cancelado",
  "divergence.resolved": "Divergência tratada",
  "location.created": "Endereço criado",
  "location.generated": "Endereços gerados em lote",
  "location.updated": "Endereço alterado",
  "location.status_changed": "Status do endereço alterado",
  "location.deleted": "Endereço excluído",
  "warehouse.created": "Depósito criado",
  "warehouse.updated": "Depósito alterado",
  "warehouse.activated": "Depósito ativado",
  "warehouse.deactivated": "Depósito desativado",
  "zone.created": "Zona criada",
  "zone.activated": "Zona ativada",
  "zone.deactivated": "Zona desativada",
  "product.settings_updated": "Parâmetros logísticos alterados",
  "product.packaging_added": "Unidade logística cadastrada",
  "product.packaging_activated": "Unidade logística ativada",
  "product.packaging_deactivated": "Unidade logística desativada",
  "auth.login": "Login",
  "auth.logout": "Logout",
  "nfe.imported": "XML de NF-e importado",
  "nfe.supplier_linked": "Emitente da NF-e vinculado a fornecedor",
  "nfe.item_linked": "Item da NF-e vinculado (de-para)",
  "nfe.discarded": "NF-e descartada",
  "nfe.received": "Recebimento criado a partir da NF-e",
  "dock.created": "Doca cadastrada",
  "dock.activated": "Doca ativada",
  "dock.deactivated": "Doca desativada",
  "appointment.created": "Agendamento de doca criado",
  "appointment.check_in": "Check-in na doca",
  "appointment.no_show": "Não comparecimento registrado",
  "appointment.complete": "Agendamento concluído",
  "appointment.cancel": "Agendamento cancelado",
  "return.created": "Devolução registrada",
  "return.item_inspected": "Item da devolução inspecionado",
  "return.completed": "Devolução concluída",
  "return.cancelled": "Devolução cancelada",
};

export const DOCK_TYPE_LABELS: Record<string, string> = {
  inbound: "Entrada",
  outbound: "Saída",
  both: "Entrada e saída",
};

export const RETURN_REASON_LABELS: Record<string, string> = {
  damaged_in_transit: "Avaria no transporte",
  wrong_item: "Item errado",
  quality: "Problema de qualidade",
  regret: "Desistência do cliente",
  excess: "Envio em excesso",
  other: "Outro",
};
