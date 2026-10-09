import type { Permission } from "@/lib/permissions";

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  permission?: Permission;
  /** Prefixos adicionais que mantêm o item ativo. */
  match?: string[];
}

export const NAV: { section: string; items: NavItem[] }[] = [
  { section: "Visão geral", items: [{ label: "Dashboard", href: "/", icon: "LayoutDashboard" }] },
  {
    section: "Armazém",
    items: [
      { label: "Estrutura física", href: "/armazem/estrutura", icon: "Warehouse" },
      { label: "Endereços", href: "/armazem/enderecos", icon: "MapPin" },
      { label: "Produtos", href: "/produtos", icon: "Package" },
      { label: "Estoque", href: "/estoque", icon: "Boxes", match: ["/estoque/saldo", "/estoque/ajuste"] },
      { label: "Movimentações", href: "/estoque/movimentacoes", icon: "ArrowLeftRight" },
    ],
  },
  {
    section: "Entrada",
    items: [
      { label: "Recebimentos", href: "/recebimentos", icon: "PackagePlus" },
      { label: "Conferência", href: "/conferencia", icon: "ClipboardCheck" },
      { label: "Armazenagem", href: "/armazenagem", icon: "PackageCheck" },
      { label: "Divergências", href: "/divergencias", icon: "TriangleAlert" },
    ],
  },
  {
    section: "Operações",
    items: [
      { label: "Tarefas", href: "/tarefas", icon: "ListTodo" },
      { label: "Inventário", href: "/inventario", icon: "ClipboardList" },
      { label: "Separação", href: "/separacao", icon: "ScanLine" },
      { label: "Expedição", href: "/expedicao", icon: "Truck" },
    ],
  },
  {
    section: "Gestão",
    items: [
      { label: "Relatórios", href: "/relatorios", icon: "FileChartColumn" },
      { label: "Indicadores", href: "/indicadores", icon: "Gauge" },
      { label: "Auditoria", href: "/auditoria", icon: "ShieldCheck", permission: "audit.view" },
    ],
  },
];
