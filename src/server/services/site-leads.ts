import "server-only";
import type { Queryable } from "../db/types";
import { DomainError } from "../errors";

/** Turma de implantação divulgada na página pública. */
export const TURMA_ATUAL = { ano: "2027", vagas: 12, preenchidas: 9, fechaEm: "15 de dezembro" } as const;

export interface LeadResult {
  created: boolean;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Grava o e-mail deixado na página pública (uma vez por e-mail e turma). */
export async function registrarLead(db: Queryable, input: { email: unknown; cohort?: string }): Promise<LeadResult> {
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL.test(email)) throw new DomainError("Informe um e-mail de trabalho válido.", "VALIDATION");
  const cohort = input.cohort ?? TURMA_ATUAL.ano;
  const rows = await db.query<{ id: string }>(
    `insert into public.site_leads (email, cohort) values ($1, $2)
     on conflict (lower(email), cohort) do nothing returning id`,
    [email, cohort],
  );
  return { created: rows.length > 0 };
}
