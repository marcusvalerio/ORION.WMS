import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { Link2, MapPinned, PackageCheck, ScanBarcode, Ship, Waves } from "lucide-react";
import { OrionRing } from "@/components/brand/orion-ring";
import { TURMA_ATUAL } from "@/server/services/site-leads";
import { LeadForm } from "./site/lead-form";
import { SiteMotion } from "./site/motion";

/**
 * Página pública de vendas do ORION (fora da área logada: não passa por
 * requireCtx). Clientes, números e depoimento são ilustrativos.
 */
export const metadata: Metadata = {
  title: { absolute: "ORION — o armazém que os outros vão copiar" },
  description: "WMS do ecossistema ASTRAEUS: recebimento, armazenagem, inventário em 3D, separação em ondas e coletor. Turma de implantação 2027 com vagas limitadas.",
};

const PAD = "px-[clamp(16px,4vw,64px)]";
const MONO_KICKER = "font-mono text-[13px] tracking-[0.18em]";

const MARQUEE = [
  `TURMA ${TURMA_ATUAL.ano} · ${TURMA_ATUAL.vagas - TURMA_ATUAL.preenchidas} VAGAS RESTANTES`,
  "4.200 ENDEREÇOS CONTADOS NUMA MANHÃ",
  "INVENTÁRIO EM 3D",
  "COLETOR NA BUSCA",
  "ECOSSISTEMA ASTRAEUS",
  "ATLAS + ORION",
  "CONTAGEM CEGA",
];

const FEATURE_ICONS = [PackageCheck, MapPinned, Waves, ScanBarcode, Ship, Link2];

const FEATURES: [string, string, string, string, string][] = [
  ["01", "Recebimento sem papel", "Agenda de docas, NF-e em XML e conferência parcial.", "#060B2A", "#FFF8E7"],
  ["02", "Armazenagem guiada", "O sistema sugere o endereço; o coletor confirma pela etiqueta.", "#FFFFFF", "#060B2A"],
  ["03", "Separação em ondas", "Ondas, reposição automática e cancelamento mesmo após separar.", "#7DB7F0", "#060B2A"],
  ["04", "Coletor no bolso", "Leia o código na busca e caia direto na tarefa certa.", "#FFF8E7", "#060B2A"],
  ["05", "Comex", "Importação e exportação com os detalhes das encomendas internacionais.", "#FFFFFF", "#060B2A"],
  ["06", "Ligado ao ATLAS", "Empresa, pedidos e produção chegam do ERP sem redigitar.", "#22306F", "#FFF8E7"],
];

const CLIENTES = ["Frioverde", "Casa Norte", "Ponte Alta Log", "Vale do Aço Peças", "Brisa Farma", "Maré Alimentos"];

const SPARK = [0.4, 0.5, 0.35, 0.6, 0.7, 0.5, 0.45, 0.8, 0.6, 0.55, 0.7, 0.65, 0.8, 0.95];
const SPARK_W = [5, 8, 6, 10, 5, 8, 6, 10, 5, 8, 6, 10, 5, 10];
const SPLIT_A = [0.6, 0.7, 0.5, 0.8, 0.65, 0.75, 0.55, 0.85, 0.7, 0.9];
const SPLIT_B = [0.35, 0.4, 0.3, 0.45, 0.4, 0.38, 0.42, 0.5, 0.44, 0.55];
const ZONE_W = [3, 2, 4, 2, 3, 1, 2, 3];
const ZONES: [string, number][] = [["Porta-paletes", 82], ["Picking leve", 56], ["Câmara fria", 38]];
const STACK: [string, number, number, number][] = [["Rec.", 0.2, 0.2, 0.5], ["Arm.", 0.15, 0.25, 0.45], ["Sep.", 0.3, 0.3, 0.35], ["Rep.", 0.1, 0.1, 0.3], ["Inv.", 0.2, 0.15, 0.55]];
const GLYPH: [number, number, number, number][] = [
  [-0.775, 0.15, -0.3, 0.24], [-0.775, 0.15, 0.04, 0.3], [-0.535, 0.19, -0.58, 0.44], [-0.535, 0.19, -0.04, 0.62], [-0.235, 0.13, -0.8, 0.4],
  [-0.235, 0.13, -0.3, 0.52], [-0.235, 0.13, 0.32, 0.48], [-0.005, 0.17, -0.86, 0.94], [-0.005, 0.17, 0.18, 0.68], [0.27, 0.1, -0.78, 0.62],
  [0.27, 0.1, -0.06, 0.84], [0.485, 0.07, -0.62, 0.76], [0.485, 0.07, 0.24, 0.38], [0.6775, 0.045, -0.44, 0.88],
];

