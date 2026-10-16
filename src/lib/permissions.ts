/**
 * Matriz de permissões do WMS. Usada pelo servidor (autorização efetiva) e pela
 * interface (apenas para ocultar ações indisponíveis — nunca como proteção).
 */
export const ROLES = ["admin", "supervisor", "operator", "auditor"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  supervisor: "Supervisor de armazém",
  operator: "Operador",
  auditor: "Auditor (consulta)",
};

const ALL_OPERATIONAL: Role[] = ["admin", "supervisor", "operator"];
const MANAGERS: Role[] = ["admin", "supervisor"];

export const PERMISSIONS = {
  "warehouse.manage": MANAGERS,
  "products.manage": MANAGERS,
  "receipt.create": ALL_OPERATIONAL,
  "receipt.check": ALL_OPERATIONAL,
  "receipt.release": MANAGERS,
  "quality.release": MANAGERS,
  "divergence.create": ALL_OPERATIONAL,
  "divergence.resolve": MANAGERS,
  "task.execute": ALL_OPERATIONAL,
  "task.manage": MANAGERS,
  "stock.transfer": ALL_OPERATIONAL,
  "stock.adjust": MANAGERS,
  "stock.block": MANAGERS,
  "inventory.create": MANAGERS,
  "inventory.count": ALL_OPERATIONAL,
  "inventory.approve": MANAGERS,
  "outbound.create": MANAGERS,
  "outbound.reserve": MANAGERS,
  "outbound.check": ALL_OPERATIONAL,
  "outbound.ship": ALL_OPERATIONAL,
  "reports.export": ["admin", "supervisor", "auditor"],
  "audit.view": ["admin", "supervisor", "auditor"],
} satisfies Record<string, Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
