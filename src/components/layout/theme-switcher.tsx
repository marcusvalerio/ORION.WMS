"use client";

import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_COOKIE, type ThemePref } from "@/lib/theme";
import { cn } from "@/components/ui/cn";

const OPTIONS: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Claro", Icon: Sun },
  { value: "dark", label: "Escuro", Icon: Moon },
  { value: "system", label: "Sistema", Icon: Monitor },
];

function applyTheme(value: ThemePref) {
  document.cookie = `${THEME_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
  const root = document.documentElement;
  if (value === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", value);
}

/** Seletor de tema (claro/escuro/sistema), salvo em cookie e aplicado sem recarregar. */
export function ThemeSwitcher({ initial }: { initial: ThemePref }) {
  const [pref, setPref] = useState<ThemePref>(initial);
  function choose(value: ThemePref) {
    setPref(value);
    applyTheme(value);
  }
  return (
    <div role="radiogroup" aria-label="Tema" className="inline-flex rounded-md border border-line bg-surface p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          title={`Tema: ${label}`}
          aria-label={`Tema ${label.toLowerCase()}`}
          onClick={() => choose(value)}
          className={cn(
            "rounded p-1.5 transition-colors",
            pref === value ? "bg-action text-on-action" : "text-muted hover:bg-subtle hover:text-fg",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}
