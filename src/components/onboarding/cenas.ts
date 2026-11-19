/**
 * Cenas do onboarding imersivo: as barras do símbolo ORION são o elenco. Começam
 * no cinturão (o anel de barras) e, a cada passo, se reorganizam na metáfora do
 * passo até se fecharem no símbolo. Cada cena devolve, para cada barra,
 * [x, y, largura, altura, rotação, cor, opacidade] em % do palco.
 */

export type Barra = [number, number, number, number, number, string, number];
export type Cena = (n: number) => Barra[];

export const N_BARRAS = 72;

const WIDTHS = [0.15, 0.19, 0.13, 0.17, 0.1, 0.07, 0.045];
const HEIGHTS = [0.64, 1.16, 1.6, 1.72, 1.56, 1.24, 0.88];
const PAL = ["#2D77CC", "#7DB7F0", "#22306F", "#7DB7F0", "#2D77CC", "#FFF8E7", "#22306F"];

/** Símbolo em 14 trechos: [cx, cy, w, h] em unidades do raio. */
export const SIMBOLO: [number, number, number, number][] = [
  [-0.7, -0.18, 0.15, 0.24], [-0.7, 0.19, 0.15, 0.3], [-0.44, -0.36, 0.19, 0.44], [-0.44, 0.27, 0.19, 0.62],
  [-0.17, -0.6, 0.13, 0.4], [-0.17, -0.04, 0.13, 0.52], [-0.17, 0.56, 0.13, 0.48], [0.08, -0.39, 0.17, 0.94],
  [0.08, 0.52, 0.17, 0.68], [0.32, -0.47, 0.1, 0.62], [0.32, 0.36, 0.1, 0.84], [0.52, -0.24, 0.07, 0.76],
  [0.52, 0.43, 0.07, 0.38], [0.7, 0, 0.045, 0.88],
];

const oculta = (): Barra => [50, 50, 0.5, 0.5, 0, "#22306F", 0];
const cada = (n: number, f: (i: number) => Barra): Barra[] => Array.from({ length: n }, (_, i) => f(i));

export const CENAS: Record<string, Cena> = {
  cinturao: (n) =>
    cada(n, (i) => {
      const j = (i * 3 + Math.floor(i / 7)) % 7;
      const a = (i * 360) / n;
      const r = 38;
      return [50 + r * Math.sin((a * Math.PI) / 180), 50 - r * Math.cos((a * Math.PI) / 180), WIDTHS[j] * 9, HEIGHTS[j] * 9, a, PAL[(i * 5) % 7], 1];
    }),
  entrada: (n) =>
    cada(n, (i) => {
      if (i < 36) return [10 + i * 1.5, 50 + Math.sin(i * 0.5) * 2, 1, 9 - (i % 4), 0, i > 30 ? "#FFF8E7" : "#7DB7F0", 0.25 + i / 48];
      const d = i - 36;
      return d < 24 ? [70 + (d % 4) * 6, 34 + Math.floor(d / 4) * 6, 5, 4.6, 0, "#2D77CC", 1] : oculta();
    }),
  estoque: (n) =>
    cada(n, (i) => {
      if (i < 40) {
        const c = i % 8;
        const r = Math.floor(i / 8);
        const f = ((i * 7) % 10) / 10;
        return [24 + c * 7, 26 + r * 10, 5.6, 2 + f * 5, 0, f > 0.85 ? "#E9B53A" : "#2CC593", 1];
      }
      const u = i - 40;
      if (u < 9) return [21 + u * 7, 52, 0.7, 54, 0, "#2D77CC", 1];
      if (u < 14) return [52, 22 + (u - 9) * 10 + 5.5, 58, 0.6, 0, "#2D77CC", 1];
      return oculta();
    }),
  saida: (n) =>
    cada(n, (i) => {
      const lane = i % 4;
      const k = Math.floor(i / 4);
      return [30 + k * 4.2, 38 + lane * 8, 2.8 + (k % 3), 1.4, 0, k > 14 ? "#FFF8E7" : lane % 2 ? "#7DB7F0" : "#2D77CC", Math.min(1, 0.2 + k / 12)];
    }),
  inventario: (n) =>
    cada(n, (i) => {
      if (i >= 60) return oculta();
      const c = i % 10;
      const r = Math.floor(i / 10);
      const sel = i === 27;
      const cor = sel ? "#F8E2A6" : (i * 13) % 7 === 0 ? "#F2545E" : (i * 5) % 3 ? "#178A69" : "#2E3756";
      return [30 + c * 5 - r * 2.2, 30 + r * 6 + c * 1.1, 4.2, 4.2, 0, cor, sel ? 1 : 0.8];
    }),
  indicadores: (n) => {
    const vals = [0.4, 0.5, 0.35, 0.6, 0.7, 0.5, 0.45, 0.8, 0.6, 0.55, 0.7, 0.65, 0.8, 0.95];
    return cada(n, (i) => {
      if (i >= 28) return oculta();
      const k = i % 14;
      const topo = i < 14;
      const h = vals[k] * 40;
      const seg = topo ? h * 0.38 : h * 0.58;
      const y = topo ? 76 - h + seg / 2 : 76 - seg / 2;
      return [26 + k * 4.4, y, WIDTHS[k % 7] * 14, seg, 0, k === 13 ? "#2563EB" : "#7DB7F0", 1];
    });
  },
  comex: (n) => {
    const C = ["#2D77CC", "#F8E2A6", "#7DB7F0", "#2CC593", "#22306F"];
    return cada(n, (i) => {
      if (i < 30) {
        const c = i % 6;
        const r = Math.floor(i / 6);
        return [28 + c * 9, 70 - r * 7, 8.4, 6, 0, C[(c + r * 2) % 5], 1];
      }
      return i < 32 ? [50, 75 + (i - 30) * 3, 70, 1.2, 0, "#22306F", 1] : oculta();
    });
  },
  tarefas: (n) =>
    cada(n, (i) => {
      if (i < 6) return [50, 30 + i * 8, 46, 5.4, 0, i === 0 ? "#FFF8E7" : "#22306F", i === 0 ? 1 : 0.8];
      if (i < 12) return [32, 30 + (i - 6) * 8, 3, 3, 0, i === 6 ? "#060B2A" : "#2CC593", 1];
      return oculta();
    }),
  leitor: (n) =>
    cada(n, (i) => {
      if (i < 34) return [30 + i * 1.2, 50, WIDTHS[i % 7] * 6, 26, 0, "#FFF8E7", 1];
      return i === 34 ? [50, 50, 48, 0.6, 0, "#F2545E", 1] : oculta();
    }),
  auditoria: (n) =>
    cada(n, (i) => {
      if (i < 10) return [30 + i * 4.8, 50, 1.6, 1.6, 0, "#7DB7F0", 1];
      if (i < 20) {
        const k = i - 10;
        return [30 + k * 4.8, k % 2 ? 40 : 60, 3.6, 8, 0, k === 9 ? "#FFF8E7" : "#22306F", 1];
      }
      return i === 20 ? [52, 50, 46, 0.4, 0, "#2D77CC", 1] : oculta();
    }),
  atlas: (n) =>
    cada(n, (i) => {
      if (i < 14) {
        const g = SIMBOLO[i];
        return [30 + g[0] * 12, 50 + g[1] * 12, g[2] * 12, g[3] * 12, 0, "#F8E2A6", 1];
      }
      if (i < 28) {
        const g = SIMBOLO[i - 14];
        return [72 + g[0] * 12, 50 + g[1] * 12, g[2] * 12, g[3] * 12, 0, "#7DB7F0", 1];
      }
      return i < 40 ? [42 + (i - 28) * 1.6, 50, 0.9, 0.9, 0, "#FFF8E7", i % 3 ? 0.5 : 1] : oculta();
    }),
  final: (n) =>
    cada(n, (i) => {
      if (i >= 14) return oculta();
      const g = SIMBOLO[i];
      return [50 + g[0] * 30, 50 + g[1] * 30, g[2] * 30, g[3] * 30, 0, "#FFF8E7", 1];
    }),
};

