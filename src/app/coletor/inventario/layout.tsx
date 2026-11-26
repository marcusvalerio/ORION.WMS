import { InventoryMode } from "@/components/layout/inventory-mode";

/** Contagem pelo coletor: sempre no "modo inventário". */
export default function CollectorInventoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <InventoryMode className="-mx-1" exitHref="/coletor">
      {children}
    </InventoryMode>
  );
}