/** CD isométrico: 4 ruas × 10 módulos × 4 níveis, cada posição pela situação da contagem. */
function isoFaces() {
  const s = 30, hz = 20, c = 0.866, ox = 380, oy = 90;
  const P = (x: number, y: number, z: number) => [ox + (x - y) * c * s, oy + (x + y) * 0.5 * s - z * hz];
  const pts = (a: number[][]) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const pal = { c: ["#2CC593", "#178A69", "#0F6B51"], p: ["#4A5578", "#2E3756", "#232B47"], d: ["#F2545E", "#B83740", "#8F2A31"], s: ["#FFF8E7", "#F8E2A6", "#D9BE77"] };
  const faces = [{ p: pts([P(-1, -1, 0), P(11, -1, 0), P(11, 11, 0), P(-1, 11, 0)]), c: "#0A1230" }];
  for (let a = 0; a < 4; a++)
    for (let m = 0; m < 10; m++)
      for (let l = 0; l < 4; l++) {
        const h = (a * 31 + m * 17 + l * 7) % 23;
        const st = a === 1 && m === 6 && l === 1 ? "s" : h === 3 || h === 11 ? "d" : h < 17 ? "c" : "p";
        const k = pal[st as keyof typeof pal];
        const y = a * 3, g = 0.12;
        const x0 = m + g / 2, x1 = m + 1 - g / 2, y0 = y + g / 2, y1 = y + 1 - g / 2, z0 = l + 0.06, z1 = l + 0.94;
        faces.push({ p: pts([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)]), c: k[1] });
        faces.push({ p: pts([P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)]), c: k[2] });
        faces.push({ p: pts([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)]), c: k[0] });
      }
  return faces;
}

function Seats({ on, off }: { on: string; off: string }) {
  return (
    <div className="flex h-3 w-full gap-1" aria-hidden>
      {Array.from({ length: TURMA_ATUAL.vagas }, (_, i) => (
        <div key={i} className="flex-1 rounded-[2px]" style={{ background: i < TURMA_ATUAL.preenchidas ? on : off }} />
      ))}
    </div>
  );
}

