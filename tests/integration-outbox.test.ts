import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { backoffMs, processOutbox, queueCounts } from "@/server/integrations/outbox/processor";
import { httpTransport, localTransport, signBody, transportFromEnv } from "@/server/integrations/outbox/transports";
import { discardOutboxEvent, listOutboxEvents, processQueue, retryOutboxEvent } from "@/server/services/integration";
import { collectHealth, toPublicHealth } from "@/server/services/health";
import { createTestEnv, key, type TestEnv } from "./helpers";

const SECRET = "segredo-de-teste-com-32-caracteres!";

interface Received {
  headers: IncomingHttpHeaders;
  body: string;
}

/** Servidor HTTP falso do ERP: responde com a sequência de status configurada. */
function fakeErp() {
  const received: Received[] = [];
  const state = { statuses: [] as number[], delayMs: 0 };
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      const status = state.statuses.shift() ?? 200;
      setTimeout(() => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: status < 300 }));
      }, state.delayMs);
    });
  });
  return { server, received, state };
}

async function addEvent(env: TestEnv, eventType = "outbound.shipped", aggregateId: string = crypto.randomUUID()) {
  const companyId = env.as("admin").user.companyId;
  return env.id(
    `insert into wms.integration_events (company_id, event_type, aggregate_type, aggregate_id, payload)
     values ($1, $2, 'outbound_order', $3, '{"code":"PED-1"}') returning id`,
    [companyId, eventType, aggregateId],
  );
}

const ev = (env: TestEnv, id: string) =>
  env.one<{ status: string; attempts: number; last_error: string | null; next_attempt_at: string; processed_at: string | null }>(
    `select status, attempts, last_error, next_attempt_at::text, processed_at::text from wms.integration_events where id = $1`,
    [id],
  );

