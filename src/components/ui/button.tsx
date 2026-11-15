import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const variants: Record<Variant, string> = {
  primary: "bg-action text-on-action shadow-xs hover:bg-action-hover",
  secondary: "border border-line-strong bg-surface text-fg-2 shadow-xs hover:bg-canvas",
  ghost: "text-fg-2 hover:bg-subtle hover:text-fg",
  danger: "bg-crit-solid text-on-solid shadow-xs hover:brightness-110",
  success: "bg-ok-solid text-on-solid shadow-xs hover:brightness-110",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-9 px-3.5 text-sm",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  // Um arredondamento passado em className substitui o padrão (sem tailwind-merge).
  const b = className && /(^|\s)rounded-/.test(className) ? base.replace("rounded-md ", "") : base;
  return cn(b, variants[variant], sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { href: string; variant?: Variant; size?: Size; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}
