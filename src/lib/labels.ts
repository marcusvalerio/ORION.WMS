export type Tone = "neutral" | "info" | "warning" | "success" | "danger" | "progress";

type StatusMap = Record<string, { label: string; tone: Tone }>;

export const STATUS: Record<
  "receipt" | "task" | "outbound" | "inventory" | "divergence" | "location" | "reservation" | "integration" | "appointment" | "customerReturn" | "nfe" | "wave" | "productionRequisition" | "customs",
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
    returning: { label: "Em devolução", tone: "warning" },
  },
  integration: {
    pending: { label: "Na fila", tone: "warning" },
    sent: { label: "Enviado", tone: "success" },
    failed: { label: "Falhou", tone: "danger" },
    sending: { label: "Enviando", tone: "progress" },
    discarded: { label: "Descartado", tone: "neutral" },
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
  wave: {
    draft: { label: "Planejada", tone: "neutral" },
    released: { label: "Liberada", tone: "info" },
    picking: { label: "Em separação", tone: "progress" },
    picked: { label: "Separada (distribuir)", tone: "warning" },
    completed: { label: "Distribuída", tone: "success" },
    cancelled: { label: "Cancelada", tone: "danger" },
  },
  productionRequisition: {
    open: { label: "Aberta", tone: "neutral" },
    reserved: { label: "Reservada", tone: "info" },
    picking: { label: "Em separação", tone: "progress" },
    delivered: { label: "Entregue à linha", tone: "warning" },
    completed: { label: "Encerrada", tone: "success" },
    cancelled: { label: "Cancelada", tone: "danger" },
  },
  customs: {
    none: { label: "Sem retenção", tone: "neutral" },
    awaiting: { label: "Aguardando desembaraço", tone: "warning" },
    cleared: { label: "Desembaraçado", tone: "success" },
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
  return: "Devolução ao endereço",
  production_pick: "Separação para produção",
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
  replenishment: "Reposição de picking",
  return: "Devolução ao estoque",
  production_pick: "Separação para produção",
  production_issue: "Entrega à produção",
  production_return: "Sobra devolvida pela produção",
  initial_load: "Carga inicial (ATLAS)",
};

export const ZONE_TYPE_LABELS: Record<string, string> = {
  receiving: "Recebimento",
  storage: "Armazenagem",
  picking: "Picking",
  shipping: "Expedição",
  quarantine: "Quarentena",
  production: "Produção (linha)",
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
  "user.created": "Usuário criado",
  "user.updated": "Usuário alterado",
  "user.activated": "Usuário ativado",
  "user.deactivated": "Usuário inativado",
  "user.password_reset": "Senha redefinida pelo administrador",
  "user.password_changed": "Senha alterada pelo usuário",
  "user.warehouses_updated": "Depósitos do usuário alterados",
  "settings.updated": "Configurações do WMS alteradas",
  "company.updated": "Dados da empresa alterados",
  "company.atlas_linked": "Empresa vinculada ao ATLAS.ERP",
  "company.atlas_synced": "Empresa sincronizada com o ATLAS.ERP",
  "company.atlas_unlinked": "Vínculo com o ATLAS.ERP removido",
  "integration.processed": "Fila de integração processada",
  "integration.retried": "Evento de integração reenviado",
  "integration.discarded": "Evento de integração descartado",
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
  "wave.created": "Onda criada",
  "wave.order_added": "Pedido incluído na onda",
  "wave.order_removed": "Pedido retirado da onda",
  "wave.released": "Onda liberada",
  "wave.picked": "Separação da onda concluída",
  "wave.order_distributed": "Pedido distribuído na doca",
  "wave.completed": "Onda distribuída",
  "wave.cancelled": "Onda cancelada",
  "replenishment.setting_saved": "Mínimo/máximo de picking salvo",
  "replenishment.created": "Reposição gerada",
  "replenishment.emergency": "Reposição de emergência gerada",
  "replenishment.checked": "Verificação de reposição",
  "outbound.line_cancelled": "Linha do pedido cancelada",
  "outbound.planning_updated": "Planejamento de saída alterado",
  "slotting.settings_updated": "Parâmetros da curva ABC alterados",
  "slotting.transfer_created": "Transferência de slotting gerada",
  "receipt.import_saved": "Dados de importação registrados",
  "receipt.customs_cleared": "Desembaraço aduaneiro registrado",
  "outbound.export_saved": "Dados de exportação registrados",
  "export.package_added": "Volume de exportação incluído",
  "export.package_removed": "Volume de exportação removido",
  "export.packed": "Packing list fechado",
  "export.stuffed": "Contêiner estufado",
  "production.requisition_created": "Requisição de produção criada",
  "production.reserved": "Componentes reservados",
  "production.released": "Separação para produção liberada",
  "production.delivered": "Entrega à linha confirmada",
  "production.leftovers_returned": "Sobra devolvida ao estoque",
  "production.output_received": "Produto acabado recebido",
  "production.completed": "Requisição encerrada",
  "production.cancelled": "Requisição cancelada",
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

export const PACKAGE_TYPE_LABELS: Record<string, string> = {
  box: "Caixa / Box",
  pallet: "Palete / Pallet",
  crate: "Engradado / Crate",
  drum: "Tambor / Drum",
  other: "Outro / Other",
};

export const WAVE_GROUPING_LABELS: Record<string, string> = {
  dock: "Doca",
  carrier: "Transportadora",
  date: "Data prevista",
  manual: "Seleção manual",
};

export const ATLAS_LINK_STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  activating: { label: "Em ativação", tone: "warning" },
  active: { label: "Ativo", tone: "success" },
  suspended: { label: "Suspenso (somente leitura)", tone: "danger" },
  disabled: { label: "Desativado", tone: "neutral" },
};

export const ATLAS_INBOX_STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  received: { label: "Recebido", tone: "info" },
  applied: { label: "Aplicado", tone: "success" },
  failed: { label: "Erro", tone: "danger" },
  ignored: { label: "Ignorado (já aplicado)", tone: "neutral" },
};
