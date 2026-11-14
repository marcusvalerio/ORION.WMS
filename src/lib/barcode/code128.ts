/**
 * Codificador Code 128 (ISO/IEC 15417) sem dependências.
 *
 * Usa o conjunto B (ASCII 32–127) e alterna para o conjunto C (pares de dígitos)
 * em sequências numéricas longas, o que encurta EANs e códigos numéricos.
 * Caracteres de controle (conjunto A) não são suportados.
 */

/** Larguras barra/espaço (6 elementos, soma 11 módulos) dos símbolos 0–106; 106 = STOP (7 elementos, 13 módulos). */
export const PATTERNS: readonly string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

export const START_B = 104;
export const START_C = 105;
export const CODE_B = 100; // em C: muda para B
export const CODE_C = 99; // em B: muda para C
export const STOP = 106;

export class Code128Error extends Error {}

const isDigit = (c: string) => c >= "0" && c <= "9";

function digitRun(text: string, from: number): number {
  let n = 0;
  while (from + n < text.length && isDigit(text[from + n])) n++;
  return n;
}

/** Converte o texto na sequência de valores de símbolo (sem checksum e sem STOP). */
export function encodeValues(text: string): number[] {
  if (text.length === 0) throw new Code128Error("Texto vazio não pode ser codificado.");
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch.length !== 1 || code < 32 || code > 127) {
      throw new Code128Error(`Caractere não suportado no Code 128: "${ch}".`);
    }
  }
  const values: number[] = [];
  let i = 0;
  const lead = digitRun(text, 0);
  // Começa em C quando o texto inteiro é numérico par (≥ 2) ou abre com ≥ 4 dígitos.
  let set: "B" | "C" = (lead === text.length && lead % 2 === 0) || lead >= 4 ? "C" : "B";
  values.push(set === "C" ? START_C : START_B);
  while (i < text.length) {
    if (set === "C") {
      const run = digitRun(text, i);
      if (run >= 2) {
        values.push(Number(text.slice(i, i + 2)));
        i += 2;
        continue;
      }
      values.push(CODE_B);
      set = "B";
      continue;
    }
    const run = digitRun(text, i);
    // Vale trocar para C em ≥ 6 dígitos no meio ou ≥ 4 no fim do texto.
    if (run >= 6 || (run >= 4 && i + run === text.length)) {
      if (run % 2 === 1) {
        values.push(text.charCodeAt(i) - 32);
        i++;
      }
      values.push(CODE_C);
      set = "C";
      continue;
    }
    values.push(text.charCodeAt(i) - 32);
    i++;
  }
  return values;
}

/** Dígito verificador: (início + Σ valor × posição) mod 103. */
export function checksum(values: number[]): number {
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  return sum % 103;
}

export interface Code128 {
  text: string;
  values: number[];
  checksum: number;
  /** Larguras alternadas barra/espaço em módulos, começando por barra, incluindo STOP. */
  widths: number[];
  /** Largura total em módulos, sem zona de silêncio. */
  modules: number;
}

export function encodeCode128(text: string): Code128 {
  const values = encodeValues(text);
  const check = checksum(values);
  const symbols = [...values, check, STOP];
  const widths = symbols.flatMap((v) => PATTERNS[v].split("").map(Number));
  return { text, values, checksum: check, widths, modules: widths.reduce((a, b) => a + b, 0) };
}

/** Retângulos das barras (x e largura em módulos), já com a zona de silêncio à esquerda. */
export function barRects(code: Code128, quiet = 10): { x: number; w: number }[] {
  const rects: { x: number; w: number }[] = [];
  let x = quiet;
  code.widths.forEach((w, i) => {
    if (i % 2 === 0) rects.push({ x, w });
    x += w;
  });
  return rects;
}

/** Decodifica os valores de volta ao texto (usado nos testes para garantir ida e volta). */
export function decodeValues(values: number[]): string {
  let set: "B" | "C" = values[0] === START_C ? "C" : "B";
  let out = "";
  for (const v of values.slice(1)) {
    if (set === "C") {
      if (v === CODE_B) set = "B";
      else out += String(v).padStart(2, "0");
    } else if (v === CODE_C) set = "C";
    else out += String.fromCharCode(v + 32);
  }
  return out;
}
