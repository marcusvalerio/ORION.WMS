import type { Role } from "@/lib/permissions";

/**
 * Notas de versão exibidas na janela "Novidades da versão".
 *
 * Para publicar uma versão nova, acrescente um item NO INÍCIO de `RELEASES`
 * (a primeira é a atual). Cada usuário vê a janela uma vez por versão, só com
 * as novidades dos perfis dele. Versões `leve: true` não abrem a janela: só um
 * aviso discreto no canto ("N novidades nesta versão · Ver").
 */
export type DemoKind = "inventario3d" | "barras14" | "coletorBusca" | "comexLinha" | "nenhuma";

export interface NovidadeItem {
  id: string;
  /** Rótulo curto acima do título (área do sistema). */
  area: string;
  titulo: string;
  texto: string;
  /** Tela aberta por "Experimentar agora". */
  rota?: string;
  /** Perfis que veem a novidade; vazio/ausente = todos. */
  perfis?: Role[];
  demo: DemoKind;
  /** Descrição da animação para leitores de tela. */
  demoDescricao?: string;
}

export interface Release {
  versao: string;
  data: string;
  leve?: boolean;
  itens: NovidadeItem[];
  /** Recado do ATLAS (ERP) exibido no passo final. */
  doAtlas?: string;
}

export const RELEASES: Release[] = [
  {
    versao: "2026.12",
    data: "2026-11-16",
    itens: [
      {
        id: "aba-comex",
        area: "Armazém",
        titulo: "Comex: importação e exportação em uma aba",
        texto: "Processos de importação do embarque à armazenagem (DI/DUIMP, canal, desembaraço) e pedidos de exportação com packing list e DU-E.",
        rota: "/comex",
        demo: "comexLinha",
        demoDescricao: "Animação: um processo de importação avança do embarque à armazenagem, o canal fica verde no desembaraço e a situação muda para armazenado",
      },
    ],
  },
  {
    versao: "2026.11",
    data: "2026-11-15",
    doAtlas: "Do ATLAS: pedidos agora chegam ao ORION com a data de entrega prometida.",
    itens: [
      {
        id: "inventario-3d",
        area: "Inventário",
        titulo: "O inventário ganhou o CD em 3D",
        texto: "Escolha o endereço e a vista para de frente para o porta-paletes, mostrando quanto a posição está cheia.",
        rota: "/inventario",
        perfis: ["admin", "supervisor", "operator", "auditor"],
        demo: "inventario3d",
        demoDescricao: "Animação: o cursor escolhe uma posição, a vista se aproxima e a posição se enche até 72%",
      },
      {
        id: "graficos-14-dias",
        area: "Indicadores",
        titulo: "Gráficos com a cara do ORION",
        texto: "Os KPIs agora mostram os últimos 14 dias em barras, com o dia de hoje em destaque.",
        rota: "/indicadores",
        perfis: ["admin", "supervisor", "auditor"],
        demo: "barras14",
        demoDescricao: "Animação: as barras dos últimos 14 dias sobem uma a uma, e a de hoje aparece em azul",
      },
      {
        id: "coletor-na-busca",
        area: "Coletor",
        titulo: "O coletor mora na busca",
        texto: "Toque no leitor dentro da busca, leia a etiqueta e caia direto na tarefa certa.",
        rota: "/coletor",
        perfis: ["admin", "supervisor", "operator"],
        demo: "coletorBusca",
        demoDescricao: "Animação: o leitor da busca é tocado, a etiqueta é lida, o endereço aparece na busca e a tarefa abre",
      },
    ],
  },
  {
    versao: "2026.10",
    data: "2026-10-20",
    leve: true,
    itens: [
      {
        id: "integracao-atlas",
        area: "Integração",
        titulo: "Fila de integração com o ATLAS",
        texto: "Reenvio e descarte de eventos com motivo registrado.",
        rota: "/integracao",
        perfis: ["admin", "supervisor", "auditor"],
        demo: "nenhuma",
      },
      { id: "devolucoes", area: "Devoluções", titulo: "Devoluções de cliente", texto: "Recebimento de devoluções com inspeção.", rota: "/devolucoes", demo: "nenhuma" },
    ],
  },
];
