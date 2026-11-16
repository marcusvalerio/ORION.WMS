import type { Tone } from "./labels";

/**
 * Rótulos e regras da aba Comex compartilhados entre servidor e interface.
 * O banco repete os domínios em CHECK (migration 20261116000060).
 */

export const TRANSPORT_MODES = ["sea", "air", "road", "rail"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];
export const TRANSPORT_MODE_LABELS: Record<TransportMode, string> = {
  sea: "Marítimo",
  air: "Aéreo",
  road: "Rodoviário",
  rail: "Ferroviário",
};
/** Documento de transporte conforme o modal (BL marítimo, AWB aéreo, CRT rodoviário, TIF ferroviário). */
export const TRANSPORT_DOC_LABELS: Record<TransportMode, string> = { sea: "BL", air: "AWB", road: "CRT", rail: "TIF" };

export const CUSTOMS_CHANNELS = ["green", "yellow", "red", "grey"] as const;
export type CustomsChannel = (typeof CUSTOMS_CHANNELS)[number];
export const CUSTOMS_CHANNEL_LABELS: Record<CustomsChannel, { label: string; tone: Tone; hint: string }> = {
  green: { label: "Verde", tone: "success", hint: "Desembaraço automático, sem conferência" },
  yellow: { label: "Amarelo", tone: "warning", hint: "Conferência documental" },
  red: { label: "Vermelho", tone: "danger", hint: "Conferência documental e física" },
  grey: { label: "Cinza", tone: "neutral", hint: "Procedimento especial de controle aduaneiro (valor)" },
};

export const IMPORT_SITUATIONS = ["no_data", "awaiting", "cleared", "stored"] as const;
export type ImportSituation = (typeof IMPORT_SITUATIONS)[number];
export const IMPORT_SITUATION_LABELS: Record<ImportSituation, { label: string; tone: Tone }> = {
  no_data: { label: "Sem DI/DUIMP", tone: "neutral" },
  awaiting: { label: "Aguardando desembaraço", tone: "warning" },
  cleared: { label: "Desembaraçado", tone: "info" },
  stored: { label: "Armazenado", tone: "success" },
};

export const EXPORT_SITUATIONS = ["picking", "packing", "packed", "stuffed", "shipped"] as const;
export type ExportSituation = (typeof EXPORT_SITUATIONS)[number];
export const EXPORT_SITUATION_LABELS: Record<ExportSituation, { label: string; tone: Tone }> = {
  picking: { label: "Em separação", tone: "progress" },
  packing: { label: "Montando volumes", tone: "warning" },
  packed: { label: "Packing list fechado", tone: "info" },
  stuffed: { label: "Contêiner estufado", tone: "info" },
  shipped: { label: "Expedido", tone: "success" },
};

export interface ImportTimelineInput {
  shipped_on: string | null;
  eta_on: string | null;
  arrived_at: string | null;
  import_registered_on: string | null;
  customs_cleared_on: string | null;
  checked_at: string | null;
  completed_at: string | null;
}

export interface TimelineStep {
  key: string;
  label: string;
  /** Data do marco (AAAA-MM-DD ou timestamp); null quando ainda não aconteceu ou não foi informado. */
  at: string | null;
  done: boolean;
  /** Data prevista (só chegada). */
  planned?: string | null;
}

/**
 * Linha do tempo do processo de importação a partir dos dados do recebimento.
 * Armazenado implica recebido, e recebido implica chegada (mesmo sem a data);
 * os marcos aduaneiros só contam quando registrados.
 */
export function importTimeline(r: ImportTimelineInput): TimelineStep[] {
  const steps: TimelineStep[] = [
    { key: "shipped", label: "Embarque", at: r.shipped_on, done: Boolean(r.shipped_on) },
    { key: "arrived", label: "Chegada", at: r.arrived_at, done: Boolean(r.arrived_at), planned: r.eta_on },
    { key: "registered", label: "Registro DI/DUIMP", at: r.import_registered_on, done: Boolean(r.import_registered_on) },
    { key: "cleared", label: "Desembaraço", at: r.customs_cleared_on, done: Boolean(r.customs_cleared_on) },
    { key: "checked", label: "Recebimento", at: r.checked_at, done: Boolean(r.checked_at) },
    { key: "stored", label: "Armazenagem", at: r.completed_at, done: Boolean(r.completed_at) },
  ];
  const [, arrived, , , checked, stored] = steps;
  if (stored.done) checked.done = true;
  if (checked.done) arrived.done = true;
  return steps;
}
