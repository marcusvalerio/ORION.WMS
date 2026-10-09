export interface ActionState {
  ok: boolean;
  message: string;
  /** Muda a cada resposta; usado para renovar a chave de idempotência e reiniciar formulários. */
  ts: number;
}

export const INITIAL_ACTION_STATE: ActionState = { ok: false, message: "", ts: 0 };

/**
 * Converte FormData em objeto aninhado. Suporta "items.0.qty" e "items[0].qty".
 * Campos iniciados por "_" (controle interno) são ignorados.
 */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [rawKey, value] of fd.entries()) {
    if (rawKey.startsWith("_") || rawKey.startsWith("$ACTION")) continue;
    if (typeof value !== "string") continue;
    const path = rawKey.replace(/\[(\w+)\]/g, ".$1").split(".");
    let node: Record<string, unknown> | unknown[] = out;
    path.forEach((segment, i) => {
      const last = i === path.length - 1;
      const nextIsIndex = !last && /^\d+$/.test(path[i + 1]);
      const k = /^\d+$/.test(segment) ? Number(segment) : segment;
      const container = node as Record<string | number, unknown>;
      if (last) {
        container[k] = value;
      } else {
        container[k] ??= nextIsIndex ? [] : {};
        node = container[k] as Record<string, unknown> | unknown[];
      }
    });
  }
  // Remove buracos de arrays (linhas removidas no cliente).
  const compact = (v: unknown): unknown =>
    Array.isArray(v) ? v.filter((x) => x !== undefined).map(compact) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compact(x)])) : v;
  return compact(out) as Record<string, unknown>;
}

/** Remove linhas de formulário sem o campo-chave preenchido (ex.: itens opcionais em branco). */
export function dropBlankRows(data: Record<string, unknown>, listKey: string, field: string): void {
  const rows = data[listKey];
  if (Array.isArray(rows)) data[listKey] = rows.filter((r) => r && typeof r === "object" && (r as Record<string, unknown>)[field]);
}
