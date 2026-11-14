/**
 * Regras de comércio exterior compartilhadas entre servidor e interface:
 * Incoterms 2020, códigos de país ISO 3166-1 alfa-2, NCM e contêiner ISO 6346.
 * O banco repete as mesmas regras em CHECK (migration 20261114000006).
 */

export const INCOTERMS_2020 = [
  { code: "EXW", label: "EXW — Ex Works / Na origem" },
  { code: "FCA", label: "FCA — Free Carrier / Livre no transportador" },
  { code: "CPT", label: "CPT — Carriage Paid To / Transporte pago até" },
  { code: "CIP", label: "CIP — Carriage and Insurance Paid To / Transporte e seguro pagos até" },
  { code: "DAP", label: "DAP — Delivered at Place / Entregue no local" },
  { code: "DPU", label: "DPU — Delivered at Place Unloaded / Entregue no local desembarcado" },
  { code: "DDP", label: "DDP — Delivered Duty Paid / Entregue com direitos pagos" },
  { code: "FAS", label: "FAS — Free Alongside Ship / Livre ao lado do navio" },
  { code: "FOB", label: "FOB — Free on Board / Livre a bordo" },
  { code: "CFR", label: "CFR — Cost and Freight / Custo e frete" },
  { code: "CIF", label: "CIF — Cost, Insurance and Freight / Custo, seguro e frete" },
] as const;

export const INCOTERM_CODES: readonly string[] = INCOTERMS_2020.map((i) => i.code);

/** Códigos ISO 3166-1 alfa-2 atribuídos oficialmente. */
const ISO_COUNTRIES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
  "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG " +
  "UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");
const COUNTRY_SET = new Set(ISO_COUNTRIES);

export function isCountryCode(value: string): boolean {
  return COUNTRY_SET.has(value);
}

export function isNcm(value: string): boolean {
  return /^[0-9]{8}$/.test(value);
}

/** Remove pontos/espaços de um NCM digitado como 8471.30.12. */
export function normalizeNcm(value: string): string {
  return value.replace(/[.\s-]/g, "");
}

const ISO6346_ALPHABET = "0123456789A?BCDEFGHIJK?LMNOPQRSTU?VWXYZ";

/** Dígito verificador ISO 6346 dos 10 primeiros caracteres (ex.: "CSQU305438" → 3). */
export function iso6346CheckDigit(first10: string): number {
  let total = 0;
  for (let i = 0; i < 10; i++) total += ISO6346_ALPHABET.indexOf(first10[i]) * 2 ** i;
  return (total % 11) % 10;
}

/** Normaliza (maiúsculas, sem espaços/hífens) um número de contêiner. */
export function normalizeContainer(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, "");
}

/** Valida número de contêiner ISO 6346: AAAU1234567 com dígito verificador correto. */
export function isValidContainer(value: string): boolean {
  if (!/^[A-Z]{3}[UJZ][0-9]{7}$/.test(value)) return false;
  return iso6346CheckDigit(value.slice(0, 10)) === Number(value[10]);
}
