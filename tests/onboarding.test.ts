import { beforeAll, describe, expect, it } from "vitest";
import { RELEASES } from "@/content/novidades";
import { emTarefaEmAndamento, novidadesDoUsuario } from "@/lib/novidades";
import { atlasVinculado, onboardingVistoNoCookie, passosOnboarding } from "@/lib/onboarding";
import { versoesVistas } from "@/server/services/novidades";
import { estadoOnboarding, marcarOnboardingVisto, prepararPrimeiroAcesso } from "@/server/services/onboarding";
import { createTestEnv, type TestEnv } from "./helpers";

describe("passos do onboarding", () => {
  it("operador: tarefas → leitor → confirmar → ajuda", () => {
    expect(passosOnboarding("operator", false).map((p) => p.id)).toEqual(["tarefas", "leitor", "confirmar", "ajuda"]);
    expect(passosOnboarding("operator", false)[1].alvo).toBe("leitor");
  });
  it("supervisor e admin: fluxo completo do armazém", () => {
    const ids = ["entrada", "estoque", "saida", "inventario", "indicadores", "comex", "ajuda"];
    expect(passosOnboarding("supervisor", false).map((p) => p.id)).toEqual(ids);
    expect(passosOnboarding("admin", false).map((p) => p.id)).toEqual(ids);
  });
  it("auditor: relatórios, auditoria e rastreabilidade", () => {
    expect(passosOnboarding("auditor", false).map((p) => p.id)).toEqual(["relatorios", "auditoria", "rastreabilidade", "ajuda"]);
  });
  it("vínculo ATLAS acrescenta um passo antes da ajuda", () => {
    for (const role of ["operator", "supervisor", "admin", "auditor"] as const) {
      const ids = passosOnboarding(role, true).map((p) => p.id);
      expect(ids.at(-2)).toBe("atlas");
      expect(ids.at(-1)).toBe("ajuda");
      expect(ids.length).toBe(passosOnboarding(role, false).length + 1);
    }
    expect(passosOnboarding("operator", true).find((p) => p.id === "atlas")?.alvo).toBeUndefined();
    expect(atlasVinculado("active")).toBe(true);
    expect(atlasVinculado("activating")).toBe(true);
    expect(atlasVinculado("suspended")).toBe(false);
    expect(atlasVinculado(null)).toBe(false);
  });
  it("cada passo tem uma frase só", () => {
    for (const role of ["operator", "supervisor", "auditor"] as const)
      for (const p of passosOnboarding(role, true)) expect(p.texto.replace(/\.$/, "").includes(". ")).toBe(false);
  });
  it("não abre em tarefa/coletor/inventário em andamento", () => {
    expect(emTarefaEmAndamento("/coletor")).toBe(true);
    expect(emTarefaEmAndamento("/inventario/abc")).toBe(true);
    expect(emTarefaEmAndamento("/tarefas/123")).toBe(true);
    expect(emTarefaEmAndamento("/")).toBe(false);
    expect(emTarefaEmAndamento("/tarefas")).toBe(false);
  });
  it("cookie do modo demonstração", () => {
    expect(onboardingVistoNoCookie("1")).toBe(true);
    expect(onboardingVistoNoCookie(undefined)).toBe(false);
    expect(onboardingVistoNoCookie("x")).toBe(false);
  });
});

describe("persistência do onboarding", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await createTestEnv();
  });

  it("primeiro acesso: pendente e suprime as Novidades da versão atual", async () => {
    const op = env.as("operator");
    expect((await estadoOnboarding(op)).pendente).toBe(true);
    const estado = await prepararPrimeiroAcesso(op, RELEASES[0].versao);
    expect(estado.pendente).toBe(true);
    expect(await versoesVistas(op)).toContain(RELEASES[0].versao);
    expect(novidadesDoUsuario(RELEASES, "operator", await versoesVistas(op))?.pendente ?? false).toBe(false);
  });

  it("concluir grava por usuário e é idempotente", async () => {
    const sup = env.as("supervisor");
    await marcarOnboardingVisto(sup, "skipped");
    await marcarOnboardingVisto(sup, "completed");
    expect((await estadoOnboarding(sup)).pendente).toBe(false);
    expect((await estadoOnboarding(env.as("auditor"))).pendente).toBe(true);
    const row = await env.one<{ outcome: string }>(`select outcome from wms.onboarding_seen where user_id = $1`, [sup.user.id]);
    expect(row.outcome).toBe("skipped");
  });

  it("usuário que já fez o tour não tem Novidades suprimidas", async () => {
    const adm = env.as("admin");
    await marcarOnboardingVisto(adm);
    const antes = await versoesVistas(adm);
    await prepararPrimeiroAcesso(adm, "2099.1");
    expect(await versoesVistas(adm)).toEqual(antes);
  });

  it("vínculo ATLAS ativo aparece no estado", async () => {
    const adm = env.as("admin");
    expect((await estadoOnboarding(adm)).vinculadaAtlas).toBe(false);
    await env.db.query(
      `insert into wms.atlas_links (company_id, atlas_company_id, key_id, secret_ciphertext, status) values ($1, 'atlas-x', 'k-x', 'c', 'active')`,
      [adm.user.companyId],
    );
    expect((await estadoOnboarding(adm)).vinculadaAtlas).toBe(true);
  });

  it("não aceita usuário de outra empresa", async () => {
    const adm = env.as("admin");
    const other = await env.id(`insert into erp.companies (legal_name) values ('Outra') returning id`).catch(() => null);
    if (!other) return;
    await expect(
      env.db.query(`insert into wms.onboarding_seen (user_id, company_id) values ($1, $2)`, [adm.user.id, other]),
    ).rejects.toThrow();
  });
});
