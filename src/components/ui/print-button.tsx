"use client";

import { Printer } from "lucide-react";
import { buttonClass } from "./button";

export function PrintButton({ label = "Imprimir" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("primary", "md", "print:hidden")}>
      <Printer className="size-4" aria-hidden />
      {label}
    </button>
  );
}
