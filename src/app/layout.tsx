import type { Metadata, Viewport } from "next";
import { Gabarito, Geist_Mono, Inter } from "next/font/google";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const gabarito = Gabarito({ subsets: ["latin"], variable: "--font-gabarito", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "ORION WMS", template: "%s · ORION WMS" },
  description: "Gestão de armazéns integrada ao ERP: recebimento, armazenagem, estoque, inventário, separação e expedição.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F9FC" },
    { media: "(prefers-color-scheme: dark)", color: "#060B2A" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Tema escolhido vem do cookie e é renderizado no servidor: sem piscar na carga.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="pt-BR" className={`${inter.variable} ${gabarito.variable} ${geistMono.variable}`} data-theme={theme === "system" ? undefined : theme} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