export default function LandingPage() {
  const restam = TURMA_ATUAL.vagas - TURMA_ATUAL.preenchidas;
  const totalZone = ZONE_W.reduce((a, b) => a + b, 0);
  return (
    <div className="w-full overflow-x-hidden bg-[#03061A] font-sans text-creme-100" style={{ colorScheme: "dark" }}>
      <SiteMotion />
      {/* Letreiro */}
      <div className="overflow-hidden bg-creme-100 py-2.5 font-mono text-[13px] font-medium whitespace-nowrap text-noite-900">
        <div className="orion-marquee inline-flex gap-12 pl-6" aria-label={MARQUEE.join(" · ")}>
          {[...MARQUEE, ...MARQUEE].map((m, i) => (
            <span key={i} aria-hidden>
              {m}
            </span>
          ))}
        </div>
      </div>

      {/* Hero: espaço profundo, um O gigante e a tela real do ORION subindo a partir de 2/5 */}
      <section className="relative flex flex-col overflow-hidden bg-[#03061A]">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {/* nebulosas: só degradês, sem pontos de estrela */}
          <div className="absolute inset-0 bg-[radial-gradient(60%_45%_at_18%_12%,rgba(45,119,204,0.28)_0%,rgba(3,6,26,0)_70%),radial-gradient(45%_40%_at_85%_30%,rgba(125,183,240,0.18)_0%,rgba(3,6,26,0)_70%),radial-gradient(70%_50%_at_50%_100%,rgba(34,48,111,0.55)_0%,rgba(3,6,26,0)_75%)]" />
          {/* um só O gigante atrás do título, girando com a onda */}
          <div className="site-ring absolute top-[34%] left-1/2">
            <OrionRing size="var(--rs)" bars={96} barWidth={200} barLength={360} spinSeconds={70} waveSeconds={4} className="opacity-80 [--rs:1500px] max-sm:[--rs:820px]" />
          </div>
          <div className="absolute inset-0 bg-[radial-gradient(42%_30%_at_50%_28%,rgba(3,6,26,0.78)_0%,rgba(3,6,26,0.25)_65%,rgba(3,6,26,0)_100%)]" />
        </div>

        <nav aria-label="Principal" className={`relative flex flex-wrap items-center gap-6 py-7 ${PAD}`}>
          <span className="font-display text-[28px] font-semibold tracking-[-0.03em]">orion</span>
          <div className="ml-auto flex flex-wrap items-center gap-6 text-sm">
            <a href="#antes" className="text-ceu-300 hover:text-creme-100 max-sm:hidden">
              Por que agora
            </a>
            <a href="#inventario" className="text-ceu-300 hover:text-creme-100 max-sm:hidden">
              Inventário
            </a>
            <Link href="/login" className="text-ceu-300 hover:text-creme-100">
              Entrar
            </Link>
            <a href="#vaga" className="rounded-full bg-creme-100 px-[22px] py-[11px] font-semibold text-noite-900 max-sm:hidden">
              Garantir minha vaga
            </a>
          </div>
        </nav>

        <div className={`relative mx-auto flex max-w-[1080px] flex-col items-center gap-5 pt-[clamp(8px,2.5vw,36px)] text-center ${PAD}`}>
          <span className="site-in rounded-full border border-noite-600 bg-[#03061A]/60 px-3.5 py-2 font-mono text-xs tracking-[0.12em] text-creme-300">
            TURMA DE IMPLANTAÇÃO {TURMA_ATUAL.ano} · VAGAS LIMITADAS
          </span>
          <h1 className="site-in site-d1 font-display text-[clamp(44px,6vw,92px)] leading-[1.02] font-semibold tracking-[-0.03em] text-balance">
            O armazém que os outros <span className="text-ceu-400">vão copiar.</span>
          </h1>
          <p className="site-in site-d2 max-w-[640px] text-[clamp(17px,1.5vw,21px)] leading-[1.5] text-[#C9D6E4]">
            Enquanto o seu concorrente ainda confere palete na prancheta, quem está no ORION já sabe onde está cada caixa, quem contou e quanto falta para a doca.
          </p>
          <div className="site-in site-d3 flex flex-wrap items-center justify-center gap-3.5">
            <a href="#vaga" className="site-cta rounded-full bg-creme-100 px-8 py-4 text-base font-semibold text-noite-900 hover:bg-white">
              Quero o meu CD no ORION
            </a>
            <a href="#inventario" className="rounded-full border border-noite-600 bg-[#03061A]/60 px-7 py-4 text-base hover:border-ceu-400">
              Ver funcionando
            </a>
          </div>
          <div className="flex w-full max-w-[420px] flex-col items-center gap-2.5">
            <Seats on="#7DB7F0" off="#22306F" />
            <span className="text-[13px] text-ceu-300">
              <b className="text-creme-100">
                {TURMA_ATUAL.preenchidas} de {TURMA_ATUAL.vagas} vagas
              </b>{" "}
              da turma {TURMA_ATUAL.ano} já preenchidas
            </span>
          </div>
        </div>

        {/* a tela real, entrando por baixo com leve perspectiva */}
        <div className={`relative mt-[clamp(28px,3.5vw,48px)] ${PAD}`} style={{ perspective: "2200px" }}>
          <figure className="mx-auto w-full max-w-[1180px] origin-top overflow-hidden site-tilt rounded-lg border border-white/30 bg-white [transform:rotateX(14deg)] max-sm:[transform:none]">
            <div className="flex items-center gap-2 border-b border-gelo-200 bg-gelo-50 px-4 py-2.5">
              <span className="size-2.5 rounded-full bg-gelo-200" />
              <span className="size-2.5 rounded-full bg-gelo-200" />
              <span className="size-2.5 rounded-full bg-gelo-200" />
              <span className="ml-3 font-mono text-[11px] text-gelo-700">orion.astraeus.com.br</span>
            </div>
            <Image
              src="/site/painel-orion-claro.webp"
              alt="Painel do ORION no tema claro: indicadores do armazém, recebimentos e expedições dos últimos 14 dias e ocupação no traço do símbolo"
              width={2880}
              height={1800}
              priority
              sizes="(max-width: 1240px) 100vw, 1180px"
              className="block h-auto w-full"
            />
          </figure>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] bg-[linear-gradient(180deg,rgba(3,6,26,0)_0%,#03061A_92%)]" />
        </div>
        <div aria-hidden className="h-[clamp(8px,2vw,24px)]" />
      </section>

      {/* Sem × Com */}
      <section id="antes" className="site-reveal grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))]">
        <div className={`flex flex-col gap-[22px] bg-[#C9D0DA] py-[clamp(56px,7vw,112px)] text-[#3A4256] ${PAD}`}>
          <span className="font-mono text-[13px] tracking-[0.14em]">SEM ORION</span>
          <p className="font-display text-[clamp(40px,5vw,84px)] leading-[1.02] font-semibold tracking-[-0.03em] line-through decoration-4">
            Planilha.
            <br />
            Prancheta.
            <br />
            Rádio.
            <br />
            “Acho que tá na rua 3.”
          </p>
          <p className="max-w-[420px] text-base leading-normal">Inventário que fecha o CD por dias, divergência descoberta só no fim do mês e cliente ligando para saber do pedido.</p>
        </div>
        <div className={`flex flex-col gap-[22px] bg-noite-900 py-[clamp(56px,7vw,112px)] ${PAD}`}>
          <span className="font-mono text-[13px] tracking-[0.14em] text-ceu-400">COM ORION</span>
          <p className="font-display text-[clamp(40px,5vw,84px)] leading-[1.02] font-semibold tracking-[-0.03em]">
            Leu.
            <br />
            Achou.
            <br />
            Contou.
            <br />
            <span className="font-mono text-[0.62em] font-medium tracking-[-0.02em] text-creme-300">ARM-02-07-03</span>
          </p>
          <p className="max-w-[420px] text-base leading-normal text-ceu-300">Cada endereço com dono, cada contagem com histórico, cada pedido com o caminho mais curto até a doca.</p>
        </div>
      </section>

      {/* Modo inventário */}
      <section id="inventario" className={`site-reveal flex flex-wrap items-center gap-12 bg-[#03061A] py-[clamp(64px,8vw,128px)] ${PAD}`}>
        <div className="flex flex-[1_1_380px] flex-col gap-[22px]">
          <span className={`${MONO_KICKER} text-ceu-400`}>MODO INVENTÁRIO</span>
          <h2 className="font-display text-[clamp(44px,6.5vw,108px)] leading-[1.02] font-semibold tracking-[-0.03em]">O CD apaga a luz. A contagem acende.</h2>
          <p className="max-w-[520px] text-lg leading-relaxed text-ceu-300">
            O armazém aparece em 3D e cada posição se acende pela situação da contagem. Escolheu o endereço? A câmera para de frente para ele e mostra o quanto ele está cheio.
          </p>
          <a href="#vaga" className="self-start rounded-full bg-ceu-400 px-[30px] py-[18px] text-base font-bold text-noite-900">
            Quero ver no meu CD
          </a>
        </div>
        <svg role="img" aria-label="Ilustração do CD em 3D com endereços acesos pela situação da contagem" viewBox="0 0 760 520" className="h-auto w-full max-w-[860px] flex-[1_1_520px]">
          {isoFaces().map((f, i) => (
            <polygon key={i} points={f.p} fill={f.c} />
          ))}
        </svg>
      </section>

      {/* KPIs */}
      <section aria-labelledby="kpi-t" className={`site-reveal flex flex-col gap-10 bg-noite-800 py-[clamp(64px,8vw,128px)] ${PAD}`}>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h2 id="kpi-t" className="max-w-[900px] font-display text-[clamp(40px,5.5vw,88px)] leading-[1.02] font-semibold tracking-[-0.03em]">
            Números que têm a cara do seu armazém.
          </h2>
          <p className="max-w-[400px] text-[17px] leading-relaxed text-ceu-300">Cada gráfico do ORION nasce das barras do símbolo. Bonito de olhar, rápido de ler.</p>
        </div>
        <div className="site-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="flex flex-col gap-3.5 site-card rounded-lg bg-creme-100 p-[26px] text-noite-900">
            <span className="text-sm font-medium text-gelo-700">Pedidos expedidos hoje</span>
            <div className="flex items-end justify-between gap-4">
              <span className="font-display text-[72px] leading-[1.02] font-semibold tracking-[-0.03em] tabular-nums" data-count="186">186</span>
              <div role="img" aria-label="Últimos 14 dias, hoje em destaque" className="site-grow flex h-[70px] min-w-0 items-end gap-[3px]">
                {SPARK.map((v, i) => (
                  <div key={i} className="rounded-[2px]" style={{ width: Math.round(SPARK_W[i] * 0.7), height: Math.round(v * 70), background: i === 13 ? "#2563EB" : "#C9D6E4" }} />
                ))}
              </div>
            </div>
            <span className="text-[13px] text-ok-fg">▲ acima da média dos últimos 14 dias</span>
          </div>
          <div className="flex flex-col items-center gap-2.5 site-card rounded-lg bg-noite-900 p-[26px]">
            <span className="self-start text-sm font-medium text-ceu-300">Ocupação do CD</span>
            <svg role="img" aria-label="Ocupação 71%" width="170" height="170" viewBox="-1 -1 2 2" className="site-glyph">
              {GLYPH.map(([x, w, y, h], i) => (
                <rect key={i} x={x} y={y} width={w} height={h} fill={i < 10 ? "#7DB7F0" : "#22306F"} />
              ))}
            </svg>
            <span className="font-display text-5xl leading-none font-semibold tabular-nums"><span data-count="71">71</span>%</span>
          </div>
          <div className="flex flex-col gap-3.5 site-card rounded-lg bg-ceu-400 p-[26px] text-noite-900">
            <span className="text-sm font-semibold">Armazenado × expedido</span>
            <div role="img" aria-label="Colunas diárias divididas em armazenado e expedido" className="site-grow flex h-[150px] items-end gap-1.5">
              {SPLIT_A.map((v, i) => (
                <div key={i} className="flex flex-1 flex-col gap-1">
                  <div className="rounded-[3px] bg-noite-900" style={{ height: Math.round(v * 90) }} />
                  <div className="rounded-[3px] bg-creme-100" style={{ height: Math.round(SPLIT_B[i] * 90) }} />
                </div>
              ))}
            </div>
            <span className="text-[13px]">
              ▇ armazenado · <span className="text-creme-100">▇</span> expedido
            </span>
          </div>
          <div className="flex flex-col gap-3.5 site-card rounded-lg bg-white p-[26px] text-noite-900">
            <span className="text-sm font-medium text-gelo-700">Ocupação por zona</span>
            {ZONES.map(([n, pct]) => {
              let acc = 0;
              return (
                <div key={n} className="flex flex-col gap-1.5">
                  <div className="flex justify-between text-[13px]">
                    <span>{n}</span>
                    <b className="font-semibold">{pct}%</b>
                  </div>
                  <div className="site-fill flex h-3.5 gap-1" aria-hidden>
                    {ZONE_W.map((w, i) => {
                      acc += w;
                      const on = acc / totalZone <= pct / 100 + 0.001;
                      return <div key={i} className="rounded-[3px]" style={{ flex: w, background: on ? (pct > 70 ? "#E0A100" : "#2D77CC") : "#EDF2F8" }} />;
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-col gap-3.5 site-card rounded-lg border border-noite-600 bg-[#03061A] p-[26px]">
            <span className="text-sm font-medium text-ceu-300">Tarefas por tipo</span>
            <div role="img" aria-label="Tarefas concluídas, em execução e pendentes por tipo" className="site-grow flex h-[150px] items-end gap-3.5">
              {STACK.map(([t, p, e, c]) => (
                <div key={t} className="flex flex-1 flex-col items-stretch gap-1">
                  <div className="rounded-[3px] bg-[#4A5578]" style={{ height: Math.round(p * 120) }} />
                  <div className="rounded-[3px] bg-cobalto-600" style={{ height: Math.round(e * 120) }} />
                  <div className="rounded-[3px] bg-[#2CC593]" style={{ height: Math.round(c * 120) }} />
                  <span className="text-center text-[11px] text-ceu-300">{t}</span>
                </div>
              ))}
            </div>
            <span className="text-xs text-ceu-300">
              <span className="text-[#2CC593]">■</span> concluída · <span className="text-cobalto-600">■</span> em execução · <span className="text-[#4A5578]">■</span> pendente
            </span>
          </div>
          <div className="flex flex-col justify-between gap-2.5 site-card rounded-lg bg-creme-100 p-[26px] text-noite-900">
            <span className="text-sm font-medium text-gelo-700">Acuracidade do inventário</span>
            <span className="font-display text-[96px] leading-[1.02] font-semibold tracking-[-0.03em]">
              <span className="tabular-nums" data-count="98.4" data-decimals="1">98,4</span><span className="text-[0.45em]">%</span>
            </span>
            <span className="self-start rounded-full bg-[#E8F7F1] px-3 py-1.5 text-[13px] font-semibold text-[#0B6B4F]">+1,2 pp vs. ciclo anterior</span>
          </div>
        </div>
      </section>

      {/* Funcionalidades */}
      <section className={`site-reveal flex flex-col gap-12 bg-gelo-50 py-[clamp(64px,8vw,128px)] text-noite-900 ${PAD}`}>
        <h2 className="max-w-[1000px] font-display text-[clamp(40px,5.5vw,88px)] leading-[1.02] font-semibold tracking-[-0.03em]">Tudo entre a nota que chega e o caminhão que sai.</h2>
        <div className="site-stagger grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(([n, t, d, bg, fg], i) => {
            const Icon = FEATURE_ICONS[i];
            return (
            <article
              key={n}
              className="site-card flex min-h-[280px] flex-col justify-end gap-3.5 rounded-lg p-8"
              style={{ background: bg, color: fg, border: bg === "#FFFFFF" ? "1px solid #DCE8F3" : undefined } as CSSProperties}
            >
              <span className="site-icon mb-auto inline-flex size-14 items-center justify-center rounded-md border border-current/20">
                <Icon className="size-7" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="font-mono text-[13px] opacity-70">{n}</span>
              <h3 className="font-display text-[30px] leading-[1.05] font-semibold tracking-[-0.02em]">{t}</h3>
              <p className="text-[15px] leading-relaxed opacity-80">{d}</p>
            </article>
            );
          })}
        </div>
      </section>

      {/* Clientes */}
      <section className={`site-reveal flex flex-col gap-9 bg-noite-900 py-[clamp(56px,7vw,112px)] ${PAD}`}>
        <span className={`${MONO_KICKER} text-ceu-400`}>QUEM JÁ ESTÁ EM ÓRBITA</span>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(160px,100%),1fr))] gap-3">
          {CLIENTES.map((c) => (
            <li key={c} className="flex h-[84px] items-center justify-center rounded-[14px] border border-noite-600 font-display text-lg font-semibold text-ceu-300">
              {c}
            </li>
          ))}
        </ul>
        <blockquote className="flex max-w-[1100px] flex-col gap-[18px]">
          <p className="font-display text-[clamp(28px,3.6vw,56px)] leading-[1.05] font-bold tracking-[-0.03em]">
            “A gente fechava o CD três dias para contar. No primeiro inventário com o ORION, contamos 4.200 endereços numa manhã e ninguém parou de expedir.”
          </p>
          <footer className="text-[15px] text-ceu-300">Renata Albuquerque · Gerente de operações, Frioverde Distribuição</footer>
        </blockquote>
        <p className="text-xs text-gelo-500">Clientes e depoimento ilustrativos.</p>
      </section>

      {/* CTA final */}
      <section id="vaga" className={`site-reveal relative flex flex-col items-center gap-9 overflow-hidden bg-creme-100 py-[clamp(96px,12vw,200px)] text-center text-noite-900 ${PAD}`}>
        <OrionRing size={1800} bars={96} barWidth={200} barLength={360} palette="tinta" spinSeconds={260} className="absolute top-[calc(50%-900px)] left-[calc(50%-900px)] opacity-[0.16]" />
        <h2 className="relative max-w-[1200px] font-display text-[clamp(48px,9vw,156px)] leading-[1.02] font-semibold tracking-[-0.03em]">
          Entre nesta órbita
          <br />
          ou espere a próxima.
        </h2>
        <p className="relative max-w-[560px] text-[19px] leading-normal text-[#3A4256]">
          Implantamos poucos CDs por turma para fazer direito. Quando as vagas fecham, a lista de espera abre.
        </p>
        <LeadForm />
        <div className="relative flex w-full max-w-[460px] flex-col items-center gap-2.5">
          <Seats on="#060B2A" off="#C9D0DA" />
          <span className="text-[13px] text-[#3A4256]">
            <b className="text-noite-900">Restam {restam} vagas</b> · a turma fecha em {TURMA_ATUAL.fechaEm}
          </span>
        </div>
      </section>

      <footer className={`flex flex-wrap justify-between gap-4 border-t border-noite-700 bg-[#03061A] py-8 text-[13px] text-ceu-300 ${PAD}`}>
        <span>
          <b className="font-display text-lg font-semibold text-creme-100">orion</b> · ORION é do universo <b className="font-display font-semibold tracking-[0.12em] text-creme-100">ASTRAEUS</b>
        </span>
        <span className="font-mono">contato@astraeus.com.br · Belo Horizonte, MG</span>
      </footer>
    </div>
  );
}
