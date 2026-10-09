import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ORION WMS", template: "%s · ORION WMS" },
  description: "Gestão de armazéns integrada ao ERP: recebimento, armazenagem, estoque, inventário, separação e expedição.",
};

export const viewport: Viewport = { themeColor: "#2557eb" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
