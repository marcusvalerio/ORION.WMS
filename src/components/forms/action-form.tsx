"use client";

import { createContext, startTransition, useActionState, useContext, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog, isDestructiveText } from "@/components/ui/confirm-dialog";
import { toast } from "./toaster";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

type ServerAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

const PendingContext = createContext(false);

/**
 * Formulário ligado a uma Server Action, com:
 *  - chave de idempotência (reenvios da mesma submissão não duplicam a operação);
 *  - confirmação opcional para ações críticas;
 *  - botões desabilitados durante o envio;
 *  - campos preservados em caso de erro e reiniciados após sucesso (opcional).
 */
export function ActionForm({
  action,
  children,
  confirm,
  className,
  resetOnSuccess = false,
  id,
  onSuccess,
}: {
  action: ServerAction;
  children: ReactNode;
  confirm?: string;
  className?: string;
  resetOnSuccess?: boolean;
  id?: string;
  /** Chamado no cliente quando a ação termina com sucesso. */
  onSuccess?: () => void;
}) {
  // Sucesso vira notificação global, disparada assim que a resposta chega: a tela costuma
  // mudar de etapa e este formulário pode deixar de existir na nova renderização.
  const [state, formAction, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await action(prev, formData);
    if (result.ok && result.message) toast(result.message, true);
    if (result.ok) onSuccess?.();
    return result;
  }, INITIAL_ACTION_STATE);
  const keyRef = useRef<{ key: string; ts: number } | null>(null);
  const [asking, setAsking] = useState<FormData | null>(null);

  function send(formData: FormData) {
    // Nova chave a cada submissão "nova"; repetir antes da resposta reaproveita a mesma.
    if (!keyRef.current || keyRef.current.ts !== state.ts) keyRef.current = { key: crypto.randomUUID(), ts: state.ts };
    formData.set("_key", keyRef.current.key);
    startTransition(() => formAction(formData));
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const formData = new FormData(event.currentTarget, submitter);
    if (confirm) setAsking(formData);
    else send(formData);
  }
  const destructive = confirm ? isDestructiveText(confirm) : false;

  return (
    <PendingContext.Provider value={pending}>
      <form key={resetOnSuccess && state.ok ? state.ts : undefined} onSubmit={onSubmit} className={className} id={id} noValidate={false}>
        {children}
        {state.message && !state.ok ? <FormMessage state={state} /> : null}
      </form>
      {confirm ? (
        <ConfirmDialog
          open={asking !== null}
          title={confirm}
          destructive={destructive}
          confirmLabel={destructive ? confirm.trim().split(/\s+/)[0] : "Confirmar"}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const fd = asking;
            setAsking(null);
            if (fd) send(fd);
          }}
        />
      ) : null}
    </PendingContext.Provider>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  const Icon = state.ok ? CircleCheck : CircleAlert;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={cn(
        "mt-3 flex items-start gap-1.5 rounded-md px-2.5 py-2 text-sm",
        state.ok ? "bg-ok-bg text-ok-fg" : "bg-crit-bg text-crit-fg",
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{state.message}</span>
    </p>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className,
  name,
  value,
  disabled,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md";
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const pending = useContext(PendingContext);
  return (
    <button type="submit" disabled={pending || disabled} name={name} value={value} className={buttonClass(variant, size, className)}>
      {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
