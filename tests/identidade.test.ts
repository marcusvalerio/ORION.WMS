import { beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, type TestEnv } from "./helpers";
import { RELEASES, type Release } from "@/content/novidades";
import { emTarefaEmAndamento, itensParaPerfil, novidadesDoUsuario, parseVistas } from "@/lib/novidades";
import { marcarVersaoVista, versoesVistas } from "@/server/services/novidades";
import { registrarLead } from "@/server/services/site-leads";
import { divergenciaEmail, escapeHtml, inventarioConcluidoEmail, recebimentoAgendadoEmail } from "@/server/emails/templates";

const SAMPLE: Release[] = [
  {
    versao: "2027.1",
    data: "2027-01-10",
    itens: [
      { id: "a", area: "A", titulo: "Para todos", texto: "t", demo: "nenhuma" },
      { id: "b", area: "B", titulo: "Só gestores", texto: "t", perfis: ["admin", "supervisor"], demo: "nenhuma" },
      { id: "c", area: "C", titulo: "Só operador", texto: "t", perfis: ["operator"], demo: "nenhuma" },
    ],
  },
  { versao: "2026.12", data: "2026-12-01", leve: true, itens: [{ id: "x", area: "X", titulo: "x", texto: "x", demo: "nenhuma" }] },
];

describe("novidades da versão", () => {
  it("filtra os itens pelo perfil (sem perfis = todos)", () => {
    expect(itensParaPerfil(SAMPLE[0], "admin").map((i) => i.id)).toEqual(["a", "b"]);
    expect(itensParaPerfil(SAMPLE[0], "operator").map((i) => i.id)).toEqual(["a", "c"]);
    expect(itensParaPerfil(SAMPLE[0], "auditor").map((i) => i.id)).toEqual(["a"]);
  });

  it("usa só a versão atual e marca pendente até ser vista", () => {
    const v = novidadesDoUsuario(SAMPLE, "supervisor", []);
    expect(v?.versao).toBe("2027.1");
    expect(v?.pendente).toBe(true);
    expect(v?.leve).toBe(false);
    expect(novidadesDoUsuario(SAMPLE, "supervisor", ["2027.1"])?.pendente).toBe(false);
    // versões antigas vistas não contam
    expect(novidadesDoUsuario(SAMPLE, "supervisor", ["2026.12"])?.pendente).toBe(true);
  });

  it("versão leve e versão sem itens para o perfil", () => {
    expect(novidadesDoUsuario(SAMPLE.slice(1), "auditor", [])?.leve).toBe(true);
    const soOperador: Release[] = [{ versao: "2027.2", data: "", itens: [SAMPLE[0].itens[2]] }];
    expect(novidadesDoUsuario(soOperador, "admin", [])).toBeNull();
    expect(novidadesDoUsuario([], "admin", [])).toBeNull();
  });

  it("conteúdo versionado é válido", () => {
    const versoes = RELEASES.map((r) => r.versao);
    expect(new Set(versoes).size).toBe(versoes.length);
    for (const r of RELEASES) {
      expect(r.versao).toMatch(/^[0-9]{4}\.[0-9]{1,2}$/);
      for (const i of r.itens) if (i.rota) expect(i.rota.startsWith("/")).toBe(true);
    }
    // cada perfil vê ao menos uma novidade da versão atual
    for (const role of ["admin", "supervisor", "operator", "auditor"] as const) expect(itensParaPerfil(RELEASES[0], role).length).toBeGreaterThan(0);
  });

  it("não abre no meio de contagem/separação/tarefa", () => {
    for (const p of ["/coletor", "/coletor/tarefas/1", "/tarefas/abc", "/inventario/123", "/separacao/9", "/conferencia", "/ondas/1"]) expect(emTarefaEmAndamento(p)).toBe(true);
    for (const p of ["/", "/inventario", "/tarefas", "/separacao", "/separacao/novo", "/estoque", "/indicadores"]) expect(emTarefaEmAndamento(p)).toBe(false);
  });

  it("cookie do modo demonstração aceita só versões válidas", () => {
    expect(parseVistas("2026.11, x, 2026.10,<script>")).toEqual(["2026.11", "2026.10"]);
    expect(parseVistas(undefined)).toEqual([]);
  });
});

