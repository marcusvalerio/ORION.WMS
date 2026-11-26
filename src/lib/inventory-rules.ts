/**
 * Regras puras do inventário (testáveis sem banco): tolerância por classe ABC,
 * decisão das rodadas de contagem e esperado ajustado no modo `reconcile`.
 */

export type AbcClass = "A" | "B" | "C";

export interface Tolerance {
  abc_class: AbcClass;
  /** tolerância em % do esperado */
  tolerance_pct: number;
  /** tolerância em unidades (vale o maior entre % e unidades) */
  tolerance_units: number;
  /** alçada em R$: diferença valorizada acima disso exige o perfil `approval_role` */
  approval_limit_value: number;
  approval_role: "supervisor" | "admin";
}

export const DEFAULT_TOLERANCES: Record<AbcClass, Tolerance> = {
  A: { abc_class: "A", tolerance_pct: 1, tolerance_units: 0, approval_limit_value: 500, approval_role: "admin" },
  B: { abc_class: "B", tolerance_pct: 2, tolerance_units: 0, approval_limit_value: 500, approval_role: "admin" },
  C: { abc_class: "C", tolerance_pct: 5, tolerance_units: 0, approval_limit_value: 500, approval_role: "admin" },
};

/** Frequência padrão do rotativo, em dias: A semanal, B mensal, C trimestral. */
export const DEFAULT_CYCLE_DAYS: Record<AbcClass, number> = { A: 7, B: 30, C: 90 };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Diferença permitida (em unidades) para um esperado: o maior entre o % e as unidades. */
export function allowedDifference(expected: number, tol: Pick<Tolerance, "tolerance_pct" | "tolerance_units">): number {
  return Math.max(r3((Math.abs(expected) * tol.tolerance_pct) / 100), tol.tolerance_units);
}

export function withinTolerance(expected: number, counted: number, tol: Pick<Tolerance, "tolerance_pct" | "tolerance_units">): boolean {
  return Math.abs(r3(counted - expected)) <= allowedDifference(expected, tol);
}

export type RoundDecision = { closed: true; value: number } | { closed: false; nextRound: 2 | 3 };

/**
 * Decide o item depois de uma contagem.
 *  - 1ª dentro da tolerância: fecha; fora: pede a 2ª contagem cega (outro usuário).
 *  - 2ª igual à 1ª: fecha com esse valor; diferente: pede a 3ª (supervisor).
 *  - 3ª: vale o valor que se repetir; se as três forem diferentes, vale a 3ª.
 */
export function decideRounds(expected: number, counts: number[], tol: Pick<Tolerance, "tolerance_pct" | "tolerance_units">): RoundDecision {
  const [c1, c2, c3] = counts.map(r3);
  if (counts.length === 1) return withinTolerance(expected, c1, tol) ? { closed: true, value: c1 } : { closed: false, nextRound: 2 };
  if (counts.length === 2) return c1 === c2 ? { closed: true, value: c2 } : { closed: false, nextRound: 3 };
  if (c3 === c1 || c3 === c2) return { closed: true, value: c3 };
  if (c1 === c2) return { closed: true, value: c1 };
  return { closed: true, value: c3 };
}

/** Modo `reconcile`: esperado ajustado = foto + entradas − saídas desde a foto. */
export function adjustedExpected(snapshot: number, inbound: number, outbound: number): number {
  return r3(snapshot + inbound - outbound);
}

/** "1 item contado" / "3 itens contados". */
export function plural(n: number, singular: string, pluralForm: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? singular : pluralForm}`;
}

/** Endereço abreviado para a folha: "R02 · M05 · N2 · P1". */
export function shortLocation(l: { aisle?: string | null; bay?: string | null; level?: string | null; position?: string | null; code: string }): string {
  if (!l.aisle || !l.bay || !l.level) return l.code;
  const parts = [`R${l.aisle.padStart(2, "0")}`, `M${l.bay.padStart(2, "0")}`, `N${l.level}`];
  if (l.position) parts.push(`P${l.position}`);
  return parts.join(" · ");
}
