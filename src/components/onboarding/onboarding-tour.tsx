"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { Compass } from "lucide-react";
import { emTarefaEmAndamento } from "@/lib/novidades";
import { ONBOARDING_OPEN_EVENT, type OnboardingPasso } from "@/lib/onboarding";
import { concluirOnboardingAction } from "@/server/actions/onboarding";
import { CENAS, N_BARRAS, SIMBOLO, TEXTO_IMERSIVO } from "./cenas";

/** Botão "Como funciona o ORION" (menu do usuário) — reabre o onboarding. */
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

export interface OnboardingTourProps {
  nome: string;
  passos: OnboardingPasso[];
  pendente: boolean;
  /** Versão atual das Novidades: marcada como vista junto com o onboarding (modo demonstração). */
  versaoNovidades?: string;
}

/** Progresso no próprio símbolo: os 14 trechos acendem a cada passo. */
function Progresso({ feitos, total }: { feitos: number; total: number }) {
  const acesos = total ? Math.round((14 * feitos) / total) : 0;
  return (
    <svg width={44} height={44} viewBox="-1 -1 2 2" role="img" aria-label={`Progresso: ${feitos} de ${total}`} className="shrink-0">
      {SIMBOLO.map(([cx, cy, w, h], i) => (
        <rect key={i} x={cx - w / 2} y={cy - h / 2} width={w} height={h} className="onb-glyph" fill={i < acesos ? "#FFF8E7" : "#22306F"} />
      ))}
    </svg>
  );
}

/**
 * Onboarding imersivo: tela escura, as barras do cinturão se reorganizam em cada
 * passo (doca, porta-paletes, fluxo de saída, mapa do inventário…) e se fecham
 * no símbolo. Abre sozinho só no primeiro acesso e nunca em telas de
 * tarefa/contagem em andamento.
 */
export function OnboardingTour({ nome, passos: todos, pendente, versaoNovidades }: OnboardingTourProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(() => pendente && !emTarefaEmAndamento(pathname));
  const passos = todos.filter((p) => p.id !== "ajuda");
  const total = passos.length;
  // -1 = boas-vindas; total = final
  const [step, setStep] = useState(-1);
  const [done, setDone] = useState(!pendente);
  const [, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
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

  const passo = step >= 0 && step < total ? passos[step] : null;
  const imersivo = passo ? TEXTO_IMERSIVO[passo.id] : undefined;
  const cena = step < 0 ? "cinturao" : step >= total ? "final" : (imersivo?.cena ?? "cinturao");

  // Cria as barras uma vez por abertura e move cada uma para a cena do passo.
  useEffect(() => {
    const stage = stageRef.current;
    if (!open || !stage) return;
    if (stage.childElementCount !== N_BARRAS) {
      stage.replaceChildren();
      for (let i = 0; i < N_BARRAS; i++) {
        const el = document.createElement("div");
        el.className = "onb-bar";
        const inner = document.createElement("div");
        inner.className = "onb-bar-in";
        inner.style.setProperty("--d", `${(-(i / N_BARRAS) * 6).toFixed(2)}s`);
        el.appendChild(inner);
        stage.appendChild(el);
      }
    }
    const apply = () => {
      const alvo = CENAS[cena](N_BARRAS);
      const girando = cena === "cinturao";
      stage.classList.toggle("onb-spin", girando);
      const S = stage.getBoundingClientRect().width / 100;
      const estreita = window.innerWidth < 760;
      const k = girando ? 1 : estreita ? 0.9 : 0.55;
      const cx = girando || estreita ? 50 : cena === "final" ? 64 : 48;
      Array.from(stage.children).forEach((node, i) => {
        const el = node as HTMLElement;
        const [x, y, w, h, rot, cor, op] = alvo[i];
        const px = cx + (x - 50) * k;
        const py = 50 + (y - 50) * k;
        el.style.width = `${w * k * S}px`;
        el.style.height = `${h * k * S}px`;
        el.style.transform = `translate(${px * S - (w * k * S) / 2}px, ${py * S - (h * k * S) / 2}px) rotate(${rot}deg)`;
        el.style.backgroundColor = cor;
        el.style.opacity = String(op);
      });
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [open, cena]);

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

  let rotulo: string;
  let palavra: string;
  let linha: string;
  if (step < 0) {
    rotulo = "PRIMEIROS PASSOS";
    palavra = `Olá, ${primeiroNome}.`;
    linha = `Este é o ORION. Em ${total} movimentos você vê como o armazém inteiro anda.`;
  } else if (!passo) {
    rotulo = "PRONTO";
    palavra = "Primeiro turno.";
    linha = "Para rever, toque na bússola “Como funciona o ORION”, no topo.";
  } else {
    rotulo = imersivo?.rotulo ?? passo.titulo.toUpperCase();
    palavra = imersivo?.palavra ?? passo.titulo;
    linha = imersivo?.linha ?? passo.texto;
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-desc"
      onCancel={(e) => {
        e.preventDefault();
        finish(true);
      }}
      onKeyDown={onKeyDown}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0 text-creme-100 backdrop:bg-noite-900"
    >
      {open ? (
        <div className={`onb-scene${cena === "inventario" ? " onb-dim" : ""}`}>
          <div ref={stageRef} className="onb-stage" aria-hidden />

          <section key={step} className="onb-copy" aria-live="polite">
            <p className="onb-rotulo onb-enter">{rotulo}</p>
            <h2 id="onboarding-title" className="onb-palavra onb-enter onb-d1">
              {palavra}
            </h2>
            <p id="onboarding-desc" className="onb-linha onb-enter onb-d2">
              {linha}
            </p>
          </section>

          <div className="onb-base">
            <Progresso feitos={Math.max(0, Math.min(step + 1, total))} total={total} />
            <span className="onb-n">{step >= 0 ? `${Math.min(step + 1, total)} de ${total}` : ""}</span>
            <span className="flex-1" />
            {step < total ? (
              <button type="button" className="onb-pular" onClick={() => finish(true)}>
                Pular
              </button>
            ) : null}
            {step >= 0 ? (
              <button type="button" className="onb-btn onb-ghost" onClick={back}>
                Voltar
              </button>
            ) : null}
            <button
              type="button"
              ref={primaryRef}
              className="onb-btn"
              onClick={step >= total ? () => finish(false) : next}
            >
              {step < 0 ? "Começar" : step >= total ? "Entrar no ORION" : step === total - 1 ? "Concluir" : "Próximo"}
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
