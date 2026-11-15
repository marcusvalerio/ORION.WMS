import "server-only";
import type { Queryable } from "../db/types";
import type { Ctx } from "../context";
import { assertCan } from "../context";
import { DomainError } from "../errors";
import { audit, runOperation, type OpOptions } from "./common";

/**
 * Parâmetros do WMS por empresa. O valor padrão fica aqui; wms.company_settings
 * guarda apenas o que o administrador alterou. Para criar um parâmetro novo,
 * acrescente uma entrada ao fim de SETTINGS (a tela de Configurações o exibe).
 *
 * Tipos: `boolean` (checkbox: ausente = desligado), `number` (com mínimo/máximo)
 * e `emails` (lista de e-mails). Campos `number`/`emails` ausentes do formulário
 * mantêm o valor atual.
 */
interface BaseDef {
  label: string;
  description: string;
  group: string;
}
export type SettingDef =
  | (BaseDef & { type: "boolean"; default: boolean })
  | (BaseDef & { type: "number"; default: number; min: number; max: number; step?: number; unit?: string })
  | (BaseDef & { type: "emails"; default: string[]; maxItems: number });

export const SETTINGS = {
  "inventory.segregation_of_duties": {
    label: "Segregação de funções no inventário",
    description: "Quem registrou contagem em um inventário não pode aprovar esse mesmo inventário.",
    group: "Inventário",
    type: "boolean",
    default: true,
  },
  "inventory.accuracy_target": {
    label: "Meta de acuracidade do inventário",
    description: "Percentual de itens contados sem diferença esperado por ciclo. Aparece no painel do inventário e na linha de meta do gráfico de ciclos (entre 50 e 100).",
    group: "Inventário",
    type: "number",
    default: 99,
    min: 50,
    max: 100,
    step: 0.1,
    unit: "%",
  },
  "notifications.email_recipients": {
    label: "Destinatários dos avisos por e-mail",
    description:
      "E-mails que recebem os avisos de inventário aprovado, divergência registrada e recebimento agendado (um por linha ou separados por vírgula). Sem destinatário, nenhum aviso é gerado.",
    group: "Avisos por e-mail",
    type: "emails",
    default: [],
    maxItems: 20,
  },
} satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS;
type ValueOf<K extends SettingKey> = (typeof SETTINGS)[K]["default"] extends boolean
  ? boolean
  : (typeof SETTINGS)[K]["default"] extends number
    ? number
    : string[];
export type SettingValue = boolean | number | string[];

const DEFS = SETTINGS as Record<SettingKey, SettingDef>;

/** Normaliza o valor gravado (jsonb) para o tipo do parâmetro; inválido = padrão. */
function coerceStored(def: SettingDef, raw: unknown): SettingValue {
  if (def.type === "boolean") return raw === true;
  if (def.type === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) && n >= def.min && n <= def.max ? n : def.default;
  }
  return Array.isArray(raw) ? raw.filter((e): e is string => typeof e === "string") : def.default;
}

export async function getSetting<K extends SettingKey>(db: Queryable, companyId: string, key: K): Promise<ValueOf<K>> {
  const [row] = await db.query<{ value: unknown }>(`select value from wms.company_settings where company_id = $1 and key = $2`, [
    companyId,
    key,
  ]);
  const def = DEFS[key];
  return (row ? coerceStored(def, row.value) : def.default) as ValueOf<K>;
}

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/**
 * Valida o valor digitado para um parâmetro. Lança DomainError (mensagem para o
 * usuário) quando inválido. Exportada para teste.
 */
export function parseSettingInput(key: SettingKey, raw: unknown): SettingValue {
  const def = DEFS[key];
  if (def.type === "boolean") return raw === true || raw === "on" || raw === "true";
  if (def.type === "number") {
    const text = typeof raw === "number" ? String(raw) : String(raw ?? "").trim().replace(",", ".");
    const n = Number(text);
    if (!text || !Number.isFinite(n)) throw new DomainError(`${def.label}: informe um número.`, "VALIDATION");
    if (n < def.min || n > def.max) throw new DomainError(`${def.label}: use um valor entre ${def.min} e ${def.max}.`, "VALIDATION");
    return Math.round(n * 10) / 10;
  }
  const list = (Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(/[\s,;]+/))
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(list)];
  const bad = unique.find((e) => !EMAIL_RE.test(e) || e.length > 200);
  if (bad) throw new DomainError(`${def.label}: e-mail inválido "${bad}".`, "VALIDATION");
  if (unique.length > def.maxItems) throw new DomainError(`${def.label}: no máximo ${def.maxItems} e-mails.`, "VALIDATION");
  return unique;
}

const same = (a: SettingValue, b: SettingValue) => JSON.stringify(a) === JSON.stringify(b);

export async function listSettings(ctx: Ctx) {
  const rows = await ctx.db.query<{ key: string; value: unknown; updated_at: string; updated_by_name: string | null }>(
    `select s.key, s.value, s.updated_at::text as updated_at, u.name as updated_by_name
     from wms.company_settings s left join wms.users u on u.id = s.updated_by where s.company_id = $1`,
    [ctx.user.companyId],
  );
  const stored = new Map(rows.map((r) => [r.key, r]));
  return (Object.entries(DEFS) as [SettingKey, SettingDef][]).map(([key, def]) => {
    const row = stored.get(key);
    const value = row ? coerceStored(def, row.value) : def.default;
    return {
      key,
      ...def,
      value,
      isDefault: same(value, def.default),
      customized: Boolean(row),
      updatedAt: row?.updated_at ?? null,
      updatedByName: row?.updated_by_name ?? null,
    } as SettingDef & {
      key: SettingKey;
      value: SettingValue;
      isDefault: boolean;
      customized: boolean;
      updatedAt: string | null;
      updatedByName: string | null;
    };
  });
}

/**
 * Atualiza parâmetros (somente administrador). Recebe o formulário inteiro:
 * checkbox ausente = desligado; número/lista ausente = mantém. Só grava e
 * audita o que mudou.
 */
export async function updateSettings(ctx: Ctx, input: Record<string, unknown>, opts?: OpOptions) {
  assertCan(ctx, "settings.manage");
  const unknownKey = Object.keys(input).find((k) => !(k in SETTINGS));
  if (unknownKey) throw new DomainError(`Parâmetro desconhecido: ${unknownKey}.`, "VALIDATION");
  const parsed = new Map<SettingKey, SettingValue>();
  for (const key of Object.keys(DEFS) as SettingKey[]) {
    if (DEFS[key].type !== "boolean" && !(key in input)) continue;
    parsed.set(key, parseSettingInput(key, input[key]));
  }
  return runOperation(ctx, "settings.update", opts, async (tx) => {
    const changed: Record<string, { from: SettingValue; to: SettingValue }> = {};
    for (const [key, next] of parsed) {
      const current = (await getSetting(tx, ctx.user.companyId, key)) as SettingValue;
      if (same(current, next)) continue;
      await tx.query(
        `insert into wms.company_settings (company_id, key, value, updated_by, updated_at) values ($1, $2, $3, $4, now())
         on conflict (company_id, key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
        [ctx.user.companyId, key, JSON.stringify(next), ctx.user.id],
      );
      changed[key] = { from: current, to: next };
    }
    if (Object.keys(changed).length) await audit(tx, ctx, "settings.updated", "company_settings", null, null, changed);
    return { changed: Object.keys(changed).length };
  });
}
