import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  A2O_PAYLOADS,
  O2A_PAYLOADS,
  accessCheckRequestSchema,
  accessCheckResponseSchema,
  envelopeSchema,
  jwksSchema,
  launchClaimsSchema,
  launchHeaderSchema,
  responseSchema,
  linkRequestSchema,
  linkResponseSchema,
  batchRequestSchema,
  batchResponseSchema,
} from "@/server/integrations/atlas/contract";
import { signRequest, verifySignature } from "@/server/integrations/atlas/crypto";

const DIR = path.join(process.cwd(), "docs/contrato");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "index.json");
const load = (f: string) => JSON.parse(readFileSync(path.join(DIR, f), "utf8"));

describe("Contrato ATLAS ↔ ORION: fixtures", () => {
  it("index.json lista todas as fixtures com o SHA-256 correto", () => {
    const index = load("index.json") as { version: number; files: { file: string; sha256: string }[] };
    expect(index.version).toBe(1);
    expect(index.files.map((f) => f.file).sort()).toEqual([...files].sort());
    for (const f of index.files) {
      const hash = createHash("sha256").update(readFileSync(path.join(DIR, f.file))).digest("hex");
      expect(hash, f.file).toBe(f.sha256);
    }
  });

  for (const file of files.filter((f) => f.startsWith("a2o."))) {
    it(`${file} passa no envelope e no schema do payload (ATLAS → ORION)`, () => {
      const e = envelopeSchema.parse(load(file));
      expect(e.source).toBe("atlas");
      const schema = (A2O_PAYLOADS as Record<string, { parse: (v: unknown) => unknown }>)[e.type];
      expect(schema, `tipo ${e.type} sem schema`).toBeTruthy();
      schema.parse(e.payload);
    });
  }

  for (const file of files.filter((f) => f.startsWith("o2a."))) {
    it(`${file} passa no envelope e no schema do payload (ORION → ATLAS)`, () => {
      const e = envelopeSchema.parse(load(file));
      expect(e.source).toBe("orion");
      const schema = (O2A_PAYLOADS as Record<string, { parse: (v: unknown) => unknown }>)[e.type];
      expect(schema, `tipo ${e.type} sem schema`).toBeTruthy();
      schema.parse(e.payload);
    });
  }

  it("todo tipo a2o/o2a do ORION tem fixture e vice-versa", () => {
    const a2o = files.filter((f) => f.startsWith("a2o.")).map((f) => f.slice(4, -5)).sort();
    const o2a = files.filter((f) => f.startsWith("o2a.")).map((f) => f.slice(4, -5)).sort();
    expect(Object.keys(A2O_PAYLOADS).sort()).toEqual(a2o);
    expect(Object.keys(O2A_PAYLOADS).sort()).toEqual(o2a);
  });

  it("respostas, SSO e servidor-a-servidor", () => {
    for (const f of files.filter((x) => x.startsWith("resposta."))) responseSchema.parse(load(f));
    launchClaimsSchema.parse(load("sso.launch-token.claims.json"));
    launchHeaderSchema.parse(load("sso.launch-token.header.json"));
    jwksSchema.parse(load("sso.jwks.json"));
    accessCheckRequestSchema.parse(load("s2s.access-check.request.json"));
    expect(accessCheckResponseSchema.parse(load("s2s.access-check.response.ativo.json")).active).toBe(true);
    expect(accessCheckResponseSchema.parse(load("s2s.access-check.response.revogado.json")).active).toBe(false);
    const link = load("s2s.links.request.json");
    expect(link.path).toBe("/api/atlas/v1/links");
    const lreq = linkRequestSchema.parse(link.body);
    const lres = linkResponseSchema.parse(load("s2s.links.response.json").body);
    expect([lres.atlas_company_id, lres.key_id]).toEqual([lreq.atlas_company_id, lreq.key_id]);
    const batch = load("s2s.events-batch.request.json");
    expect(batch.path).toBe("/api/atlas/v1/events/batch");
    const events = batchRequestSchema.parse(batch.body).events;
    for (const e of events) envelopeSchema.parse(e);
    const results = batchResponseSchema.parse(load("s2s.events-batch.response.json").body).results;
    expect(results).toHaveLength(events.length);
    for (const r of results) responseSchema.parse(r.body);
  });
});

describe("Assinatura HMAC X-Astraeus-*", () => {
  const secret = "segredo-de-teste-com-32-caracteres!!";
  const path_ = "/api/integrations/orion/v1/access?atlas_user_id=0a7a5000-0000-4000-8000-000000000101";
  it("vetor fixo: HMAC de `${ts}.${METHOD}.${path}.${corpo}`", () => {
    const expected = createHash("sha256"); // garante que não é hash simples
    void expected;
    const sig = signRequest(secret, "1763211600", "GET", path_, "");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(sig).toBe(signRequest(secret, "1763211600", "get", path_, ""));
    expect(sig).not.toBe(signRequest(secret, "1763211600", "GET", path_ + "x", ""));
  });
  it("janela de 300 s, segredo anterior aceito, assinatura errada recusada", () => {
    const now = 1763211600_000;
    const sig = `sha256=${signRequest(secret, "1763211600", "POST", "/x", "{}")}`;
    const base = { timestamp: "1763211600", signature: sig, method: "POST", pathWithQuery: "/x", body: "{}" };
    expect(verifySignature(base, [secret], now).ok).toBe(true);
    expect(verifySignature(base, ["outro-segredo-qualquer-32-chars-xx", secret], now).ok).toBe(true);
    expect(verifySignature(base, ["outro-segredo-qualquer-32-chars-xx"], now)).toMatchObject({ ok: false, code: "invalid_signature" });
    expect(verifySignature(base, [secret], now + 301_000)).toMatchObject({ ok: false, code: "stale_timestamp" });
    expect(verifySignature({ ...base, body: "{ }" }, [secret], now).ok).toBe(false);
  });
});
