"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Gift, X } from "lucide-react";
import { OrionRing } from "@/components/brand/orion-ring";
import { OrionMark } from "@/components/brand/orion-mark";
import { cn } from "@/components/ui/cn";
import { emTarefaEmAndamento, type NovidadesView } from "@/lib/novidades";
import { marcarNovidadesVistasAction } from "@/server/actions/novidades";
import { NovidadeDemo } from "./demos";

const pad = (n: number) => String(n).padStart(2, "0");

// O presente aparece em dois cabeçalhos (desktop e celular); a janela é uma só.
const OPEN_EVENT = "orion:novidades";
let seenNow = false;
const seenListeners = new Set<() => void>();
function setSeenNow() {
  seenNow = true;
  seenListeners.forEach((l) => l());
}

/** Ícone de presente com ponto azul enquanto a versão não foi vista. */
export function NovidadesGift({ pendente, total }: { pendente: boolean; total: number }) {
  const seenHere = useSyncExternalStore(
    (cb) => {
      seenListeners.add(cb);
      return () => seenListeners.delete(cb);
    },
    () => seenNow,
    () => false,
  );
  const unseen = pendente && !seenHere;
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      className="relative grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-fg hover:bg-subtle"
      aria-label={unseen ? `Ver novidades da versão (${total} não vistas)` : "Ver novidades da versão"}
      title="Novidades da versão"
    >
      <Gift className="size-[18px]" aria-hidden />
      {unseen ? <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full border-2 border-surface bg-cobalto-600" aria-hidden /> : null}
    </button>
  );
}

/**
 * Presente no topo + janela "Novidades da versão" + aviso leve.
 *
 * Abre sozinha uma vez por versão (salvo se o usuário estiver no meio de uma
 * contagem/separação); versões "leves" só mostram o aviso no canto. Fechar,
 * pular, Esc ou clicar fora marcam a versão como vista.
 */
