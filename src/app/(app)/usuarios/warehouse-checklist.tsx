import { Checkbox } from "@/components/ui/fields";

/** Caixas de seleção de depósitos; enviadas como warehouseIds.N (lista no servidor). */
export function WarehouseChecklist({
  warehouses,
  selected,
}: {
  warehouses: { id: string; code: string; name: string; active: boolean }[];
  selected: string[];
}) {
  return (
    <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
      {warehouses.map((w, i) => (
        <Checkbox
          key={w.id}
          name={`warehouseIds.${i}`}
          value={w.id}
          defaultChecked={selected.includes(w.id)}
          label={
            <span>
              <span className="font-medium">{w.code}</span> — {w.name}
              {!w.active ? <span className="text-xs text-muted"> (inativo)</span> : null}
            </span>
          }
        />
      ))}
    </div>
  );
}