/** Texto imersivo de cada passo: rótulo, palavra grande e cena. */
export const TEXTO_IMERSIVO: Record<string, { rotulo: string; palavra: string; cena: string; linha?: string }> = {
  entrada: { rotulo: "ENTRADA", palavra: "Chega.", cena: "entrada", linha: "A nota chega, você confere e o ORION já sabe onde guardar cada palete." },
  estoque: { rotulo: "ESTOQUE", palavra: "Tem lugar.", cena: "estoque", linha: "Cada palete tem endereço, lote e validade. Nada fica perdido." },
  saida: { rotulo: "SAÍDA", palavra: "Sai certo.", cena: "saida", linha: "O pedido vira onda, é separado, conferido e sai pela doca." },
  inventario: { rotulo: "INVENTÁRIO", palavra: "Apaga a luz.", cena: "inventario", linha: "Na contagem, o CD escurece e você fica de frente para cada posição." },
  indicadores: { rotulo: "INDICADORES", palavra: "Mostra tudo.", cena: "indicadores", linha: "Ocupação, produtividade e acuracidade, no traço do símbolo." },
  comex: { rotulo: "COMEX", palavra: "Cruza o mar.", cena: "comex", linha: "Importação e exportação juntas, do embarque à armazenagem." },
  tarefas: { rotulo: "SUAS TAREFAS", palavra: "Uma por vez.", cena: "tarefas", linha: "O que é seu no turno aparece aqui, na ordem certa." },
  leitor: { rotulo: "LEITOR", palavra: "Aponte e leia.", cena: "leitor", linha: "O leitor fica dentro da busca. Etiqueta lida, tarefa aberta." },
  confirmar: { rotulo: "CONFIRMAR", palavra: "Confere e segue.", cena: "tarefas", linha: "Conferiu? Confirme a tarefa e o ORION já mostra a próxima." },
  relatorios: { rotulo: "RELATÓRIOS", palavra: "Tudo exportável.", cena: "indicadores", linha: "Saldos, movimentações e inventários por período." },
  auditoria: { rotulo: "AUDITORIA", palavra: "Quem, quando.", cena: "auditoria", linha: "Cada alteração com o antes e o depois." },
  rastreabilidade: { rotulo: "RASTREABILIDADE", palavra: "Lote a lote.", cena: "auditoria", linha: "Siga cada unidade de endereço em endereço, por lote." },
  atlas: { rotulo: "ATLAS + ORION", palavra: "Um só céu.", cena: "atlas", linha: "No ATLAS: cadastros, pedidos e NF-e. No ORION: tudo dentro do armazém." },
};
