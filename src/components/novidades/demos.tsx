import type { CSSProperties } from "react";
import type { DemoKind } from "@/content/novidades";

/** Demonstrações animadas (tipo GIF) da janela de novidades, só com CSS. */
export function NovidadeDemo({ kind, label }: { kind: DemoKind; label?: string }) {
  if (kind === "nenhuma") return null;
  const Body = kind === "inventario3d" ? Inventario3D : kind === "barras14" ? Barras14 : ColetorBusca;
  const bg = kind === "inventario3d" ? "bg-[#03061A]" : kind === "barras14" ? "bg-creme-100" : "bg-gelo-200";
  const tag = kind === "inventario3d" ? "bg-[#111C4A] text-ceu-300" : kind === "barras14" ? "bg-[#F3EAD3] text-[#7A5300]" : "bg-white text-gelo-700";
  return (
    <div role="img" aria-label={label} className={`relative min-h-[170px] flex-1 overflow-hidden rounded-2xl ${bg}`}>
      <span className={`absolute top-3 left-3.5 z-10 rounded-md px-2 py-1 font-mono text-[11px] tracking-[0.12em] ${tag}`}>COMO FUNCIONA</span>
      <Body />
    </div>
  );
}

const CELLS: [string, string][] = [
  ["60%", "#178A69"], ["85%", "#178A69"], ["30%", "#2E3756"], ["70%", "#178A69"], ["45%", "#178A69"], ["90%", "#178A69"],
  ["50%", "#2E3756"], ["40%", "#B83740"], ["75%", "#178A69"], ["sel", ""], ["20%", "#2E3756"], ["65%", "#178A69"],
  ["80%", "#178A69"], ["55%", "#178A69"], ["35%", "#2E3756"], ["95%", "#178A69"], ["60%", "#178A69"], ["25%", "#2E3756"],
];

function Inventario3D() {
  return (
    <>
      <div className="nv-rack">
        {CELLS.map(([f, c], i) =>
          f === "sel" ? <div key={i} className="nv-cell sel" /> : <div key={i} className="nv-cell" style={{ "--f": f, "--c": c } as CSSProperties} />,
        )}
      </div>
      <span className="nv-cursor" />
      <span className="nv-tag72">72%</span>
    </>
  );
}

export const SPARK_VALUES = [0.4, 0.5, 0.35, 0.6, 0.7, 0.5, 0.45, 0.8, 0.6, 0.55, 0.7, 0.65, 0.8, 0.95];
export const SPARK_WIDTHS = [5, 8, 6, 10, 5, 8, 6, 10, 5, 8, 6, 10, 5, 10];

function Barras14() {
  return (
    <div className="absolute inset-0 flex items-end gap-1.5 p-[22px] text-noite-900">
      <div className="mr-auto font-display text-[76px] leading-[0.85] font-extrabold tracking-[-0.05em] tabular-nums">
        186
        <small className="mt-2 block font-sans text-[13px] font-medium tracking-normal text-gelo-700">pedidos expedidos hoje</small>
      </div>
      {SPARK_VALUES.map((v, i) => (
        <div
          key={i}
          className={`nv-bar${i === 13 ? " today" : ""}`}
          style={{ "--w": `${SPARK_WIDTHS[i]}px`, "--h": `${Math.round(v * 120)}px`, "--i": i } as CSSProperties}
        />
      ))}
    </div>
  );
}

const CODE = [3, -1, 2, 4, -1, 2, 1, -3, 4, 2, -1, 3, 1, -2, 4, 1, 2, -3, 2, 4, 1];

function ColetorBusca() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-5 text-noite-900">
      <div className="flex h-[52px] w-full max-w-[420px] items-center gap-2.5 rounded-full border border-[#C9D6E4] bg-white pr-[7px] pl-[18px] text-gelo-700">
        <span className="flex-1 overflow-hidden font-mono text-sm whitespace-nowrap text-noite-900">
          <span className="nv-type">ARM-02-07-03</span>
        </span>
        <span className="nv-scan grid size-[38px] place-items-center rounded-full bg-noite-900">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFF8E7" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8 7v10M12 7v10M17 7v10" />
          </svg>
        </span>
      </div>
      <div className="nv-code relative flex h-[54px] w-[200px] items-stretch gap-0.5 rounded-lg bg-white px-2.5 py-1.5">
        {CODE.map((w, i) => (
          <i key={i} className="block" style={{ width: Math.abs(w), background: w > 0 ? "#060B2A" : "transparent" }} />
        ))}
        <span className="nv-laser" />
      </div>
      <div className="nv-res flex w-full max-w-[420px] items-center justify-between rounded-[14px] bg-noite-900 px-4 py-3 text-[13px] text-creme-100">
        <span>Contagem · nível 3</span>
        <b className="font-mono text-[15px] font-medium text-ceu-400">ARM-02-07-03</b>
      </div>
    </div>
  );
}
