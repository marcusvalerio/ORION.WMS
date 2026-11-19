/**
 * Contêineres e ocupação da carga. Dimensões internas (m) e carga útil (kg)
 * típicas de mercado; servem para a estimativa visual do Comex, não para
 * plano de estufagem.
 */
export const CONTAINER_TYPES = ["20DC", "40DC", "40HC", "40RF"] as const;
export type ContainerType = (typeof CONTAINER_TYPES)[number];

export interface ContainerSpec {
  label: string;
  length: number;
  width: number;
  height: number;
  payloadKg: number;
}

export const CONTAINERS: Record<ContainerType, ContainerSpec> = {
  "20DC": { label: "20' DC", length: 5.9, width: 2.35, height: 2.39, payloadKg: 28200 },
  "40DC": { label: "40' DC", length: 12.03, width: 2.35, height: 2.39, payloadKg: 26700 },
  "40HC": { label: "40' HC", length: 12.03, width: 2.35, height: 2.69, payloadKg: 26500 },
  "40RF": { label: "40' Reefer", length: 11.56, width: 2.28, height: 2.25, payloadKg: 27700 },
};

export function isContainerType(v: unknown): v is ContainerType {
  return typeof v === "string" && (CONTAINER_TYPES as readonly string[]).includes(v);
}

export interface CargoInput {
  type: string | null;
  m3: number;
  kg: number;
  /** itens sem dimensões ou peso no cadastro (a estimativa fica incompleta) */
  missing?: number;
}

export interface ContainerLoad {
  spec: ContainerSpec;
  m3: number;
  kg: number;
  volumePct: number;
  weightPct: number;
  /** o maior dos dois: é o que limita */
  pct: number;
  limit: "volume" | "weight";
  level: "ok" | "warning" | "over";
  missing: number;
}

/** Ocupação do contêiner; `null` quando o tipo não foi informado. */
export function containerLoad(c: CargoInput): ContainerLoad | null {
  if (!isContainerType(c.type)) return null;
  const spec = CONTAINERS[c.type];
  const cap = spec.length * spec.width * spec.height;
  const volumePct = (Math.max(0, c.m3) / cap) * 100;
  const weightPct = (Math.max(0, c.kg) / spec.payloadKg) * 100;
  const pct = Math.max(volumePct, weightPct);
  return {
    spec,
    m3: c.m3,
    kg: c.kg,
    volumePct,
    weightPct,
    pct,
    limit: volumePct >= weightPct ? "volume" : "weight",
    level: pct > 100 ? "over" : pct > 85 ? "warning" : "ok",
    missing: c.missing ?? 0,
  };
}