export function Novidades({ view }: { view: NovidadesView }) {
  const pathname = usePathname();
  const router = useRouter();
  const busy = emTarefaEmAndamento(pathname);
  const [open, setOpen] = useState(() => view.pendente && !view.leve && !busy);
  const [toastOpen, setToastOpen] = useState(() => view.pendente && view.leve && !busy);
  const [seen, setSeen] = useState(!view.pendente);
  const [step, setStep] = useState(0);
  const [, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);

  const total = view.itens.length;
  const last = total; // passo final "Pronto."
  const item = step < total ? view.itens[step] : null;

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      nextRef.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!toastOpen) return;
    const t = setTimeout(() => setToastOpen(false), 12000);
    return () => clearTimeout(t);
  }, [toastOpen]);

  function markSeen() {
    if (seen) return;
    setSeen(true);
    setSeenNow();
    startTransition(() => {
      void marcarNovidadesVistasAction(view.versao);
    });
  }

  function close(showToast = true) {
    setOpen(false);
    markSeen();
    if (showToast) {
      setToastOpen(true);
      requestAnimationFrame(() => reopenRef.current?.focus());
    }
  }

  function openDialog() {
    setStep(0);
    setToastOpen(false);
    setOpen(true);
    markSeen();
  }

  const openRef = useRef(openDialog);
  useEffect(() => {
    openRef.current = openDialog;
  });
  useEffect(() => {
    const h = () => openRef.current();
    window.addEventListener(OPEN_EVENT, h);
    return () => window.removeEventListener(OPEN_EVENT, h);
  }, []);

  return (
    <>
      <dialog
        ref={dialogRef}
        aria-labelledby="novidades-titulo"
        aria-describedby="novidades-texto"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" && step < last) setStep(step + 1);
          if (e.key === "ArrowLeft" && step > 0) setStep(step - 1);
        }}
        className="m-auto h-[min(600px,calc(100dvh-32px))] w-[min(1040px,calc(100%-32px))] max-w-none overflow-hidden rounded-lg bg-white p-0 text-noite-900 border border-line backdrop:bg-[rgba(3,6,26,.62)] max-md:h-[min(720px,calc(100dvh-32px))]"
      >
        {open ? (
          <div className="relative flex h-full max-md:flex-col">
            <button
              type="button"
              onClick={() => close()}
              aria-label="Fechar novidades"
              className="absolute top-4 right-4 z-20 grid size-10 place-items-center rounded-full bg-gelo-50 hover:bg-gelo-200"
            >
              <X className="size-[18px]" aria-hidden />
            </button>
            <div className="relative flex w-[360px] shrink-0 flex-col justify-between overflow-hidden bg-[#03061A] p-8 text-creme-100 max-md:h-24 max-md:w-auto max-md:flex-row max-md:items-center max-md:px-[22px] max-md:py-[18px]">
              <OrionRing
                size="var(--ring-size)"
                bars={72}
                barWidth={150}
                barLength={220}
                palette={["#2D77CC", "#22306F", "#2D77CC", "#22306F", "#172354"]}
                spinSeconds={120}
                className="absolute top-[-70px] left-[-190px] [--ring-size:740px] max-md:top-[-160px] max-md:right-[-160px] max-md:left-auto max-md:[--ring-size:420px]"
              />
              <span className="relative self-start rounded-md bg-[#03061A]/85 px-2 py-1 font-mono text-xs tracking-[0.14em] text-ceu-400">VERSÃO {view.versao}</span>
              <div className="relative flex flex-col gap-1 self-start rounded-md bg-[#03061A]/85 px-3 py-2 max-md:flex-row max-md:items-baseline max-md:gap-2">
                <b className="font-display text-[72px] leading-[0.9] font-extrabold tracking-[-0.04em] max-md:text-[40px]">{pad(Math.min(step + 1, total))}</b>
                <span className="text-[13px] text-ceu-300">
                  de {total} {total === 1 ? "novidade" : "novidades"}
                </span>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-5 px-11 pt-10 pb-[30px] max-md:gap-3.5 max-md:px-5 max-md:pt-[22px] max-md:pb-[18px]">
              {item ? (
                <div key={step} className="orion-in flex min-h-0 flex-1 flex-col gap-3.5">
                  <span className="text-[13px] font-semibold text-ceu-600">{item.area}</span>
                  <h2 id="novidades-titulo" className="pr-10 font-display text-[38px] leading-none font-extrabold tracking-[-0.03em] text-balance max-md:text-[28px]">
                    {item.titulo}
                  </h2>
                  <p id="novidades-texto" className="max-w-[52ch] leading-relaxed text-gelo-700">
                    {item.texto}
                  </p>
                  <NovidadeDemo kind={item.demo} label={item.demoDescricao} />
                </div>
              ) : (
                <div key="fim" className="orion-in flex min-h-0 flex-1 flex-col justify-center gap-3.5">
                  <h2 id="novidades-titulo" className="font-display text-[60px] leading-[0.92] font-black tracking-[-0.03em] max-md:text-[40px]">
                    Pronto.
                    <br />
                    Bom trabalho hoje.
                  </h2>
                  <p id="novidades-texto" className="leading-relaxed text-gelo-700">
                    Você pode rever as novidades quando quiser pelo ícone de presente no topo.
                  </p>
                  {view.doAtlas ? <p className="mt-1 rounded-md bg-ceu-50 px-4 py-3.5 text-sm text-ceu-800">{view.doAtlas}</p> : null}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-[22px] items-end gap-[5px]" aria-hidden>
                  {Array.from({ length: total + 1 }, (_, i) => (
                    <i
                      key={i}
                      className={cn(
                        "block w-[7px] rounded-[2px] transition-all",
                        i === step ? "h-[22px] bg-ceu-400" : i < step ? "h-3.5 bg-noite-900" : "h-3.5 bg-gelo-200",
                      )}
                    />
                  ))}
                </div>
                <span className="sr-only" aria-live="polite">
                  Passo {step + 1} de {total + 1}
                </span>
                <span className="flex-1" />
                {step < last ? (
                  <button type="button" onClick={() => close()} className="h-[46px] rounded-full px-3 text-sm font-medium text-gelo-700 hover:text-noite-900">
                    Pular
                  </button>
                ) : null}
                {item?.rota ? (
                  <button
                    type="button"
                    onClick={() => {
                      close(false);
                      router.push(item.rota!);
                    }}
                    className="h-[46px] rounded-full border border-gelo-200 bg-white px-[22px] text-sm font-medium hover:bg-gelo-50 max-md:hidden"
                  >
                    Experimentar agora
                  </button>
                ) : null}
                <button
                  ref={nextRef}
                  type="button"
                  onClick={() => (step < last ? setStep(step + 1) : close())}
                  className="h-[46px] rounded-full bg-noite-900 px-[22px] text-sm font-semibold text-creme-100 hover:bg-noite-700"
                >
                  {step < last ? "Próximo" : "Ir para o painel"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </dialog>

      {toastOpen ? (
        <div
          role="status"
          className="orion-in fixed right-6 bottom-6 z-40 flex w-[min(360px,calc(100%-32px))] items-center gap-3.5 rounded-lg bg-noite-900 px-[18px] py-4 text-creme-100 border border-noite-600 max-sm:right-4 max-sm:bottom-4"
        >
          <OrionMark size={34} color="#7DB7F0" />
          <div className="flex flex-1 flex-col gap-0.5">
            <b className="text-sm">
              {total} {total === 1 ? "novidade" : "novidades"} nesta versão
            </b>
            <small className="text-xs text-ceu-300">Reveja quando quiser</small>
          </div>
          <button ref={reopenRef} type="button" onClick={openDialog} className="h-[38px] rounded-full bg-ceu-400 px-4 text-sm font-semibold text-noite-900">
            Ver
          </button>
          <button type="button" onClick={() => { setToastOpen(false); markSeen(); }} className="rounded-full p-1 text-ceu-300 hover:text-creme-100" aria-label="Fechar aviso">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </>
  );
}
