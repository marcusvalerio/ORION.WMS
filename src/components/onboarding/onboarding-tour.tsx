"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Compass } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { emTarefaEmAndamento } from "@/lib/novidades";
import { ONBOARDING_OPEN_EVENT, type OnboardingPasso } from "@/lib/onboarding";
import { concluirOnboardingAction } from "@/server/actions/onboarding";

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;
const BALLOON_W = 340;

/** Primeiro elemento visível com data-tour=alvo (desktop e celular têm cópias). */
function findTarget(alvo: string | undefined): HTMLElement | null {
  if (!alvo) return null;
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(alvo)}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

function measure(el: HTMLElement): Rect | null {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0 || r.bottom < 0 || r.top > window.innerHeight) return null;
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

/** Botão "Como funciona o ORION" (menu do usuário) — reabre o tour. */
export function OnboardingReopen() {
  return (
    <button
      type="button"
      data-tour="ajuda"
      onClick={() => window.dispatchEvent(new Event(ONBOARDING_OPEN_EVENT))}
      className="rounded-md p-2 text-muted hover:bg-subtle hover:text-fg"
      title="Como funciona o ORION"
      aria-label="Como funciona o ORION"
    >
      <Compass className="size-4" aria-hidden />
    </button>
  );
}

/** Trilha de progresso desenhada como rota de armazém: pontos ligados por linha tracejada. */
function Rota({ total, atual }: { total: number; atual: number }) {
  const gap = total > 1 ? Math.min(22, 150 / (total - 1)) : 0;
  const w = gap * (total - 1) + 16;
  return (
    <svg width={w} height={16} viewBox={`0 0 ${w} 16`} aria-hidden className="shrink-0">
      <line x1={8} y1={8} x2={w - 8} y2={8} stroke="#7E8BA2" strokeWidth={1.5} strokeDasharray="3 3" />
      {Array.from({ length: total }, (_, i) => (
        <circle
          key={i}
          cx={8 + i * gap}
          cy={8}
          r={i === atual ? 6 : 4}
          fill={i === atual ? "#EFCF79" : i < atual ? "#5263AE" : "#F7F9FC"}
          stroke="#060B2A"
          strokeWidth={i === atual ? 1.5 : 1}
        />
      ))}
    </svg>
  );
}

export interface OnboardingTourProps {
  nome: string;
  passos: OnboardingPasso[];
  pendente: boolean;
  /** Versão atual das Novidades: marcada como vista junto com o tour (modo demonstração). */
  versaoNovidades?: string;
}

/**
 * Tour de primeiros passos: escurece a tela, recorta um buraco sobre o elemento
 * real (data-tour) e mostra um balão claro com seta. Abre sozinho só no
 * primeiro acesso e nunca em telas de tarefa/contagem em andamento.
 */
