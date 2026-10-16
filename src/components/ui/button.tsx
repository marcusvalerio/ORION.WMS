import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white shadow-xs hover:bg-brand-700",
  secondary: "border border-slate-300 bg-white text-slate-700 shadow-xs hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  danger: "bg-red-600 text-white shadow-xs hover:bg-red-700",
  success: "bg-emerald-600 text-white shadow-xs hover:bg-emerald-700",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-9 px-3.5 text-sm",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
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
