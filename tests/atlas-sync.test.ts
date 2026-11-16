import { beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { createTestEnv, type TestEnv } from "./helpers";
import { linkCompany, request, ssoKeys, testEnv, INSTALL, type AtlasCompanySim } from "./atlas-helpers";
import { O2A_PAYLOADS, batchResponseSchema, envelopeSchema, linkResponseSchema } from "@/server/integrations/atlas/contract";
import { handleBalances, handleBatch, handleCapabilities, handleDeleteLink, handleDocument, handleEvent, handlePostLink } from "@/server/integrations/atlas/api";
import { resolveProductCode } from "@/server/services/collector";
import { fixture } from "./atlas-helpers";
import { verifySignature } from "@/server/integrations/atlas/crypto";
import { completeAtlasSso } from "@/server/integrations/atlas/sso-flow";
import { enforceAtlasAccess, reprocessAtlasEvent, systemCtxForTests } from "./atlas-test-utils";
import { loadSessionUser, authenticate } from "@/server/auth/users";
import { shipOrder } from "@/server/services/outbound";
import { updateUser } from "@/server/services/users";
import { processOutbox } from "@/server/integrations/outbox/processor";
import { atlasTransport, localTransport } from "@/server/integrations/outbox/transports";
import { logEmailTransport } from "@/server/integrations/outbox/email";
import type { Ctx } from "@/server/context";

let env: TestEnv;
let A: AtlasCompanySim;
let adminA: Ctx;

const SO = "0a7a5000-0000-4000-8000-000000000501";

async function setupWarehouse(companyId: string) {
  const db = env.db;
  const [wh] = await db.query<{ id: string }>(`select id from wms.warehouses where company_id = $1 and code = 'DEP-01'`, [companyId]);
  for (const [code, type, loc] of [
    ["REC", "receiving", "DEP-01/REC"],
    ["ARM", "storage", "DEP-01/ARM-01"],
    ["PRD", "production", "DEP-01/LINHA-1"],
  ] as const) {
    const [z] = await db.query<{ id: string }>(
      `insert into wms.zones (company_id, warehouse_id, code, name, zone_type) values ($1,$2,$3,$4,$5) returning id`,
      [companyId, wh.id, code, `Zona ${code}`, type],
    );
    await db.query(
      `insert into wms.locations (company_id, warehouse_id, zone_id, aisle, bay, level, position, code, location_type, capacity_units)
       values ($1,$2,$3,$4,'01','01','00',$5,'floor',100000)`,
      [companyId, wh.id, z.id, code, loc],
    );
  }
}

const product = (id: string, code: string, seq = 1) =>
  A.event("product.upserted", (e) => {
    e.id = crypto.randomUUID();
    e.aggregate.id = id;
    e.aggregate.sequence = seq;
    e.payload.product.atlas_product_id = id;
    e.payload.product.code = code;
    e.payload.product.sku = code;
    e.payload.product.barcode = null;
    e.payload.product.packagings = [];
  });

beforeAll(async () => {
  env = await createTestEnv();
  A = await linkCompany(env.db, { atlasCompanyId: "0a7a5000-0000-4000-8000-000000000001", document: "11444777000161" });
  // administrador local da empresa vinculada (login local antes do SSO)
  await env.db.query(`insert into wms.users (company_id, name, email, role, password_hash) values ($1, 'Admin Local', 'admin@alfa.com.br', 'admin', null)`, [A.orionCompanyId]);
  const [u] = await env.db.query<{ id: string }>(`select id from wms.users where email = 'admin@alfa.com.br'`);
  adminA = { db: env.db, user: (await loadSessionUser(env.db, u.id))! };
  for (const name of ["company.upserted", "integration.activated", "unit.upserted", "product.upserted", "customer.upserted", "supplier.upserted"]) {
    const r = await A.send(A.event(name));
    expect(r.status, `${name}: ${JSON.stringify(r.body)}`).toBe(202);
  }
  await setupWarehouse(A.orionCompanyId);
  for (const [id, code] of [
    ["0a7a5000-0000-4000-8000-000000000203", "PA-1003"],
    ["0a7a5000-0000-4000-8000-000000000204", "KIT-500"],
    ["0a7a5000-0000-4000-8000-000000000202", "PA-1002"],
  ]) {
    expect((await A.send(product(id, code))).status).toBe(202);
  }
}, 120_000);

describe("Cadastros e vínculo", () => {
  it("vínculo cria empresa source=atlas, usuário técnico e segredo cifrado", async () => {
    const c = await env.one<{ source: string; external_id: string; name: string; document: string }>(
      `select source, external_id, name, document from erp.companies where id = $1`,
      [A.orionCompanyId],
    );
    expect(c).toMatchObject({ source: "atlas", external_id: A.atlasCompanyId, name: "Alfa Indústria", document: "11444777000161" });
    const l = await env.one<{ secret_ciphertext: string; status: string }>(`select secret_ciphertext, status from wms.atlas_links where company_id = $1`, [A.orionCompanyId]);
    expect(l.secret_ciphertext.startsWith("v1.")).toBe(true);
    expect(l.secret_ciphertext).not.toContain(A.secret);
    expect(l.status).toBe("activating");
  });

  it("produto, embalagem, cliente, fornecedor, unidade e depósito mapeado", async () => {
    const p = await env.one<{ sku: string; source: string; lot: boolean }>(
      `select p.sku, p.source, s.lot_controlled as lot from erp.products p join wms.product_settings s on s.product_id = p.id
       where p.company_id = $1 and p.external_id = '0a7a5000-0000-4000-8000-000000000201'`,
      [A.orionCompanyId],
    );
    expect(p).toMatchObject({ sku: "PA-1001", source: "atlas", lot: true });
    expect((await env.db.query(`select 1 from erp.customers where company_id = $1 and code = 'CLI-0042'`, [A.orionCompanyId])).length).toBe(1);
    expect((await env.db.query(`select 1 from erp.suppliers where company_id = $1 and code = 'FOR-0007'`, [A.orionCompanyId])).length).toBe(1);
    expect((await env.db.query(`select 1 from wms.atlas_units where company_id = $1 and code = 'CX'`, [A.orionCompanyId])).length).toBe(1);
    expect((await env.db.query(`select 1 from wms.atlas_warehouse_map where company_id = $1`, [A.orionCompanyId])).length).toBe(1);
  });

  it("POST /links no formato das fixtures s2s.links.* (atlas_url aceito)", async () => {
    const req = fixture<{ body: Record<string, Record<string, unknown> | string | null> }>("s2s.links.request").body;
    const atlasId = crypto.randomUUID();
    Object.assign(req, { atlas_company_id: atlasId, key_id: `atlas-co-${atlasId.slice(0, 8)}`, secret: `s-${crypto.randomUUID()}-${crypto.randomUUID()}` });
    req.company = { ...(req.company as Record<string, unknown>), atlas_company_id: atlasId, document: "22333444000181" };
    req.admin = null;
    const body = JSON.stringify(req);
    const r = await handlePostLink(env.db, request("POST", "/api/atlas/v1/links", body, INSTALL.keyId, INSTALL.secret), testEnv());
    expect(r.status, JSON.stringify(r.body)).toBe(fixture<{ http_status: number }>("s2s.links.response").http_status);
    const out = linkResponseSchema.parse(r.body);
    expect(out).toMatchObject({ status: "activating", atlas_company_id: atlasId, key_id: req.key_id });
  });

  it("sku do ATLAS diferente do code vira código de barras alternativo (coletor encontra)", async () => {
    const e = product("0a7a5000-0000-4000-8000-000000000206", "PA-1006", 1);
    e.payload.product.sku = "ALT-PA-1006";
    expect((await A.send(e)).status).toBe(202);
    const pk = await env.one<{ barcode: string; units: number; active: boolean }>(
      `select pu.barcode, pu.units_per_package::float8 as units, pu.active from wms.packaging_units pu join erp.products p on p.id = pu.product_id
       where p.company_id = $1 and p.external_id = '0a7a5000-0000-4000-8000-000000000206' and pu.code = 'ATLAS-SKU'`,
      [A.orionCompanyId],
    );
    expect(pk).toEqual({ barcode: "ALT-PA-1006", units: 1, active: true });
    expect((await resolveProductCode(adminA, "ALT-PA-1006")).sku).toBe("PA-1006");
    // sku igual ao code ⇒ alternativo desativado
    expect((await A.send(product("0a7a5000-0000-4000-8000-000000000206", "PA-1006", 2))).status).toBe(202);
    await expect(resolveProductCode(adminA, "ALT-PA-1006")).rejects.toThrow(/não encontrado/);
  });

  it("upsert de cadastro aceita lacuna e ignora sequência antiga", async () => {
    const old = A.event("product.upserted", (e) => {
      e.id = crypto.randomUUID();
      e.aggregate.sequence = 2;
      e.payload.product.name = "Nome antigo";
    });
    const r = await A.send(old);
    expect(r).toMatchObject({ status: 200, body: { duplicate: true } });
    const p = await env.one<{ description: string }>(`select description from erp.products where company_id = $1 and sku = 'PA-1001'`, [A.orionCompanyId]);
    expect(p.description).toBe("Parafuso sextavado M8 x 30 inox");
  });
});

describe("Entrada de eventos: idempotência, ordem, dependência", () => {
  it("sales_order.released cria pedido de saída e outbound.accepted com ids do ATLAS", async () => {
    const r = await A.send(A.event("sales_order.released"));
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    const o = await env.one<{ id: string; code: string; status: string; requires_invoice: boolean }>(
      `select o.id, o.code, o.status, o.requires_invoice from wms.outbound_orders o join erp.sales_orders so on so.id = o.sales_order_id
       where so.external_id = $1`,
      [SO],
    );
    expect(o).toMatchObject({ status: "open", requires_invoice: true });
    const lines = await env.db.query<{ n: number }>(`select count(*)::int as n from wms.outbound_order_lines where order_id = $1 and sales_order_item_id is not null`, [o.id]);
    expect(lines[0].n).toBe(2);
    const ev = await env.one<{ payload: Record<string, unknown> }>(
      `select payload from wms.integration_events where company_id = $1 and event_type = 'outbound.accepted'`,
      [A.orionCompanyId],
    );
    O2A_PAYLOADS["outbound.accepted"].parse(ev.payload);
    expect(ev.payload.atlas_sales_order_id).toBe(SO);
  });

  it("reentrega do mesmo id → 200 duplicate; mesmo id com payload diferente → 400 idempotency_conflict", async () => {
    const e = A.event("sales_order.released");
    expect(await A.send(e)).toMatchObject({ status: 200, body: { status: "accepted", duplicate: true } });
    e.payload.sales_order.notes = "outra coisa";
    expect(await A.send(e)).toMatchObject({ status: 400, body: { error: { code: "idempotency_conflict" } } });
    const n = await env.one<{ n: number }>(`select count(*)::int as n from wms.outbound_orders o join erp.sales_orders so on so.id = o.sales_order_id where so.external_id = $1`, [SO]);
    expect(n.n).toBe(1);
  });

  it("fora de ordem → 409 out_of_order com expected_sequence", async () => {
    const r = await A.send(A.event("sales_order.line_cancelled"));
    expect(r).toMatchObject({ status: 409, body: { error: { code: "out_of_order", retryable: true, expected_sequence: 2 } } });
  });

  it("primeiro evento de um agregado aceita qualquer sequência; depois exige contínua", async () => {
    const agg = crypto.randomUUID();
    const first = A.event("sales_order.cancelled", (e) => {
      e.id = crypto.randomUUID();
      e.aggregate.id = agg;
      e.aggregate.sequence = 7;
      e.payload.atlas_sales_order_id = agg;
    });
    expect((await A.send(first)).status).toBe(202);
    const gap = A.event("sales_order.cancelled", (e) => {
      e.id = crypto.randomUUID();
      e.aggregate.id = agg;
      e.aggregate.sequence = 9;
      e.payload.atlas_sales_order_id = agg;
    });
    expect(await A.send(gap)).toMatchObject({ status: 409, body: { error: { code: "out_of_order", expected_sequence: 8 } } });
  });

  it("POST /events/batch: { events } → { status: processed, results[] }", async () => {
    const events = [1, 2].map(() => A.event("unit.upserted", (e) => (e.id = crypto.randomUUID())));
    const body = JSON.stringify({ events });
    const r = await handleBatch(env.db, request("POST", "/api/atlas/v1/events/batch", body, A.keyId, A.secret));
    const out = batchResponseSchema.parse(r.body);
    expect(out.results).toHaveLength(2);
    expect(out.results.every((x) => x.http_status === 202 || x.http_status === 200)).toBe(true);
  });

  it("sales_order.updated altera quantidade enquanto não começou a separação", async () => {
    expect((await A.send(A.event("sales_order.updated"))).status).toBe(202);
    const q = await env.one<{ q: number }>(
      `select l.requested_qty::float8 as q from wms.outbound_order_lines l join erp.sales_order_items i on i.id = l.sales_order_item_id
       where i.external_id = '0a7a5000-0000-4000-8000-000000000511' and l.cancelled_at is null`,
    );
    expect(q.q).toBe(450);
  });

  it("line_cancelled (seq 3) cancela a linha; sales_invoice.authorized registra a NF-e", async () => {
    const lc = A.event("sales_order.line_cancelled", (e) => (e.aggregate.sequence = 3));
    expect((await A.send(lc)).status).toBe(202);
    const l = await env.one<{ cancelled: boolean }>(
      `select l.cancelled_at is not null as cancelled from wms.outbound_order_lines l join erp.sales_order_items i on i.id = l.sales_order_item_id
       where i.external_id = '0a7a5000-0000-4000-8000-000000000512'`,
    );
    expect(l.cancelled).toBe(true);
    const ev = await env.one<{ payload: Record<string, unknown> }>(`select payload from wms.integration_events where company_id = $1 and event_type = 'outbound.line_cancelled'`, [A.orionCompanyId]);
    O2A_PAYLOADS["outbound.line_cancelled"].parse(ev.payload);
    expect(ev.payload.atlas_line_id).toBe("0a7a5000-0000-4000-8000-000000000512");
    // cancelamento que partiu do ATLAS volta marcado: o ATLAS não desconta de novo
    expect(ev.payload).toMatchObject({ origin: "atlas", atlas_event_id: lc.id });
    const inv = A.event("sales_invoice.authorized", (e) => (e.aggregate.sequence = 4));
    expect((await A.send(inv)).status).toBe(202);
    const o = await env.one<{ invoice_access_key: string }>(`select invoice_access_key from wms.outbound_orders o join erp.sales_orders so on so.id = o.sales_order_id where so.external_id = $1`, [SO]);
    expect(o.invoice_access_key).toHaveLength(44);
  });

  it("expedição bloqueada até a NF-e autorizada quando a empresa exige", async () => {
    const other = A.event("sales_order.released", (e) => {
      e.id = crypto.randomUUID();
      e.aggregate.id = crypto.randomUUID();
      e.payload.sales_order.atlas_sales_order_id = e.aggregate.id;
      e.payload.sales_order.number = "PV-2026-00999";
      e.payload.sales_order.lines = e.payload.sales_order.lines.map((l: Record<string, unknown>) => ({ ...l, atlas_line_id: crypto.randomUUID() }));
    });
    expect((await A.send(other)).status).toBe(202);
    const o = await env.one<{ id: string }>(`select o.id from wms.outbound_orders o join erp.sales_orders so on so.id = o.sales_order_id where so.number = 'PV-2026-00999'`);
    await env.db.query(`update wms.outbound_orders set status = 'checked' where id = $1`, [o.id]);
    await expect(shipOrder(adminA, o.id, {})).rejects.toThrow(/NF-e autorizada/);
    // cancelamento pelo ATLAS
    await env.db.query(`update wms.outbound_orders set status = 'open' where id = $1`, [o.id]);
    const cancel = A.event("sales_order.cancelled", (e) => {
      e.aggregate.id = other.aggregate.id;
      e.aggregate.sequence = 2;
      e.payload.atlas_sales_order_id = other.aggregate.id;
    });
    expect((await A.send(cancel)).status).toBe(202);
    expect((await env.one<{ status: string }>(`select status from wms.outbound_orders where id = $1`, [o.id])).status).toBe("cancelled");
  });

  it("dependency_missing (cliente não sincronizado) → falha no inbox → reprocessar após o cadastro", async () => {
    const custId = crypto.randomUUID();
    const so = A.event("sales_order.released", (e) => {
      e.id = crypto.randomUUID();
      e.aggregate.id = crypto.randomUUID();
      e.payload.sales_order.atlas_sales_order_id = e.aggregate.id;
      e.payload.sales_order.number = "PV-2026-00777";
      e.payload.sales_order.atlas_customer_id = custId;
      e.payload.sales_order.lines = e.payload.sales_order.lines.map((l: Record<string, unknown>) => ({ ...l, atlas_line_id: crypto.randomUUID() }));
    });
    expect(await A.send(so)).toMatchObject({ status: 422, body: { status: "rejected", error: { code: "dependency_missing", retryable: true } } });
    expect((await env.one<{ status: string }>(`select status from wms.atlas_inbox where event_id = $1`, [so.id])).status).toBe("failed");
    const cust = A.event("customer.upserted", (e) => {
      e.id = crypto.randomUUID();
      e.aggregate.id = custId;
      e.payload.customer.atlas_customer_id = custId;
      e.payload.customer.code = "CLI-NOVO";
    });
    expect((await A.send(cust)).status).toBe(202);
    await reprocessAtlasEvent(adminA, so.id);
    expect((await env.one<{ status: string }>(`select status from wms.atlas_inbox where event_id = $1`, [so.id])).status).toBe("applied");
  });

  it("produto inativo → 422 unknown_reference e document.rejected para o ATLAS", async () => {
    expect((await A.send(A.event("product.deactivated"))).status).toBe(202);
    const so = A.event("sales_order.released", (e) => {
      e.id = crypto.randomUUID();
      e.aggregate.id = crypto.randomUUID();
      e.payload.sales_order.atlas_sales_order_id = e.aggregate.id;
      e.payload.sales_order.number = "PV-2026-00888";
      e.payload.sales_order.lines = [{ ...e.payload.sales_order.lines[0], atlas_line_id: crypto.randomUUID(), atlas_product_id: "0a7a5000-0000-4000-8000-000000000202", product_code: "PA-1002" }];
    });
    expect(await A.send(so)).toMatchObject({ status: 422, body: { error: { code: "unknown_reference", retryable: false } } });
    const ev = await env.one<{ payload: Record<string, unknown> }>(
      `select payload from wms.integration_events where company_id = $1 and event_type = 'document.rejected'`,
      [A.orionCompanyId],
    );
    O2A_PAYLOADS["document.rejected"].parse(ev.payload);
    expect(ev.payload.atlas_event_id).toBe(so.id);
  });

  it("payload inválido → 400 validation_failed com details; tipo desconhecido → unsupported_type", async () => {
    const bad = A.event("sales_order.released", (e) => {
      e.id = crypto.randomUUID();
      e.payload.sales_order.lines[0].quantity = -1;
    });
    expect(await A.send(bad)).toMatchObject({ status: 400, body: { error: { code: "validation_failed" } } });
    const unk = A.event("unit.upserted", (e) => {
      e.id = crypto.randomUUID();
      e.type = "foo.bar";
    });
    expect(await A.send(unk)).toMatchObject({ status: 400, body: { error: { code: "unsupported_type" } } });
  });

  it("purchase_order.released → recebimento previsto; cancelled → cancelado", async () => {
    expect((await A.send(A.event("purchase_order.released"))).status).toBe(202);
    const po = await env.one<{ status: string; n: number }>(
      `select po.status, (select count(*)::int from erp.purchase_order_items i where i.purchase_order_id = po.id) as n
       from erp.purchase_orders po where po.company_id = $1 and po.number = 'PC-2026-00088'`,
      [A.orionCompanyId],
    );
    expect(po).toMatchObject({ status: "open", n: 1 });
    expect((await A.send(A.event("purchase_order.cancelled"))).status).toBe(202);
    expect((await env.one<{ status: string }>(`select status from erp.purchase_orders where company_id = $1 and number = 'PC-2026-00088'`, [A.orionCompanyId])).status).toBe("cancelled");
  });

  it("production_order.released → requisição de abastecimento; cancelled → cancelada", async () => {
    const r = await A.send(A.event("production_order.released"));
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    const req = await env.one<{ status: string }>(
      `select r.status from wms.production_requisitions r join erp.production_orders po on po.id = r.production_order_id where po.number = 'OP-2026-00031'`,
    );
    expect(req.status).toBe("open");
    expect((await A.send(A.event("production_order.cancelled"))).status).toBe(202);
    expect(
      (await env.one<{ status: string }>(`select r.status from wms.production_requisitions r join erp.production_orders po on po.id = r.production_order_id where po.number = 'OP-2026-00031'`)).status,
    ).toBe("cancelled");
  });

  it("stock.initial_snapshot: saldo no recebimento, tarefas de armazenagem, ativa o vínculo e devolve balance_snapshot", async () => {
    // produto com controle de validade e lote sem expiration_date ⇒ bloco recusado
    const val = product("0a7a5000-0000-4000-8000-000000000205", "VAL-01");
    val.payload.product.expiration_controlled = true;
    val.payload.product.batch_controlled = true;
    expect((await A.send(val)).status).toBe(202);
    const semValidade = A.event("stock.initial_snapshot", (e) => {
      e.id = crypto.randomUUID();
      e.aggregate.id = crypto.randomUUID();
      e.payload.snapshot_id = e.aggregate.id;
      e.payload.items = [{ atlas_product_id: "0a7a5000-0000-4000-8000-000000000205", product_code: "VAL-01", lot_code: "V1", expiration_date: null, quantity: 5, unit_cost: 1 }];
    });
    expect(await A.send(semValidade)).toMatchObject({ status: 400, body: { error: { code: "validation_failed" } } });
    const r = await A.send(A.event("stock.initial_snapshot"));
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    const bal = await env.one<{ q: number }>(
      `select sum(b.quantity)::float8 as q from wms.stock_balances b join wms.locations l on l.id = b.location_id
       where b.company_id = $1 and l.code = 'DEP-01/REC'`,
      [A.orionCompanyId],
    );
    expect(bal.q).toBe(1280);
    const tasks = await env.one<{ n: number }>(`select count(*)::int as n from wms.tasks where company_id = $1 and task_type = 'transfer'`, [A.orionCompanyId]);
    expect(tasks.n).toBe(2);
    expect((await env.one<{ status: string }>(`select status from wms.atlas_links where company_id = $1`, [A.orionCompanyId])).status).toBe("active");
    const snap = await env.one<{ payload: Record<string, unknown> }>(
      `select payload from wms.integration_events where company_id = $1 and event_type = 'stock.balance_snapshot'`,
      [A.orionCompanyId],
    );
    const p = O2A_PAYLOADS["stock.balance_snapshot"].parse(snap.payload);
    expect(p.reason).toBe("initial_load");
    // depois de ativo, nova carga inicial é recusada
    const again = A.event("stock.initial_snapshot", (e) => {
      e.id = crypto.randomUUID();
      e.aggregate.id = crypto.randomUUID();
    });
    expect((await A.send(again)).status).toBe(400);
  });

  it("GET documents, capabilities e stock/balances", async () => {
    const doc = await handleDocument(env.db, request("GET", `/api/atlas/v1/documents/sales_order/${SO}`, "", A.keyId, A.secret), "sales_order", SO);
    expect(doc.status).toBe(200);
    expect((doc.body.outbound as { code: string }).code).toMatch(/^PS-/);
    const cap = await handleCapabilities(env.db, request("GET", "/api/atlas/v1/capabilities", "", A.keyId, A.secret));
    expect((cap.body.types as Record<string, number[]>)["sales_order.released"]).toEqual([1]);
    const bal = await handleBalances(env.db, request("GET", "/api/atlas/v1/stock/balances?limit=1", "", A.keyId, A.secret));
    expect((bal.body.items as unknown[]).length).toBe(1);
    expect(bal.body.next_cursor).toBeTruthy();
  });
});

describe("Assinatura HMAC na API", () => {
  it("segredo errado, timestamp velho e key_id desconhecido → 401", async () => {
    const body = JSON.stringify(A.event("unit.upserted", (e) => (e.id = crypto.randomUUID())));
    expect((await handleEvent(env.db, request("POST", "/api/atlas/v1/events", body, A.keyId, "x".repeat(40)))).body).toMatchObject({ error: { code: "invalid_signature" } });
    expect((await handleEvent(env.db, request("POST", "/api/atlas/v1/events", body, A.keyId, A.secret, Date.now() - 301_000))).body).toMatchObject({ error: { code: "stale_timestamp" } });
    expect((await handleEvent(env.db, request("POST", "/api/atlas/v1/events", body, "nao-existe", A.secret))).status).toBe(401);
    // caminho diferente do assinado
    const req = request("POST", "/api/atlas/v1/events", body, A.keyId, A.secret);
    expect((await handleEvent(env.db, { ...req, pathWithQuery: "/api/atlas/v1/events?x=1" })).status).toBe(401);
  });
});

describe("Isolamento multiempresa das rotas novas", () => {
  it("credencial da empresa A não afeta B; documentos de A invisíveis para B", async () => {
    const B = await linkCompany(env.db, { name: "Beta Ltda", document: "22333444000181" });
    // envelope de B assinado com o segredo de A
    const forB = B.event("unit.upserted", (e) => (e.id = crypto.randomUUID()));
    const r = await handleEvent(env.db, request("POST", "/api/atlas/v1/events", JSON.stringify(forB), A.keyId, A.secret));
    expect(r).toMatchObject({ status: 403, body: { error: { code: "company_mismatch" } } });
    expect((await env.db.query(`select 1 from wms.atlas_units where company_id = $1`, [B.orionCompanyId])).length).toBe(0);
    const doc = await handleDocument(env.db, request("GET", `/api/atlas/v1/documents/sales_order/${SO}`, "", B.keyId, B.secret), "sales_order", SO);
    expect(doc.status).toBe(404);
    const bal = await handleBalances(env.db, request("GET", "/api/atlas/v1/stock/balances", "", B.keyId, B.secret));
    expect(bal.body.items).toEqual([]);
    // DELETE só com credencial de instalação
    expect((await handleDeleteLink(env.db, request("DELETE", `/api/atlas/v1/links/${B.atlasCompanyId}`, "", B.keyId, B.secret), B.atlasCompanyId, testEnv())).status).toBe(401);
    const del = await handleDeleteLink(env.db, request("DELETE", `/api/atlas/v1/links/${B.atlasCompanyId}`, "", INSTALL.keyId, INSTALL.secret), B.atlasCompanyId, testEnv());
    expect(del.status).toBe(200);
    expect((await env.one<{ status: string }>(`select status from wms.atlas_links where company_id = $1`, [A.orionCompanyId])).status).toBe("active");
  });
});

describe("SSO (token de lançamento ES256)", () => {
  const claims = (over: Record<string, unknown> = {}) => ({
    sub: "0a7a5000-0000-4000-8000-000000000101",
    atlas_company_id: A.atlasCompanyId,
    orion_company_id: A.orionCompanyId,
    email: "maria.souza@alfa.com.br",
    name: "Maria Souza",
    orion_role: "supervisor",
    access_version: 3,
    warehouses: ["DEP-01"],
    return_to: "/separacao",
    ...over,
  });

  it("válido: provisiona (JIT) e redireciona; replay bloqueado", async () => {
    const k = await ssoKeys();
    const token = await k.sign(claims());
    const r = await completeAtlasSso(env.db, { token, stateCookie: null }, { env: testEnv(), jwks: k.jwks });
    expect(r).toMatchObject({ ok: true, returnTo: "/separacao" });
    const u = await env.one<{ role: string; atlas_user_id: string; password_hash: string | null; wh: number }>(
      `select role, atlas_user_id, password_hash, (select count(*)::int from wms.user_warehouses w where w.user_id = u.id) as wh
       from wms.users u where company_id = $1 and lower(email) = 'maria.souza@alfa.com.br'`,
      [A.orionCompanyId],
    );
    expect(u).toMatchObject({ role: "supervisor", atlas_user_id: "0a7a5000-0000-4000-8000-000000000101", password_hash: null, wh: 1 });
    const again = await completeAtlasSso(env.db, { token, stateCookie: null }, { env: testEnv(), jwks: k.jwks });
    expect(again).toMatchObject({ ok: false, code: "token_replayed" });
  });

  it("recusa assinatura de outra chave, aud errada, expirado, state divergente, emissor errado", async () => {
    const k = await ssoKeys();
    const other = await ssoKeys();
    const run = (token: string, stateCookie: string | null = null) => completeAtlasSso(env.db, { token, stateCookie }, { env: testEnv(), jwks: k.jwks });
    expect(await run(await other.sign(claims()))).toMatchObject({ ok: false, code: "invalid_signature" });
    expect(await run(await k.sign(claims(), { aud: "outro" }))).toMatchObject({ ok: false, code: "invalid_audience" });
    expect(await run(await k.sign(claims(), { iss: "https://falso" }))).toMatchObject({ ok: false, code: "invalid_issuer" });
    expect(await run(await k.sign(claims(), { iat: Math.floor(Date.now() / 1000) - 600 }))).toMatchObject({ ok: false, code: "token_expired" });
    expect(await run(await k.sign(claims(), { ttl: 300 }))).toMatchObject({ ok: false });
    expect(await run(await k.sign(claims({ state: "abc" })), "xyz")).toMatchObject({ ok: false, code: "state_mismatch" });
    expect(await run(await k.sign(claims({ state: "abc" })), "abc")).toMatchObject({ ok: true });
    expect(await run(await k.sign(claims({ return_to: "//evil.com" })))).toMatchObject({ ok: false, code: "invalid_return_to" });
    expect(await run(await k.sign(claims({ orion_company_id: crypto.randomUUID() })))).toMatchObject({ ok: false, code: "company_not_linked" });
  });

  it("usuário vinculado: sem login por senha e campos mestres bloqueados", async () => {
    const [u] = await env.db.query<{ id: string }>(`select id from wms.users where atlas_user_id = '0a7a5000-0000-4000-8000-000000000101'`);
    expect(await authenticate(env.db, "maria.souza@alfa.com.br", "qualquer")).toBeNull();
    await expect(updateUser(adminA, u.id, { name: "Outro Nome", role: "admin" })).rejects.toThrow(/ATLAS/);
  });

  it("revogação: evento user_access.revoked inativa; token antigo depois disso é recusado", async () => {
    const k = await ssoKeys();
    expect((await A.send(A.event("user_access.revoked"))).status).toBe(202);
    const [u] = await env.db.query<{ active: boolean }>(`select active from wms.users where atlas_user_id = '0a7a5000-0000-4000-8000-000000000101'`);
    expect(u.active).toBe(false);
    const r = await completeAtlasSso(env.db, { token: await k.sign(claims()), stateCookie: null }, { env: testEnv(), jwks: k.jwks });
    expect(r).toMatchObject({ ok: false, code: "access_revoked" });
    // nova concessão (versão maior) reativa
    const ok = await completeAtlasSso(env.db, { token: await k.sign(claims({ access_version: 5 })), stateCookie: null }, { env: testEnv(), jwks: k.jwks });
    expect(ok.ok).toBe(true);
  });
});

/** Servidor HTTP fake do ATLAS (outbox e checagem de acesso). */
async function fakeAtlas(handler: (req: IncomingMessage, body: string) => { status: number; body: unknown }) {
  const calls: { method: string; url: string; headers: IncomingMessage["headers"]; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      calls.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      const r = handler(req, body);
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, calls, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}

describe("Checagem periódica de acesso (GET no ATLAS)", () => {
  it("active:false inativa; ATLAS fora do ar mantém até a tolerância", async () => {
    const [u] = await env.db.query<{ id: string }>(`select id from wms.users where atlas_user_id = '0a7a5000-0000-4000-8000-000000000101'`);
    let active = true;
    const atlas = await fakeAtlas((req) => {
      const sig = verifySignature(
        { timestamp: String(req.headers["x-astraeus-timestamp"]), signature: String(req.headers["x-astraeus-signature"]), method: "GET", pathWithQuery: req.url!, body: "" },
        [A.secret],
      );
      if (!sig.ok) return { status: 401, body: {} };
      const base = { atlas_user_id: "0a7a5000-0000-4000-8000-000000000101", atlas_company_id: A.atlasCompanyId, checked_at: new Date().toISOString() };
      return active
        ? { status: 200, body: { ...base, active: true, orion_role: "operator", access_version: 6, email: "maria.souza@alfa.com.br", name: "Maria S.", warehouses: [] } }
        : { status: 200, body: { ...base, active: false, reason: "access_revoked", access_version: 7 } };
    });
    try {
      const e = testEnv({ apiUrl: atlas.url, checkSeconds: 900 });
      await env.db.query(`update wms.users set atlas_checked_at = now() - interval '1 hour' where id = $1`, [u.id]);
      expect(await enforceAtlasAccess(env.db, u.id, { env: e })).toBe("ok");
      expect(atlas.calls).toHaveLength(1);
      expect((await env.one<{ role: string }>(`select role from wms.users where id = $1`, [u.id])).role).toBe("operator");
      // dentro do intervalo: não chama de novo
      expect(await enforceAtlasAccess(env.db, u.id, { env: e })).toBe("ok");
      expect(atlas.calls).toHaveLength(1);
      active = false;
      await env.db.query(`update wms.users set atlas_checked_at = now() - interval '1 hour' where id = $1`, [u.id]);
      expect(await enforceAtlasAccess(env.db, u.id, { env: e })).toBe("denied");
      expect((await env.one<{ active: boolean }>(`select active from wms.users where id = $1`, [u.id])).active).toBe(false);
    } finally {
      await atlas.close();
    }
    // ATLAS sem resposta: dentro da tolerância segue; depois de 1 h, cai
    await env.db.query(`update wms.users set active = true, atlas_checked_at = now() - interval '1 hour', atlas_access_ok_at = now() - interval '10 minutes' where id = $1`, [u.id]);
    const down = testEnv({ apiUrl: "http://127.0.0.1:9" });
    expect(await enforceAtlasAccess(env.db, u.id, { env: down })).toBe("ok");
    await env.db.query(`update wms.users set atlas_checked_at = now() - interval '2 hour', atlas_access_ok_at = now() - interval '2 hour' where id = $1`, [u.id]);
    expect(await enforceAtlasAccess(env.db, u.id, { env: down })).toBe("denied");
  });
});

describe("Outbox ORION → ATLAS (HMAC por empresa)", () => {
  it("envia o envelope do contrato assinado; 409 volta à fila; recusa definitiva vai a falhou", async () => {
    let mode: "ok" | "retry" | "fail" = "ok";
    const atlas = await fakeAtlas((req, body) => {
      const sig = verifySignature(
        { timestamp: String(req.headers["x-astraeus-timestamp"]), signature: String(req.headers["x-astraeus-signature"]), method: "POST", pathWithQuery: req.url!, body },
        [A.secret],
      );
      if (!sig.ok || req.headers["x-astraeus-key-id"] !== A.keyId) return { status: 401, body: { error: { code: "invalid_signature", retryable: false } } };
      const id = JSON.parse(body).id;
      if (mode === "retry") return { status: 409, body: { status: "rejected", event_id: id, error: { code: "out_of_order", message: "x", retryable: true } } };
      if (mode === "fail") return { status: 422, body: { status: "rejected", event_id: id, error: { code: "unknown_reference", message: "x", retryable: false } } };
      return { status: 202, body: { status: "accepted", event_id: id, duplicate: false } };
    });
    try {
      const transport = atlasTransport({ apiUrl: atlas.url, fallback: localTransport });
      const r = await processOutbox(env.db, { transport, email: logEmailTransport, companyId: A.orionCompanyId, limit: 100 });
      expect(r.failed).toBe(0);
      expect(r.sent).toBeGreaterThan(0);
      for (const c of atlas.calls) {
        expect(c.url).toBe("/api/integrations/orion/v1/events");
        const e = envelopeSchema.parse(JSON.parse(c.body));
        expect(e).toMatchObject({ source: "orion", atlas_company_id: A.atlasCompanyId, orion_company_id: A.orionCompanyId });
        expect(c.headers["idempotency-key"]).toBe(e.id);
        const schema = (O2A_PAYLOADS as Record<string, { safeParse: (v: unknown) => { success: boolean; error?: unknown } }>)[e.type];
        if (schema) expect(schema.safeParse(e.payload).success, `${e.type}: ${JSON.stringify(schema.safeParse(e.payload).error)}`).toBe(true);
      }
      const seqs = atlas.calls.map((c) => JSON.parse(c.body)).filter((e) => e.aggregate.type === "outbound_order");
      expect(seqs.every((e) => e.aggregate.sequence >= 1)).toBe(true);

      const sctx = await systemCtxForTests(env.db, A.orionCompanyId);
      const { enqueueIntegrationEvent } = await import("@/server/services/common");
      mode = "retry";
      await enqueueIntegrationEvent(env.db, sctx, "outbound.accepted", "outbound_order", crypto.randomUUID(), { code: "X", atlas_sales_order_id: SO, atlas_event_id: SO });
      const r2 = await processOutbox(env.db, { transport, email: logEmailTransport, companyId: A.orionCompanyId });
      expect(r2.retrying).toBe(1);
      mode = "fail";
      await env.db.query(`update wms.integration_events set next_attempt_at = now() where status = 'pending' and company_id = $1`, [A.orionCompanyId]);
      const r3 = await processOutbox(env.db, { transport, email: logEmailTransport, companyId: A.orionCompanyId });
      expect(r3.failed).toBe(1);
    } finally {
      await atlas.close();
    }
  });
});

describe("Suspensão (company.deactivated)", () => {
  it("empresa em modo somente leitura: usuários não gravam e documentos são recusados", async () => {
    expect((await A.send(A.event("company.deactivated"))).status).toBe(202);
    await expect(updateUser(adminA, adminA.user.id, { name: "Admin Local 2", role: "admin" })).rejects.toThrow(/somente leitura/);
    const so = A.event("purchase_order.released", (e) => (e.id = crypto.randomUUID()));
    expect(await A.send(so)).toMatchObject({ status: 403, body: { error: { code: "integration_suspended" } } });
  });
});
