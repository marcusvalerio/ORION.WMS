const qtyFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const pctFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const TZ = "America/Sao_Paulo";

export function fmtQty(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return qtyFmt.format(value);
}

export function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${pctFmt.format(value)}%`;
}

function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  if (value.length <= 10) return new Date(`${value}T00:00:00`);
  // Valores vindos do Postgres como texto: "2026-10-09 18:15:00.123456+00" → ISO 8601.
  const iso = value
    .replace(" ", "T")
    .replace(/(\.\d{3})\d+/, "$1")
    .replace(/([+-]\d{2})$/, "$1:00");
  return new Date(iso);
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return toDate(value).toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

export function fmtRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const diff = Date.now() - toDate(value).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}
