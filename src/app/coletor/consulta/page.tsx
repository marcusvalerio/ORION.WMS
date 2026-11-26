import { Lookup } from "@/components/collector/lookup";

export const metadata = { title: "Consulta rápida" };

export default function CollectorLookup() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-semibold">Consulta rápida</h1>
      <Lookup />
    </div>
  );
}
