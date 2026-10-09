import { describe, expect, it } from "vitest";
import { dropBlankRows, formToObject } from "@/lib/action-state";
import { fmtDate, fmtDateTime, fmtQty } from "@/lib/format";

describe("Utilitários de formulário e formatação", () => {
  it("converte FormData em objeto aninhado e ignora campos de controle", () => {
    const fd = new FormData();
    fd.set("_key", "abc");
    fd.set("_id", "x");
    fd.set("items.0.itemId", "a");
    fd.set("items.0.countedQty", "10");
    fd.set("items[1].itemId", "b");
    fd.set("notes", "ok");
    expect(formToObject(fd)).toEqual({ items: [{ itemId: "a", countedQty: "10" }, { itemId: "b" }], notes: "ok" });
  });

  it("descarta linhas opcionais em branco", () => {
    const data: Record<string, unknown> = { lines: [{ productId: "p1", quantity: "2" }, { productId: "", quantity: "" }] };
    dropBlankRows(data, "lines", "productId");
    expect(data.lines).toEqual([{ productId: "p1", quantity: "2" }]);
  });

  it("formata timestamps do Postgres (offset +00, microssegundos) e datas", () => {
    expect(fmtDateTime("2026-10-09 18:15:00.123456+00")).toBe("09/10/2026, 15:15");
    expect(fmtDate("2026-10-09")).toBe("09/10/2026");
    expect(fmtDateTime(null)).toBe("—");
    expect(fmtQty(1234.5)).toBe("1.234,5");
  });
});
