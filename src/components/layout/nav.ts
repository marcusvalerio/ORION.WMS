import type { Permission } from "@/lib/permissions";

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  permission?: Permission;
  /** Prefixos adicionais que mantêm o item ativo. */
  match?: string[];
  /** Subtítulo curto exibido ao lado do rótulo (ex.: "Importação e exportação"). */
  hint?: string;
}

export const NAV: { section: string; items: NavItem[] }[] = [
  { section: "Visão geral", items: [{ label: "Dashboard", href: "/painel", icon: "LayoutDashboard" }] },
  {
    section: "Armazém",
    items: [
      { label: "Estrutura física", href: "/armazem/estrutura", icon: "Warehouse" },
      { label: "Endereços", href: "/armazem/enderecos", icon: "MapPin" },
      { label: "Rastreabilidade", href: "/armazem/rastreabilidade", icon: "Activity", permission: "reports.view" },
      { label: "Produtos", href: "/produtos", icon: "Package" },
      { label: "Estoque", href: "/estoque", icon: "Boxes", match: ["/estoque/saldo", "/estoque/ajuste"] },
      { label: "Movimentações", href: "/estoque/movimentacoes", icon: "ArrowLeftRight" },
      { label: "Comex", href: "/comex", icon: "Ship", hint: "Importação e exportação" },
    ],
  },
  {
    section: "Entrada",
    items: [
      { label: "Recebimentos", href: "/recebimentos", icon: "PackagePlus" },
      { label: "Conferência", href: "/conferencia", icon: "ClipboardCheck" },
      { label: "Armazenagem", href: "/armazenagem", icon: "PackageCheck" },
      { label: "Divergências", href: "/divergencias", icon: "TriangleAlert" },
      { label: "Qualidade", href: "/qualidade", icon: "ShieldCheck", permission: "quality.release" },
      { label: "Agenda de docas", href: "/docas", icon: "CalendarClock" },
      { label: "Devoluções", href: "/devolucoes", icon: "Undo2" },
    ],
  },
  {
    section: "Operações",
    items: [
      { label: "Tarefas", href: "/tarefas", icon: "ListTodo" },
      { label: "Inventário", href: "/inventario", icon: "ClipboardList" },
      { label: "Separação", href: "/separacao", icon: "ScanLine" },
      { label: "Expedição", href: "/expedicao", icon: "Truck" },
      { label: "Ondas", href: "/ondas", icon: "Waves" },
      { label: "Reposição", href: "/reposicao", icon: "RefreshCw" },
      { label: "Produção", href: "/producao", icon: "Factory" },
    ],
  },
  {
    section: "Gestão",
    items: [
      { label: "Relatórios", href: "/relatorios", icon: "FileChartColumn" },
      { label: "Indicadores", href: "/indicadores", icon: "Gauge" },
      { label: "Auditoria", href: "/auditoria", icon: "ShieldCheck", permission: "audit.view" },
      { label: "Usuários", href: "/usuarios", icon: "Users", permission: "users.manage" },
      { label: "Produtividade", href: "/produtividade", icon: "Activity", permission: "productivity.view" },
      { label: "Configurações", href: "/configuracoes", icon: "Settings", permission: "settings.manage" },
      { label: "Integração", href: "/integracao", icon: "RefreshCw", permission: "audit.view" },
      { label: "Dados da empresa", href: "/empresa", icon: "Building2", permission: "company.manage" },
      { label: "Saúde", href: "/saude", icon: "HeartPulse", permission: "system.health" },
      { label: "Curva ABC", href: "/curva-abc", icon: "ChartColumnBig" },
    ],
  },
];
