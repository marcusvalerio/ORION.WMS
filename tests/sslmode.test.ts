import { describe, expect, it } from "vitest";
import { normalizarSslMode } from "@/server/db/drivers";

describe("normalizarSslMode", () => {
  it("troca require por verify-full", () => {
    expect(normalizarSslMode("postgres://u:p@h/db?sslmode=require")).toBe("postgres://u:p@h/db?sslmode=verify-full");
    expect(normalizarSslMode("postgres://u:p@h/db?sslmode=require&channel_binding=require")).toBe(
      "postgres://u:p@h/db?sslmode=verify-full&channel_binding=require",
    );
  });
  it("não mexe em disable nem em URL sem sslmode", () => {
    expect(normalizarSslMode("postgres://u:p@h/db?sslmode=disable")).toBe("postgres://u:p@h/db?sslmode=disable");
    expect(normalizarSslMode("postgres://u:p@h/db")).toBe("postgres://u:p@h/db");
  });
});
