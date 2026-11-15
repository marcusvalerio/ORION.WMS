"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { buttonClass } from "@/components/ui/button";
import { toast } from "@/components/forms/toaster";

export function ConfirmDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("danger", "md", "rounded-full")}>
        Cancelar separação…
      </button>
      <ConfirmDialog
        open={open}
        title="Cancelar a separação?"
        destructive
        confirmLabel="Cancelar separação"
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          toast("Exemplo: nada foi cancelado.");
        }}
      >
        Os 6 itens já separados voltam para <span className="font-mono whitespace-nowrap text-fg">ARM-01-04-02</span> numa tarefa de devolução.
      </ConfirmDialog>
    </>
  );
}
