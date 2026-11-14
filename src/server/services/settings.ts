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
 */
export interface SettingDef {
  label: string;
  description: string;
  group: string;
  type: "boolean";
  default: boolean;
}

export const SETTINGS = {
  "inventory.segregation_of_duties": {
    label: "Segregação de funções no inventário",
    description: "Quem registrou contagem em um inventário não pode aprovar esse mesmo inventário.",
    group: "Inventário",
    type: "boolean",
    default: true,
  },
} satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTINGS;

export async function getSetting(db: Queryable, companyId: string, key: SettingKey): Promise<boolean> {
  const [row] = await db.query<{ value: unknown }>(`select value from wms.company_settings where company_id = $1 and key = $2`, [
    companyId,
    key,
  ]);
  return row ? row.value === true : SETTINGS[key].default;
}

export async function listSettings(ctx: Ctx) {
  const rows = await ctx.db.query<{ key: string; value: unknown; updated_at: string; updated_by_name: string | null }>(
    `select s.key, s.value, s.updated_at::text as updated_at, u.name as updated_by_name
     from wms.company_settings s left join wms.users u on u.id = s.updated_by where s.company_id = $1`,
    [ctx.user.companyId],
  );
  const stored = new Map(rows.map((r) => [r.key, r]));
  return (Object.entries(SETTINGS) as [SettingKey, SettingDef][]).map(([key, def]) => {
    const row = stored.get(key);
    return {
      key,
      ...def,
      value: row ? row.value === true : def.default,
      customized: Boolean(row),
      updatedAt: row?.updated_at ?? null,
      updatedByName: row?.updated_by_name ?? null,
    };
  });
}

/**
 * Atualiza parâmetros (somente administrador). Recebe o formulário inteiro:
 * checkbox ausente = desligado. Só grava e audita o que mudou.
 */
export async function updateSettings(ctx: Ctx, input: Record<string, unknown>, opts?: OpOptions) {
  assertCan(ctx, "settings.manage");
  const unknownKey = Object.keys(input).find((k) => !(k in SETTINGS));
  if (unknownKey) throw new DomainError(`Parâmetro desconhecido: ${unknownKey}.`, "VALIDATION");
  return runOperation(ctx, "settings.update", opts, async (tx) => {
    const changed: Record<string, { from: boolean; to: boolean }> = {};
    for (const key of Object.keys(SETTINGS) as SettingKey[]) {
      const raw = input[key];
      const next = raw === true || raw === "on" || raw === "true";
      const current = await getSetting(tx, ctx.user.companyId, key);
      if (current === next) continue;
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
