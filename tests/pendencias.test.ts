import { describe, expect, it } from "vitest";
import { createTestEnv, key } from "./helpers";
import * as inventory from "@/server/services/inventory";
import * as docks from "@/server/services/docks";
import { getSetting, parseSettingInput, updateSettings } from "@/server/services/settings";
import { processOutbox } from "@/server/integrations/outbox/processor";
import { localTransport } from "@/server/integrations/outbox/transports";
import { emailTransportFromEnv, logEmailTransport, renderEventEmail, type EmailTransport } from "@/server/integrations/outbox/email";
import { listEmailMessages, getEmailMessage } from "@/server/services/integration";
import { seedInventoryShowcase, FLOW_DAYS } from "@/server/seed/showcase";
import { getFlowSeries } from "@/server/services/dashboard";
import { computeInventoryKpis } from "@/lib/inventory-kpis";

describe("avisos por e-mail na outbox", () => {
  it("emite eventos de divergência, inventário aprovado e agendamento e gera os e-mails no processador", async () => {
    const env = await createTestEnv();
    const sup = env.as("supervisor");
    const admin = env.as("admin");
    const wh = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);

    // inventário com uma diferença → divergence.registered; aprovação → inventory.approved
    const { id } = await inventory.createInventory(sup, { warehouseId: wh, countType: "general" });
    const items = await env.db.query<{ id: string; expected_qty: number }>(
      `select id, expected_qty from wms.inventory_count_items where inventory_id = $1 order by product_id is null, id`,
      [id],
    );
    expect(items.length).toBeGreaterThan(0);
    const counted = items.map((i, k) => ({ itemId: i.id, countedQty: k === 0 ? Number(i.expected_qty) + 2 : Number(i.expected_qty) }));
    await inventory.recordCounts(sup, id, { items: counted });
    // fora da tolerância: 2ª contagem cega por outro usuário confirma o valor
    const recount = await env.db.query<{ id: string }>(`select id from wms.inventory_count_items where inventory_id = $1 and status = 'recount'`, [id]);
    if (recount.length) await inventory.recordCounts(env.as("operator"), id, { items: counted.filter((c) => recount.some((r) => r.id === c.itemId)) });
    await inventory.submitInventory(sup, id);
    await inventory.approveInventory(admin, id, {}, { idempotencyKey: key() });

    // agendamento de recebimento → dock.appointment_created
    const dock = await env.id(`select id from wms.docks where dock_type in ('inbound', 'both') and active order by code limit 1`);
    const po = await env.id(`select id from erp.purchase_orders where number = 'PC-4587'`);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await docks.createAppointment(sup, { dockId: dock, date: tomorrow, startTime: "08:00", endTime: "09:00", purchaseOrderId: po });

    const events = await env.db.query<{ event_type: string; payload: Record<string, unknown> }>(
      `select event_type, payload from wms.integration_events where event_type in ('divergence.registered', 'inventory.approved', 'dock.appointment_created') order by created_at`,
    );
    expect(events.map((e) => e.event_type).sort()).toEqual(["divergence.registered", "dock.appointment_created", "inventory.approved"]);
    const div = events.find((e) => e.event_type === "divergence.registered")!.payload;
    expect(Number(div.counted) - Number(div.expected)).toBe(2);
    const appt = events.find((e) => e.event_type === "dock.appointment_created")!.payload;
    expect(appt.reference).toBe("PC-4587");
    expect(new Date(String(appt.starts_at)).getTime()).toBeLessThan(new Date(String(appt.ends_at)).getTime());

    // sem destinatários: registra "sem destinatário", sem envio
    const sent: string[][] = [];
    const spy: EmailTransport = { name: "http", send: async (m) => void sent.push(m.to) };
    await processOutbox(env.db, { transport: localTransport, email: spy });
    expect(sent).toHaveLength(0);
    let list = await listEmailMessages(admin);
    expect(list.rows.map((r) => r.status)).toEqual(["skipped", "skipped", "skipped"]);

    // com destinatários configurados: novos eventos geram e-mails pelo transporte
    await updateSettings(admin, { "notifications.email_recipients": "estoque@empresa.com.br, Supervisao@empresa.com.br" });
    await docks.createAppointment(sup, { dockId: dock, date: tomorrow, startTime: "10:00", endTime: "11:00", purchaseOrderId: po });
    await processOutbox(env.db, { transport: localTransport, email: spy });
    expect(sent).toEqual([["estoque@empresa.com.br", "supervisao@empresa.com.br"]]);
    list = await listEmailMessages(admin);
    expect(list.total).toBe(4);
    const latest = list.rows[0];
    expect(latest.status).toBe("sent");
    expect(latest.subject).toMatch(/PC-4587/);
    const full = await getEmailMessage(admin, latest.id);
    expect(full!.html).toContain("Recebimento agendado");

    // reprocessar não duplica (único por evento)
    await env.db.query(`update wms.integration_events set status = 'pending', next_attempt_at = now()`);
    await processOutbox(env.db, { transport: localTransport, email: logEmailTransport });
    expect((await listEmailMessages(admin)).total).toBe(4);

    // falha do transporte de e-mail fica registrada sem devolver o evento à fila
    await docks.createAppointment(sup, { dockId: dock, date: tomorrow, startTime: "12:00", endTime: "13:00", purchaseOrderId: po });
    const boom: EmailTransport = { name: "http", send: async () => Promise.reject(new Error("HTTP 503")) };
    const r = await processOutbox(env.db, { transport: localTransport, email: boom });
    expect(r.failed + r.retrying).toBe(0);
    expect((await listEmailMessages(admin)).rows[0]).toMatchObject({ status: "failed", error: "HTTP 503" });

    // operador não vê a lista de e-mails
    await expect(listEmailMessages(env.as("operator"))).rejects.toThrow();
  }, 60_000);

  it("renderiza os templates a partir do payload e escolhe o transporte pelo ambiente", () => {
    const inv = renderEventEmail({
      event_type: "inventory.approved",
      aggregate_id: "x",
      payload: { code: "INV-1", warehouse: "CD", approved_at: new Date().toISOString(), accuracy: 98.5, locations: 10, adjustments: 2 },
    });
    expect(inv!.template).toBe("inventario_concluido");
    expect(inv!.message.subject).toContain("98,5%");
    expect(renderEventEmail({ event_type: "dock.appointment_created", aggregate_id: "x", payload: { direction: "outbound" } })).toBeNull();
    expect(renderEventEmail({ event_type: "receipt.completed", aggregate_id: "x", payload: {} })).toBeNull();
    expect(emailTransportFromEnv({}).name).toBe("log");
    expect(emailTransportFromEnv({ EMAIL_API_URL: "https://mail.example/send" }).name).toBe("http");
  });
});

