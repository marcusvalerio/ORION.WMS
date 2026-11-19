/**
 * Assistente "Montar armazém": a pessoa descreve o CD por áreas (porta-palete,
 * picking, câmara fria, docas…) com ruas × módulos × níveis × posições, e o
 * sistema gera zonas e endereços de uma vez. Código puro: a prévia no navegador
 * e o servidor usam o mesmo plano, então o que aparece em 3D é o que é criado.
 */
export const AREA_KINDS = ["rack", "shelf", "cold", "floor", "receiving", "shipping", "quarantine"] as const;
export type AreaKind = (typeof AREA_KINDS)[number];

export interface AreaKindSpec {
  label: string;
  hint: string;
  zoneType: "storage" | "picking" | "receiving" | "shipping" | "quarantine";
  locationType: "rack" | "shelf" | "floor" | "dock" | "quarantine";
  storageClass: "general" | "refrigerated" | null;
  /** docas e quarentena: uma fileira só, sem níveis */
  flat: boolean;
  defaults: { code: string; name: string; aisles: number; bays: number; levels: number; positions: number; capacity: number };
}

export const AREA_KIND_SPECS: Record<AreaKind, AreaKindSpec> = {
  rack: {
    label: "Porta-palete",
    hint: "Estrutura de paletes em ruas e níveis",
    zoneType: "storage",
    locationType: "rack",
    storageClass: "general",
    flat: false,
    defaults: { code: "PP", name: "Armazenagem porta-palete", aisles: 3, bays: 20, levels: 4, positions: 1, capacity: 1000 },
  },
  shelf: {
    label: "Picking / prateleira",
    hint: "Prateleiras para separação fracionada",
    zoneType: "picking",
    locationType: "shelf",
    storageClass: "general",
    flat: false,
    defaults: { code: "PK", name: "Picking", aisles: 2, bays: 10, levels: 5, positions: 1, capacity: 200 },
  },
  cold: {
    label: "Câmara fria",
    hint: "Porta-palete refrigerado",
    zoneType: "storage",
    locationType: "rack",
    storageClass: "refrigerated",
    flat: false,
    defaults: { code: "FRI", name: "Câmara fria", aisles: 1, bays: 6, levels: 3, positions: 1, capacity: 600 },
  },
  floor: {
    label: "Piso / blocado",
    hint: "Paletes no chão, em fileiras",
    zoneType: "storage",
    locationType: "floor",
    storageClass: "general",
    flat: true,
    defaults: { code: "BLC", name: "Blocado", aisles: 2, bays: 10, levels: 1, positions: 1, capacity: 2000 },
  },
  receiving: {
    label: "Doca de recebimento",
    hint: "Onde a carga chega e é conferida",
    zoneType: "receiving",
    locationType: "dock",
    storageClass: null,
    flat: true,
    defaults: { code: "REC", name: "Docas de recebimento", aisles: 1, bays: 3, levels: 1, positions: 1, capacity: 5000 },
  },
  shipping: {
    label: "Doca de expedição",
    hint: "Onde os pedidos aguardam o caminhão",
    zoneType: "shipping",
    locationType: "dock",
    storageClass: null,
    flat: true,
    defaults: { code: "EXP", name: "Docas de expedição", aisles: 1, bays: 3, levels: 1, positions: 1, capacity: 5000 },
  },
  quarantine: {
    label: "Quarentena",
    hint: "Material bloqueado ou avariado",
    zoneType: "quarantine",
    locationType: "quarantine",
    storageClass: "general",
    flat: true,
    defaults: { code: "QRT", name: "Quarentena", aisles: 1, bays: 4, levels: 1, positions: 1, capacity: 1000 },
  },
};

export interface WizardArea {
  kind: AreaKind;
  code: string;
  name: string;
  aisles: number;
  bays: number;
  levels: number;
  positions: number;
  capacity: number;
}

export const LIMITS = { aisles: 40, bays: 99, levels: 20, positions: 10, total: 6000 } as const;

export function newArea(kind: AreaKind): WizardArea {
  return { kind, ...AREA_KIND_SPECS[kind].defaults };
}