export function OnboardingTour({ nome, passos, pendente, versaoNovidades }: OnboardingTourProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(() => pendente && !emTarefaEmAndamento(pathname));
  // -1 = boas-vindas; passos.length = final
  const [step, setStep] = useState(-1);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vw, setVw] = useState(1280);
  const [vh, setVh] = useState(800);
  const [done, setDone] = useState(!pendente);
  const [, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const total = passos.length;
  const passo = step >= 0 && step < total ? passos[step] : null;
  const primeiroNome = nome.trim().split(/\s+/)[0] ?? nome;

  const finish = useCallback(
    (pulou: boolean) => {
      setOpen(false);
      if (done) return;
      setDone(true);
      startTransition(() => {
        void concluirOnboardingAction(pulou, versaoNovidades);
      });
    },
    [done, versaoNovidades],
  );

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const h = () => {
      setStep(-1);
      setOpen(true);
    };
    window.addEventListener(ONBOARDING_OPEN_EVENT, h);
    return () => window.removeEventListener(ONBOARDING_OPEN_EVENT, h);
  }, []);

  // Mede o alvo do passo atual e acompanha rolagem/redimensionamento.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      setVw(window.innerWidth);
      setVh(window.innerHeight);
      const el = findTarget(passo?.alvo);
      setRect(el ? measure(el) : null);
    };
    const el = findTarget(passo?.alvo);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    update();
    const t = setTimeout(update, 350);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, passo, pathname]);

  useEffect(() => {
    if (open) primaryRef.current?.focus();
  }, [open, step]);

  const next = () => setStep((s) => Math.min(s + 1, total));
  const back = () => setStep((s) => Math.max(s - 1, -1));

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      if (step < total) next();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      back();
    }
  }

  const mobile = vw < 640;
  const target = passo ? rect : null;

  // Posição do balão: à direita de itens do menu lateral, abaixo dos itens do topo.
  let balloonStyle: React.CSSProperties | undefined;
  let arrow: "left" | "up" | null = null;
  let arrowOffset = 24;
  if (target && !mobile) {
    const w = Math.min(BALLOON_W, vw - 32);
    if (target.left + target.width < vw / 2 && target.left + target.width + 16 + w < vw) {
      const top = Math.max(16, Math.min(target.top + target.height / 2 - 40, vh - 260));
      balloonStyle = { top, left: target.left + target.width + 16, width: w };
      arrow = "left";
      arrowOffset = Math.max(14, Math.min(target.top + target.height / 2 - top - 7, 220));
    } else {
      const left = Math.max(16, Math.min(target.left + target.width / 2 - w / 2, vw - w - 16));
      balloonStyle = { top: target.top + target.height + 14, left, width: w };
      arrow = "up";
      arrowOffset = Math.max(14, Math.min(target.left + target.width / 2 - left - 7, w - 28));
    }
  }

  const titleId = "onboarding-title";
  const descId = "onboarding-desc";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(e) => {
        e.preventDefault();
        finish(true);
      }}
      onKeyDown={onKeyDown}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0 text-noite-900 backdrop:bg-transparent"
    >
      {open ? (
        <>
          {/* escurece a tela; com alvo, recorta o buraco iluminado */}
          {target ? (
            <div
              aria-hidden
              className="pointer-events-none fixed rounded-lg ring-2 ring-ceu-400 motion-safe:transition-all motion-safe:duration-300"
              style={{ ...target, boxShadow: "0 0 0 9999px rgba(6, 11, 42, 0.66)" }}
            />
          ) : (
            <div aria-hidden className="fixed inset-0 bg-noite-900/66" />
          )}

          <p className="sr-only" aria-live="polite">
            {step < 0 ? "Boas-vindas" : passo ? `Passo ${step + 1} de ${total}: ${passo.titulo}` : "Fim do tour"}
          </p>

          {step < 0 || step >= total ? (
            <div className="fixed inset-0 grid place-items-center p-4">
              <div className="w-full max-w-md rounded-lg border-2 border-ceu-400 bg-gelo-50 p-6">
                <p className="text-xs font-semibold tracking-wider text-ceu-900 uppercase">Primeiros passos</p>
                {step < 0 ? (
                  <>
                    <h2 id={titleId} className="mt-2 font-display text-2xl font-semibold">
                      Bem-vindo ao ORION, {primeiroNome}
                    </h2>
                    <p id={descId} className="mt-2 text-sm text-gelo-800">
                      Em {total} passos rápidos você vê onde fica cada coisa no armazém. Dá para pular quando quiser.
                    </p>
                  </>
                ) : (
                  <>
                    <h2 id={titleId} className="mt-2 font-display text-2xl font-semibold">
                      Pronto para o primeiro turno
                    </h2>
                    <p id={descId} className="mt-2 text-sm text-gelo-800">
                      Para rever, use “Como funciona o ORION” no topo da tela.
                    </p>
                  </>
                )}
                <div className="mt-5 flex items-center justify-between gap-2">
                  <TourButton variant="ghost" onClick={step < 0 ? () => finish(true) : back}>
                    {step < 0 ? "Pular" : "Voltar"}
                  </TourButton>
                  <TourButton ref={primaryRef} onClick={step < 0 ? next : () => finish(false)}>
                    {step < 0 ? "Começar" : "Concluir"}
                  </TourButton>
                </div>
              </div>
            </div>
          ) : passo ? (
            <div
              className={cn(
                "fixed rounded-md border-2 border-ceu-400 bg-gelo-50 p-4 motion-safe:transition-all motion-safe:duration-300",
                mobile ? "inset-x-3 bottom-3" : !balloonStyle && "top-1/2 left-1/2 w-[min(340px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2",
              )}
              style={mobile ? undefined : balloonStyle}
            >
              {arrow ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute size-3.5 rotate-45 border-ceu-400 bg-gelo-50",
                    arrow === "left" ? "-left-[9px] border-b-2 border-l-2" : "-top-[9px] border-t-2 border-l-2",
                  )}
                  style={arrow === "left" ? { top: arrowOffset } : { left: arrowOffset }}
                />
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold tracking-wider whitespace-nowrap text-ceu-900 uppercase">Primeiros passos</p>
                <span className="flex items-center gap-2 text-[11px] text-gelo-700">
                  <Rota total={total} atual={step} />
                  {step + 1}/{total}
                </span>
              </div>
              <h2 id={titleId} className="mt-2 font-display text-lg font-semibold">
                {passo.titulo}
              </h2>
              <p id={descId} className="mt-1 text-sm text-gelo-800">
                {passo.texto}
              </p>
              {passo.href ? (
                <button
                  type="button"
                  onClick={() => router.push(passo.href!)}
                  className="mt-2 text-sm font-medium text-cobalto-700 underline underline-offset-2 hover:text-noite-900"
                >
                  Ir para a tela
                </button>
              ) : null}
              <div className="mt-4 flex items-center justify-between gap-2">
                <TourButton variant="ghost" onClick={() => finish(true)}>
                  Pular
                </TourButton>
                <span className="flex gap-2">
                  <TourButton variant="outline" onClick={back}>
                    Voltar
                  </TourButton>
                  <TourButton ref={primaryRef} onClick={next}>
                    Próximo
                  </TourButton>
                </span>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}

function TourButton({
  variant = "primary",
  className,
  ref,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "ghost"; ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      type="button"
      ref={ref}
      className={cn(
        "inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-cobalto-600 focus-visible:ring-offset-2 focus-visible:outline-none",
        variant === "primary" && "bg-noite-900 text-gelo-50 hover:bg-noite-700",
        variant === "outline" && "border border-gelo-400 text-noite-900 hover:bg-gelo-100",
        variant === "ghost" && "text-gelo-700 hover:bg-gelo-100 hover:text-noite-900",
        className,
      )}
      {...props}
    />
  );
}
