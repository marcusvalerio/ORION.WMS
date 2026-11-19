"use client";

import { useEffect } from "react";

const SELECTOR = ".site-reveal, .site-stagger, .site-grow, .site-fill, .site-glyph, .site-tilt, [data-count]";

/**
 * Movimento da landing em qualquer navegador (inclusive Safari/iPhone): marca cada bloco com
 * data-in quando ele entra na tela; o CSS anima a partir daí. Sem JavaScript, ou com
 * "reduzir movimento", nada fica escondido: a página aparece completa.
 * Números com data-count contam até o valor ao aparecer.
 */
export function SiteMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    root.classList.add("motion-ready");
    const els = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          el.setAttribute("data-in", "");
          if (el.dataset.count) contar(el);
          io.unobserve(el);
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      root.classList.remove("motion-ready");
    };
  }, []);
  return null;
}

function contar(el: HTMLElement) {
  const alvo = Number(el.dataset.count);
  const casas = Number(el.dataset.decimals ?? 0);
  if (!Number.isFinite(alvo)) return;
  const fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const inicio = performance.now();
  const dur = 1400;
  const passo = (t: number) => {
    const p = Math.min(1, (t - inicio) / dur);
    const ease = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt.format(alvo * ease);
    if (p < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}