export const TEMPLATES: { id: string; label: string; hint: string; areas: AreaKind[] }[] = [
  { id: "pequeno", label: "Galpão pequeno", hint: "Porta-palete e docas", areas: ["rack", "receiving", "shipping"] },
  { id: "cd", label: "CD com picking", hint: "Porta-palete, picking e docas", areas: ["rack", "shelf", "receiving", "shipping"] },
  { id: "frio", label: "CD com câmara fria", hint: "Porta-palete, câmara fria, picking e docas", areas: ["rack", "cold", "shelf", "receiving", "shipping"] },
  { id: "prateleiras", label: "Só prateleiras", hint: "Estoque leve, separação manual", areas: ["shelf", "receiving", "shipping"] },
];

const pad2 = (n: number) => String(n).padStart(2, "0");

export interface PlannedAisle {
  areaIndex: number;
  aisle: string;
  bays: number;
  levels: number;
  positions: number;
}

export interface LayoutPlan {
  aisles: PlannedAisle[];
  total: number;
  perArea: number[];
  errors: string[];
}

/**
 * Plano de ruas. Áreas de armazenagem numeram as ruas em sequência a partir de
 * `firstAisle` (a próxima livre no depósito); docas e quarentena usam a própria
 * sigla como rua (REC, EXP, QRT), com os módulos numerados.
 */
export function planLayout(areas: WizardArea[], firstAisle = 1): LayoutPlan {
  const errors: string[] = [];
  const aisles: PlannedAisle[] = [];
  const perArea: number[] = [];
  const codes = new Set<string>();
  let next = firstAisle;
  areas.forEach((a, i) => {
    const spec = AREA_KIND_SPECS[a.kind];
    const label = a.name || spec.label;
    const code = a.code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{1,20}$/.test(code)) errors.push(`${label}: código da zona deve ter só letras, números e hífen.`);
    if (codes.has(code)) errors.push(`${label}: o código ${code} já foi usado em outra área.`);
    codes.add(code);
    const ints: [keyof WizardArea, number, number, string][] = [
      ["aisles", 1, LIMITS.aisles, "ruas"],
      ["bays", 1, LIMITS.bays, "módulos"],
      ["levels", 1, LIMITS.levels, "níveis"],
      ["positions", 1, LIMITS.positions, "posições por nível"],
    ];
    for (const [k, min, max, name] of ints) {
      const v = a[k] as number;
      if (!Number.isInteger(v) || v < min || v > max) errors.push(`${label}: ${name} deve ser de ${min} a ${max}.`);
    }
    if (!(a.capacity > 0)) errors.push(`${label}: capacidade deve ser maior que zero.`);
    let count = 0;
    if (spec.flat) {
      const aisle = code.replace(/-/g, "").slice(0, 6) || "DOC";
      aisles.push({ areaIndex: i, aisle, bays: a.bays, levels: 1, positions: a.positions });
      count = a.bays * a.positions;
    } else {
      for (let k = 0; k < a.aisles; k++) {
        aisles.push({ areaIndex: i, aisle: pad2(next++), bays: a.bays, levels: a.levels, positions: a.positions });
      }
      count = a.aisles * a.bays * a.levels * a.positions;
    }
    perArea.push(count);
  });
  const flatAisles = aisles.filter((x) => AREA_KIND_SPECS[areas[x.areaIndex].kind].flat).map((x) => x.aisle);
  if (new Set(flatAisles).size !== flatAisles.length) errors.push("Duas áreas de doca/quarentena geraram a mesma rua: use códigos diferentes.");
  const total = perArea.reduce((s, n) => s + n, 0);
  if (!areas.length) errors.push("Adicione ao menos uma área.");
  if (total > LIMITS.total) errors.push(`São ${total} endereços: o limite por montagem é ${LIMITS.total}. Monte em partes.`);
  return { aisles, total, perArea, errors };
}

/** Segmentos de cada endereço de uma rua planejada (módulo 01…, nível 01…, posição 00…). */
export function aisleSlots(a: PlannedAisle): { bay: string; level: string; position: string }[] {
  const out: { bay: string; level: string; position: string }[] = [];
  for (let b = 1; b <= a.bays; b++)
    for (let l = 1; l <= a.levels; l++) for (let p = 0; p < a.positions; p++) out.push({ bay: pad2(b), level: pad2(l), position: pad2(p) });
  return out;
}
