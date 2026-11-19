/**
 * Tipos de palete. Medidas da base (m), carga dinâmica típica (kg) e altura
 * usual de empilhamento, para capacidade de endereço, montagem do armazém e
 * encaixe no contêiner. Valores de referência de mercado, não de um fabricante.
 */
export const PALLET_TYPES = ["PBR", "EUR", "US", "ASIA", "AUS", "HALF"] as const;
export type PalletType = (typeof PALLET_TYPES)[number];

export interface PalletSpec {
  label: string;
  /** de onde vem / onde é comum */
  origin: string;
  length: number;
  width: number;
  /** carga dinâmica típica, kg */
  loadKg: number;
}

export const PALLETS: Record<PalletType, PalletSpec> = {
  PBR: { label: "PBR", origin: "Padrão brasileiro", length: 1.2, width: 1.0, loadKg: 1200 },
  EUR: { label: "Europeu (EUR)", origin: "Padrão europeu", length: 1.2, width: 0.8, loadKg: 1500 },
  US: { label: "Americano", origin: "EUA e Canadá (40×48 pol.)", length: 1.219, width: 1.016, loadKg: 1200 },
  ASIA: { label: "Asiático", origin: "Ásia (ISO 1100)", length: 1.1, width: 1.1, loadKg: 1000 },
  AUS: { label: "Australiano", origin: "Austrália (Chep)", length: 1.165, width: 1.165, loadKg: 1500 },
  HALF: { label: "Meio palete", origin: "Varejo e display", length: 0.8, width: 0.6, loadKg: 500 },
};

export function isPalletType(v: unknown): v is PalletType {
  return typeof v === "string" && (PALLET_TYPES as readonly string[]).includes(v);
}

export const palletLabel = (t: PalletType) => `${PALLETS[t].label} · ${fmtM(PALLETS[t].length)} × ${fmtM(PALLETS[t].width)} m`;
const fmtM = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/**
 * Quantos paletes cabem no piso de um contêiner (uma camada), testando as duas
 * orientações e a mistura das duas no comprimento.
 */
export function palletsPerLayer(t: PalletType, containerLength: number, containerWidth: number): number {
  const p = PALLETS[t];
  let best = 0;
  for (const [a, b] of [
    [p.length, p.width],
    [p.width, p.length],
  ] as const) {
    // faixa principal: `a` ao longo do comprimento, `b` na largura
    const across = Math.floor(containerWidth / b);
    const along = Math.floor(containerLength / a);
    // sobra do comprimento girando o palete
    const rest = containerLength - along * a;
    const extra = Math.floor(rest / b) * Math.floor(containerWidth / a);
    best = Math.max(best, across * along + extra);
  }
  return best;
}