describe("Processador da outbox", () => {
  let env: TestEnv;
  const erp = fakeErp();
  let url = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => erp.server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(erp.server.address() as AddressInfo).port}/webhook`;
  });
  afterAll(() => new Promise<void>((resolve) => erp.server.close(() => resolve())));
  beforeEach(async () => {
    env = await createTestEnv();
    erp.received.length = 0;
    erp.state.statuses = [];
    erp.state.delayMs = 0;
  });

  it("http: falha → reagenda com backoff → sucesso, com assinatura HMAC correta e id idempotente", async () => {
    const id = await addEvent(env);
    const transport = httpTransport({ url, secret: SECRET, timeoutMs: 2000 });
    erp.state.statuses = [500];

    const first = await processOutbox(env.db, { transport, baseDelayMs: 60_000 });
    expect(first).toMatchObject({ claimed: 1, sent: 0, retrying: 1, failed: 0 });
    let e = await ev(env, id);
    expect(e.status).toBe("pending");
    expect(e.attempts).toBe(1);
    expect(e.last_error).toMatch(/HTTP 500/);
    expect(new Date(e.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 50_000);

    // Ainda não chegou a hora: nada é processado.
    expect((await processOutbox(env.db, { transport })).claimed).toBe(0);

    await env.db.query(`update wms.integration_events set next_attempt_at = now() where id = $1`, [id]);
    const second = await processOutbox(env.db, { transport });
    expect(second).toMatchObject({ claimed: 1, sent: 1 });
    e = await ev(env, id);
    expect(e).toMatchObject({ status: "sent", attempts: 2, last_error: null });
    expect(e.processed_at).not.toBeNull();

    expect(erp.received).toHaveLength(2);
    for (const r of erp.received) {
      const ts = String(r.headers["x-orion-timestamp"]);
      expect(r.headers["x-orion-signature"]).toBe(`sha256=${signBody(SECRET, ts, r.body)}`);
      expect(r.headers["idempotency-key"]).toBe(id);
      expect(r.headers["x-orion-event-id"]).toBe(id);
      expect(JSON.parse(r.body)).toMatchObject({ id, type: "outbound.shipped", payload: { code: "PED-1" } });
    }
    expect(erp.received[0].headers["x-orion-signature"]).not.toBe(`sha256=${signBody("outro-segredo", String(erp.received[0].headers["x-orion-timestamp"]), erp.received[0].body)}`);

    // Já enviado: novo processamento não reenvia.
    expect((await processOutbox(env.db, { transport })).claimed).toBe(0);
    expect(erp.received).toHaveLength(2);
  });

  it("timeout conta como falha e o limite de tentativas leva a 'falhou'", async () => {
    const id = await addEvent(env);
    erp.state.delayMs = 300;
    const transport = httpTransport({ url, secret: SECRET, timeoutMs: 50 });
    const r = await processOutbox(env.db, { transport, maxAttempts: 2, baseDelayMs: 0 });
    expect(r.retrying).toBe(1);
    expect((await ev(env, id)).last_error).toMatch(/Tempo esgotado/);
    const r2 = await processOutbox(env.db, { transport, maxAttempts: 2, baseDelayMs: 0 });
    expect(r2.failed).toBe(1);
    expect(await ev(env, id)).toMatchObject({ status: "failed", attempts: 2 });
    // Falhou não volta sozinho para a fila.
    expect((await processOutbox(env.db, { transport })).claimed).toBe(0);
  });

  it("backoff exponencial com teto", () => {
    expect([1, 2, 3, 4].map((a) => backoffMs(a, 1000, 5000))).toEqual([1000, 2000, 4000, 5000]);
  });

  it("lock por evento: evento 'enviando' não é pego por outro processador; lock antigo é recuperado", async () => {
    const id = await addEvent(env);
    await env.db.query(`update wms.integration_events set status = 'sending', locked_at = now(), attempts = 1 where id = $1`, [id]);
    expect((await processOutbox(env.db, { transport: localTransport })).claimed).toBe(0);
    await env.db.query(`update wms.integration_events set locked_at = now() - interval '10 minutes' where id = $1`, [id]);
    const r = await processOutbox(env.db, { transport: localTransport });
    expect(r.claimed).toBe(1);
    expect(await ev(env, id)).toMatchObject({ status: "pending", attempts: 2 });
  });

  it("local: aplica o status no schema erp e é idempotente", async () => {
    const admin = env.as("admin");
    const so = await env.one<{ id: string; customer_id: string }>(`select id, customer_id from erp.sales_orders order by number limit 1`);
    const wh = await env.id(`select id from wms.warehouses limit 1`);
    const order = await env.id(
      `insert into wms.outbound_orders (company_id, warehouse_id, code, sales_order_id, source, customer_name, status, created_by)
       values ($1, $2, 'SAI-T1', $3, 'erp', 'Cliente', 'shipped', $4) returning id`,
      [admin.user.companyId, wh, so.id, admin.user.id],
    );
    const id = await addEvent(env, "outbound.shipped", order);
    const r = await processOutbox(env.db, { transport: localTransport });
    expect(r.sent).toBe(1);
    expect((await env.one<{ status: string }>(`select status from erp.sales_orders where id = $1`, [so.id])).status).toBe("shipped");
    expect((await ev(env, id)).status).toBe("sent");

    // Agregado inexistente: falha registrada, sem efeito parcial.
    const bad = await addEvent(env, "outbound.shipped");
    const r2 = await processOutbox(env.db, { transport: localTransport });
    expect(r2.retrying).toBe(1);
    expect((await ev(env, bad)).last_error).toMatch(/não encontrado/);
  });

  it("painel: processar (supervisor), reenviar e descartar com motivo (admin), auditados", async () => {
    const id = await addEvent(env, "evento.sem.efeito");
    await expect(processQueue(env.as("operator"))).rejects.toThrow(/permissão/);
    const r = await processQueue(env.as("supervisor"), { transport: localTransport });
    expect(r.sent).toBe(1);
    await expect(retryOutboxEvent(env.as("admin"), id)).rejects.toThrow(/já enviado/);

    const failing = await addEvent(env);
    await processOutbox(env.db, { transport: localTransport, maxAttempts: 1 });
    expect((await ev(env, failing)).status).toBe("failed");

    await expect(discardOutboxEvent(env.as("supervisor"), failing, { reason: "Pedido cancelado no ERP" })).rejects.toThrow(/permissão/);
    await expect(discardOutboxEvent(env.as("admin"), failing, { reason: "x" })).rejects.toThrow(/motivo/);
    await discardOutboxEvent(env.as("admin"), failing, { reason: "Pedido cancelado no ERP" }, { idempotencyKey: key() });
    expect((await ev(env, failing)).status).toBe("discarded");
    expect((await processOutbox(env.db, { transport: localTransport })).claimed).toBe(0);

    await retryOutboxEvent(env.as("admin"), failing);
    expect(await ev(env, failing)).toMatchObject({ status: "pending", attempts: 0 });

    const list = await listOutboxEvents(env.as("auditor"), { status: "pending" });
    expect(list.rows.map((x) => x.id)).toEqual([failing]);
    expect(list.counts.sent).toBe(1);
    await expect(listOutboxEvents(env.as("operator"))).rejects.toThrow(/permissão/);

    const actions = await env.db.query<{ action: string }>(
      `select action from wms.audit_log where action like 'integration.%' order by created_at`,
    );
    expect(actions.map((a) => a.action)).toEqual(["integration.processed", "integration.discarded", "integration.retried"]);
    // O banco exige motivo para descartar.
    await expect(env.db.query(`update wms.integration_events set status = 'discarded', discarded_at = now() where id = $1`, [failing])).rejects.toThrow();
  });

  it("configuração do transporte pelo ambiente", () => {
    const local = transportFromEnv({});
    expect(local.ok && local.transport.name).toBe("local");
    expect(transportFromEnv({ ERP_WEBHOOK_URL: "https://erp.example.com/h" })).toMatchObject({ ok: false });
    const ok = transportFromEnv({ ERP_WEBHOOK_URL: "https://erp.example.com/h", ERP_WEBHOOK_SECRET: SECRET });
    expect(ok.ok && ok.transport.name).toBe("http");
    expect(transportFromEnv({ ERP_OUTBOX_TRANSPORT: "local", ERP_WEBHOOK_URL: "https://erp.example.com/h" })).toMatchObject({ ok: true });
  });

  it("saúde: banco, migrations e fila, sem dados sensíveis na versão pública", async () => {
    await addEvent(env);
    const h = await collectHealth(async () => env.db);
    expect(h.database.ok).toBe(true);
    expect(h.migrations?.pending).toBe(0);
    expect(h.migrations?.applied).toBeGreaterThanOrEqual(4);
    expect(h.queue?.pending).toBe(1);
    expect((await queueCounts(env.db)).pending).toBe(1);
    const pub = toPublicHealth(h);
    expect(Object.keys(pub).sort()).toEqual(["database", "migrations", "queue", "status", "time", "version"]);
    const down = await collectHealth(async () => {
      throw new Error("sem banco");
    });
    expect(down.status).toBe("error");
  });
});