describe("meta de acuracidade configurável", () => {
  it("valida 50–100, padrão 99, e é usada nos KPIs", async () => {
    expect(() => parseSettingInput("inventory.accuracy_target", "49.9")).toThrow(/entre 50 e 100/);
    expect(() => parseSettingInput("inventory.accuracy_target", "101")).toThrow(/entre 50 e 100/);
    expect(() => parseSettingInput("inventory.accuracy_target", "")).toThrow(/número/);
    expect(parseSettingInput("inventory.accuracy_target", "97,5")).toBe(97.5);
    expect(() => parseSettingInput("notifications.email_recipients", "nao-e-email")).toThrow(/inválido/);

    const env = await createTestEnv();
    const admin = env.as("admin");
    const company = admin.user.companyId;
    expect(await getSetting(env.db, company, "inventory.accuracy_target")).toBe(99);
    await expect(updateSettings(admin, { "inventory.accuracy_target": "120" })).rejects.toThrow(/entre 50 e 100/);
    expect((await updateSettings(admin, { "inventory.segregation_of_duties": "on", "inventory.accuracy_target": "95" })).changed).toBe(1);
    expect(await getSetting(env.db, company, "inventory.accuracy_target")).toBe(95);
    // campo numérico ausente mantém o valor
    await updateSettings(admin, { "inventory.segregation_of_duties": "on" });
    expect(await getSetting(env.db, company, "inventory.accuracy_target")).toBe(95);

    const wh = await env.id(`select id from wms.warehouses where code = 'DEP-01'`);
    const { id } = await inventory.createInventory(env.as("supervisor"), { warehouseId: wh, countType: "general" });
    expect((await inventory.getInventoryKpis(env.as("supervisor"), id))!.target).toBe(95);
    expect(computeInventoryKpis({ status: "counting", blind: false, items: [], history: [], currentId: "x" }).target).toBe(99);
  }, 60_000);
});

describe("vitrine do fluxo (seed de demonstração)", () => {
  it("preenche recebimentos × expedições nos 14 dias, com dados variados, e é idempotente", async () => {
    const env = await createTestEnv();
    await seedInventoryShowcase(env.db);
    const series = await getFlowSeries(env.as("admin"), FLOW_DAYS);
    expect(series).toHaveLength(14);
    const putaway = series.map((d) => Number(d.received));
    const shipped = series.map((d) => Number(d.shipped));
    expect(putaway.filter((v) => v > 0).length).toBeGreaterThanOrEqual(13);
    expect(shipped.filter((v) => v > 0).length).toBeGreaterThanOrEqual(9);
    expect(new Set(putaway).size).toBeGreaterThan(5);
    // e-mails de demonstração gerados (inventários aprovados, divergências)
    expect((await listEmailMessages(env.as("admin"))).total).toBeGreaterThan(0);
    const before = await env.one<{ n: number }>(`select count(*)::int as n from wms.stock_movements`);
    await seedInventoryShowcase(env.db);
    expect((await env.one<{ n: number }>(`select count(*)::int as n from wms.stock_movements`)).n).toBe(before.n);
  }, 180_000);
});
