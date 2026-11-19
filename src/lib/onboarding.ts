import type { Role } from "./permissions";

/** Cookie do modo demonstração: tour de primeiros passos já concluído/pulado. */
export const ONBOARDING_COOKIE = "orion_onboarding_visto";
/** Evento para reabrir o tour ("Como funciona o ORION"). */
export const ONBOARDING_OPEN_EVENT = "orion:onboarding";

export interface OnboardingPasso {
  id: string;
  titulo: string;
  /** Uma frase, sem rodeios. */
  texto: string;
  /** Valor de data-tour do elemento real a destacar; sem alvo → balão centralizado. */
  alvo?: string;
  /** Botão opcional "Ir para a tela". */
  href?: string;
}

/** Status de wms.atlas_links que contam como empresa vinculada ao ATLAS. */
export const ATLAS_VINCULADO = ["active", "activating"] as const;
export function atlasVinculado(status: string | null | undefined): boolean {
  return (ATLAS_VINCULADO as readonly string[]).includes(status ?? "");
}

const AJUDA: OnboardingPasso = {
  id: "ajuda",
  titulo: "Ajuda",
  texto: "Quer rever este tour? Ele fica aqui, em “Como funciona o ORION”.",
  alvo: "ajuda",
};

const ATLAS: OnboardingPasso = {
  id: "atlas",
  titulo: "ATLAS e ORION",
  texto: "Cadastros, pedidos e NF-e vêm do ATLAS; aqui no ORION você recebe, guarda, separa, confere e expede.",
  alvo: "nav:/integracao",
};

const POR_PERFIL: Record<Role, OnboardingPasso[]> = {
  operator: [
    { id: "tarefas", titulo: "Suas tarefas", texto: "Tudo o que você tem para fazer no turno aparece em Tarefas.", alvo: "nav:/tarefas", href: "/tarefas" },
    { id: "leitor", titulo: "Leia o código aqui", texto: "Toque no leitor ao lado da busca e bipe a etiqueta do endereço ou do produto.", alvo: "leitor", href: "/coletor" },
    { id: "confirmar", titulo: "Confirme e siga", texto: "Conferiu? Confirme a tarefa e o ORION já mostra a próxima.", alvo: "coletor", href: "/coletor" },
    AJUDA,
  ],
  supervisor: [],
  admin: [],
  auditor: [
    { id: "relatorios", titulo: "Relatórios", texto: "Estoque, recebimentos e expedições prontos para filtrar e exportar.", alvo: "nav:/relatorios", href: "/relatorios" },
    { id: "auditoria", titulo: "Auditoria", texto: "Quem fez o quê, quando e em qual registro — tudo fica gravado.", alvo: "nav:/auditoria", href: "/auditoria" },
    { id: "rastreabilidade", titulo: "Rastreabilidade", texto: "Em Movimentações você segue cada unidade de endereço em endereço, por lote.", alvo: "nav:/estoque/movimentacoes", href: "/estoque/movimentacoes" },
    AJUDA,
  ],
};

const GESTAO: OnboardingPasso[] = [
  { id: "entrada", titulo: "Entrada", texto: "A nota chega, você confere e o sistema sugere onde guardar.", alvo: "nav:/recebimentos", href: "/recebimentos" },
  { id: "estoque", titulo: "Estoque", texto: "Cada saldo tem endereço, lote e validade.", alvo: "nav:/estoque", href: "/estoque" },
  { id: "saida", titulo: "Saída", texto: "Pedido → onda → separação → conferência → expedição.", alvo: "nav:/separacao", href: "/separacao" },
  { id: "inventario", titulo: "Inventário", texto: "O CD escurece e você conta pelo mapa 3D.", alvo: "nav:/inventario", href: "/inventario" },
  { id: "indicadores", titulo: "Indicadores", texto: "Ocupação, produtividade e acuracidade num só painel.", alvo: "nav:/indicadores", href: "/indicadores" },
  { id: "comex", titulo: "Comex", texto: "Importação e exportação ficam em Armazém → Comex.", alvo: "nav:/comex", href: "/comex" },
  AJUDA,
];
POR_PERFIL.supervisor = GESTAO;
POR_PERFIL.admin = GESTAO;

/** Passos do tour para o perfil; empresa vinculada ao ATLAS ganha um passo antes da Ajuda. */
export function passosOnboarding(role: Role, vinculadaAtlas: boolean): OnboardingPasso[] {
  const base = POR_PERFIL[role] ?? [];
  if (!vinculadaAtlas) return [...base];
  const semAjuda = base.filter((p) => p.id !== "ajuda");
  // operador não vê o menu Integração: balão centralizado
  const atlas = role === "operator" ? { ...ATLAS, alvo: undefined } : ATLAS;
  return [...semAjuda, atlas, AJUDA];
}

/** Valor do cookie de demonstração → já visto. */
export function onboardingVistoNoCookie(value: string | undefined): boolean {
  return value === "1";
}