describe("persistência por usuário e leads", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv();
  });

  it("grava 'visto' por usuário e versão, de forma idempotente", async () => {
    const admin = env.as("admin");
    const op = env.as("operator");
    expect(await versoesVistas(admin)).toEqual([]);
    await marcarVersaoVista(admin, "2026.11");
    await marcarVersaoVista(admin, "2026.11");
    expect(await versoesVistas(admin)).toEqual(["2026.11"]);
    expect(await versoesVistas(op)).toEqual([]);
    expect(novidadesDoUsuario(RELEASES, "admin", await versoesVistas(admin))?.pendente).toBe(RELEASES[0].versao !== "2026.11");
    await expect(marcarVersaoVista(admin, "abc")).rejects.toThrow(/Versão inválida/);
  });

  it("banco recusa versão fora do formato", async () => {
    const admin = env.as("admin");
    await expect(
      env.db.query(`insert into wms.release_notes_seen (user_id, company_id, version) values ($1, $2, 'v1')`, [admin.user.id, admin.user.companyId]),
    ).rejects.toThrow();
  });

  it("registra lead uma vez por e-mail (sem diferenciar caixa) e valida o e-mail", async () => {
    expect(await registrarLead(env.db, { email: "Compras@Frioverde.com.br" })).toEqual({ created: true });
    expect(await registrarLead(env.db, { email: "compras@frioverde.com.br " })).toEqual({ created: false });
    const row = await env.one<{ n: number }>(`select count(*)::int as n from public.site_leads`);
    expect(row.n).toBe(1);
    await expect(registrarLead(env.db, { email: "sem-arroba" })).rejects.toThrow(/e-mail/);
    await expect(registrarLead(env.db, { email: "" })).rejects.toThrow(/e-mail/);
  });
});

describe("templates de e-mail", () => {
  it("inventário concluído", () => {
    const m = inventarioConcluidoEmail({
      codigo: "INV-0031",
      deposito: "CD Contagem",
      fechadoEm: new Date("2026-11-15T14:02:00Z"),
      acuracidade: 98.4,
      enderecos: 340,
      ajustes: 7,
      url: "https://orion.exemplo/inventario/1",
    });
    expect(m.subject).toBe("Inventário INV-0031 concluído · 98,4% de acuracidade");
    expect(m.html).toContain("11:02");
    expect(m.html).toContain("98,4%");
    expect(m.html).toContain("ecossistema ASTRAEUS");
    expect(m.html).not.toMatch(/<style|class=/);
    expect(m.text).toContain("Endereços: 340");
  });

  it("divergência com diferença negativa e valor", () => {
    const m = divergenciaEmail({ endereco: "ARM-02-03-04", esperado: 50, contado: 48, valorUnitario: 92, recontagemCriada: true, url: "https://x/d" });
    expect(m.subject).toBe("Divergência em ARM-02-03-04: −2 un");
    expect(m.html).toContain("−2 un · −R$");
    expect(m.html).toContain("184,00");
    expect(m.html).toContain("Ver recontagem");
  });

  it("recebimento agendado e escape de HTML", () => {
    const m = recebimentoAgendadoEmail({
      pedido: "PC-4588",
      doca: "D1",
      inicio: new Date("2026-11-18T11:00:00Z"),
      fim: new Date("2026-11-18T12:00:00Z"),
      volumes: "12 paletes",
      fornecedor: "Aço <Forte> & Cia",
      url: "https://x/docas/1?a=1&b=2",
    });
    expect(m.subject).toBe("Recebimento agendado: PC-4588 na doca D1 (18/11 · 08:00–09:00)");
    expect(m.html).toContain("Aço &lt;Forte&gt; &amp; Cia");
    expect(m.html).toContain('href="https://x/docas/1?a=1&amp;b=2"');
    expect(escapeHtml(`"'`)).toBe("&quot;&#39;");
  });
});
