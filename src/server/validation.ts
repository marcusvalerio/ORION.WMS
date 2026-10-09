import { z } from "zod";
import { DomainError } from "./errors";

/** Valida a entrada de um serviço; a primeira mensagem de erro é devolvida ao usuário. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join(".");
    throw new DomainError(issue.message, "VALIDATION", field || undefined);
  }
  return result.data;
}

export const uuid = (label = "Registro") => z.string({ error: `${label} é obrigatório.` }).uuid(`${label} inválido.`);
export const optionalUuid = z
  .string()
  .uuid()
  .nullish()
  .or(z.literal("").transform(() => null));
export const qty = (label = "Quantidade") =>
  z.coerce.number({ error: `${label} inválida.` }).finite(`${label} inválida.`).positive(`${label} deve ser maior que zero.`);
export const nonNegQty = (label = "Quantidade") =>
  z.coerce.number({ error: `${label} inválida.` }).finite(`${label} inválida.`).min(0, `${label} não pode ser negativa.`);
export const optionalText = z
  .string()
  .trim()
  .max(2000)
  .nullish()
  .transform((v) => (v ? v : null));
export const optionalDate = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Data inválida (use AAAA-MM-DD).");
/** Checkbox de formulário: ausente/desmarcado → false. */
export const checkbox = z
  .unknown()
  .optional()
  .transform((v) => v === true || v === "on" || v === "true");
