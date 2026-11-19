import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { isDemoMode } from "@/server/demo-mode";
import { loadDemoAdmin } from "@/server/auth/users";
import { createTestEnv, type TestEnv } from "./helpers";

describe("Modo demonstração", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("não liga sozinho: nem na Vercel sem DATABASE_URL", () => {
    vi.stubEnv("WMS_DEMO_MODE", "");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(isDemoMode()).toBe(false);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(isDemoMode()).toBe(false);
  });

  it("só WMS_DEMO_MODE=true liga", () => {
    vi.stubEnv("WMS_DEMO_MODE", "false");
    expect(isDemoMode()).toBe(false);
    vi.stubEnv("WMS_DEMO_MODE", "true");
    expect(isDemoMode()).toBe(true);
  });

  describe("entrada automática", () => {
    let env: TestEnv;
    beforeAll(async () => {
      env = await createTestEnv();
    });

    it("entra como a administradora da empresa de demonstração", async () => {
      const user = await loadDemoAdmin(env.db);
      expect(user?.role).toBe("admin");
      expect(user?.companyIsDemo).toBe(true);
    });

    it("não entra como usuário que não é de demonstração", async () => {
      await env.db.query(`update wms.users set is_demo = false`);
      expect(await loadDemoAdmin(env.db)).toBeNull();
    });
  });
});
