"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { buttonClass } from "./button";
import { cn } from "./cn";

/** Ações que desfazem trabalho: o botão de confirmação fica vermelho. */
export function isDestructiveText(text: string): boolean {
  return /^(cancelar|descartar|inativar|remover|excluir|estornar|recusar)\b/i.test(text.trim());
}

/**
 * Diálogo de confirmação acessível (elemento <dialog> modal: foco preso,
 * Esc fecha, clique fora fecha). O foco inicial vai para "Manter", a opção segura.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Confirmar",
  cancelLabel = "Manter",
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      cancelRef.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      className="m-auto w-[min(380px,calc(100%-32px))] rounded-lg border border-line bg-surface p-0 text-fg backdrop:bg-noite-900/55"
    >
      <div className="flex flex-col gap-3 p-6">
        <h2 id="confirm-title" className="font-display text-xl font-semibold">
          {title}
        </h2>
        {children ? <div className="text-sm text-fg-2">{children}</div> : null}
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} className={buttonClass("secondary", "md", "rounded-full")}>
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={cn(buttonClass(destructive ? "danger" : "primary", "md", "rounded-full"))}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
