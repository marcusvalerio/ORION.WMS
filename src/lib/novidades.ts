import type { Role } from "./permissions";
import type { NovidadeItem, Release } from "@/content/novidades";

/** Cookie usado no modo demonstração para guardar as versões já vistas. */
export const NOVIDADES_COOKIE = "orion_novidades_vistas";

export function itensParaPerfil(release: Release, role: Role): NovidadeItem[] {
  return release.itens.filter((i) => !i.perfis?.length || i.perfis.includes(role));
}

export interface NovidadesView {
  versao: string;
  leve: boolean;
  itens: NovidadeItem[];
  doAtlas?: string;
  /** Ainda não vista por este usuário: abre sozinha (janela ou aviso leve). */
  pendente: boolean;
}

/**
 * Novidades da versão atual (a primeira da lista) para um perfil. `null` quando
 * nenhuma novidade da versão se aplica ao perfil.
 */
export function novidadesDoUsuario(releases: readonly Release[], role: Role, vistas: Iterable<string>): NovidadesView | null {
  const atual = releases[0];
  if (!atual) return null;
  const itens = itensParaPerfil(atual, role);
  if (!itens.length) return null;
  const seen = new Set(vistas);
  return { versao: atual.versao, leve: Boolean(atual.leve), itens, doAtlas: atual.doAtlas, pendente: !seen.has(atual.versao) };
}

/**
 * Telas em que o usuário está no meio de uma contagem, separação ou tarefa:
 * a janela de novidades não abre sozinha nelas.
 */
const BUSY = [
  /^\/coletor(\/|$)/,
  /^\/tarefas\/[^/]+/,
  /^\/inventario\/[^/]+/,
  /^\/separacao\/(?!novo(\/|$))[^/]+/,
  /^\/conferencia(\/|$)/,
  /^\/ondas\/[^/]+/,
  /^\/producao\/[^/]+/,
];

export function emTarefaEmAndamento(pathname: string): boolean {
  return BUSY.some((r) => r.test(pathname));
}

const VERSAO = /^[0-9]{4}\.[0-9]{1,2}$/;

export function versaoValida(v: string): boolean {
  return VERSAO.test(v);
}

/** Versões vistas guardadas no cookie (só valores válidos, últimas 20). */
export function parseVistas(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(versaoValida)
    .slice(-20);
}
