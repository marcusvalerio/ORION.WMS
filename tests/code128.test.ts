import { describe, expect, it } from "vitest";
import {
  PATTERNS,
  START_B,
  START_C,
  CODE_B,
  CODE_C,
  STOP,
  barRects,
  checksum,
  decodeValues,
  encodeCode128,
  encodeValues,
} from "@/lib/barcode/code128";

describe("Code 128", () => {
  it("tabela de padrões: 107 símbolos, 11 módulos cada (STOP 13), todos distintos", () => {
    expect(PATTERNS).toHaveLength(107);
    PATTERNS.forEach((p, i) => {
      const sum = p.split("").map(Number).reduce((a, b) => a + b, 0);
      expect(sum, `símbolo ${i}`).toBe(i === STOP ? 13 : 11);
      // barras ocupam número par de módulos (paridade do Code 128)
      const bars = p.split("").map(Number).filter((_, k) => k % 2 === 0).reduce((a, b) => a + b, 0);
      expect(bars % 2, `paridade ${i}`).toBe(0);
    });
    expect(new Set(PATTERNS).size).toBe(107);
  });

  it("checksum do exemplo clássico PJJ123C (conjunto B)", () => {
    const values = encodeValues("PJJ123C");
    expect(values).toEqual([START_B, 48, 42, 42, 17, 18, 19, 35]);
    // 104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7 = 879 → 879 mod 103 = 55
    expect(checksum(values)).toBe(55);
  });

  it("checksum de texto curto calculado à mão", () => {
    // "AB": 104 + 33·1 + 34·2 = 205 → 205 mod 103 = 102
    expect(encodeCode128("AB").checksum).toBe(102);
  });

  it("EAN-13 numérico usa o conjunto C (pares de dígitos)", () => {
    const c = encodeCode128("7890000000017");
    // 13 dígitos (ímpar): começa em C com 6 pares e volta a B para o último dígito
    expect(c.values[0]).toBe(START_C);
    expect(c.values.slice(1, 7)).toEqual([78, 90, 0, 0, 0, 1]);
    expect(c.values).toContain(CODE_B);
    expect(decodeValues(c.values)).toBe("7890000000017");
    const even = encodeValues("12345678");
    expect(even).toEqual([START_C, 12, 34, 56, 78]);
    expect(checksum(even)).toBe((105 + 12 * 1 + 34 * 2 + 56 * 3 + 78 * 4) % 103);
  });

  it("alterna B→C em sequência numérica longa no meio do texto", () => {
    const values = encodeValues("AB1234567X");
    expect(values[0]).toBe(START_B);
    expect(values).toContain(CODE_C);
    expect(values).toContain(CODE_B);
    expect(decodeValues(values)).toBe("AB1234567X");
  });

  it("ida e volta em códigos de endereço e pedidos", () => {
    for (const t of ["DEP-01/RUA-02/MOD-01/NIV-01/POS-00", "SAI-000123", "CIA-001", "a b~", "0", "99"]) {
      expect(decodeValues(encodeValues(t))).toBe(t);
    }
  });

  it("estrutura: termina com checksum e STOP, módulos = 11·símbolos + 2", () => {
    const c = encodeCode128("SAI-000001");
    const symbols = c.values.length + 2; // + checksum + STOP
    expect(c.modules).toBe(11 * symbols + 2);
    expect(c.widths.slice(-7).join("")).toBe(PATTERNS[STOP]);
    expect(barRects(c)[0].x).toBe(10);
    expect(barRects(c).length).toBe(Math.ceil(c.widths.length / 2));
  });

  it("recusa caracteres fora do ASCII imprimível e texto vazio", () => {
    expect(() => encodeCode128("")).toThrow();
    expect(() => encodeCode128("ação")).toThrow(/não suportado/);
    expect(() => encodeCode128("a\nb")).toThrow();
  });
});
