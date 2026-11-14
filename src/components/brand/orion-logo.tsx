import { OrionMark } from "./orion-mark";
import { cn } from "@/components/ui/cn";

/** Logotipo: símbolo + "orion" em minúsculas. */
export function OrionLogo({
  size = 28,
  color = "currentColor",
  className,
  subtitle,
}: {
  size?: number;
  color?: string;
  className?: string;
  subtitle?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-fg", className)}>
      <OrionMark size={size} color={color} title="ORION" />
      <span className="leading-tight">
        <span className="block font-display font-semibold tracking-tight lowercase" style={{ fontSize: size * 0.68 }}>
          orion
        </span>
        {subtitle ? <span className="block text-[11px] text-muted">{subtitle}</span> : null}
      </span>
    </span>
  );
}
