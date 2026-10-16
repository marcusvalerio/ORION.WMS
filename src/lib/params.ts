export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Normaliza searchParams (valores únicos, vazios → undefined). */
export async function readParams(searchParams: SearchParams): Promise<Record<string, string | undefined>> {
  const raw = await searchParams;
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    const value = Array.isArray(v) ? v[0] : v;
    out[k] = value && value.trim() ? value.trim() : undefined;
  }
  return out;
}

export function pageNumber(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | undefined): v is string => !!v && UUID.test(v);
