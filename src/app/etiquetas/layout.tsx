import { requireCtx } from "@/server/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Etiquetas", template: "%s · Etiquetas ORION" } };

/**
 * Telas de impressão de etiquetas: sem menu, com CSS de impressão (cada etiqueta
 * tem tamanho físico em mm e não é quebrada entre páginas).
 */
export default async function LabelsLayout({ children }: { children: React.ReactNode }) {
  await requireCtx();
  return (
    <div data-theme="light" className="min-h-dvh bg-subtle pb-8 print:bg-surface print:pb-0">
      <style>{`
        .label-sheet { display: flex; flex-wrap: wrap; gap: 4mm; justify-content: center; }
        .label { background: #fff; color: #000; border: 0.3mm dashed #94a3b8; box-sizing: border-box; overflow: hidden;
                 break-inside: avoid; page-break-inside: avoid; }
        @media print {
          @page { margin: 6mm; }
          .no-print { display: none !important; }
          .label { border-color: #cbd5e1; }
          .label-break { break-after: page; page-break-after: always; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      {children}
    </div>
  );
}
