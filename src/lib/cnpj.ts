/** Utilitários de CNPJ (somente dígitos, validação do dígito verificador e máscara). */

export const onlyDigits = (value: string | null | undefined): string => (value ?? "").replace(/\D/g, "");

function checkDigit(base: string): number {
  let weight = base.length - 7;
  let sum = 0;
  for (const ch of base) {
    sum += Number(ch) * weight;
    weight = weight === 2 ? 9 : weight - 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** CNPJ válido: 14 dígitos, não repetidos, com os dois dígitos verificadores corretos. */
export function isValidCnpj(value: string | null | undefined): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const first = checkDigit(d.slice(0, 12));
  const second = checkDigit(d.slice(0, 12) + first);
  return d.endsWith(`${first}${second}`);
}

export function formatCnpj(value: string | null | undefined): string {
  const d = onlyDigits(value);
  if (d.length !== 14) return value ?? "";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function formatCep(value: string | null | undefined): string {
  const d = onlyDigits(value);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (value ?? "");
}
