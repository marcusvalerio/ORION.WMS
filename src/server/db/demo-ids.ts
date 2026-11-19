import "server-only";
import type { Db } from "./types";

/**
 * Banco de demonstração na Vercel: cada instância do servidor cria o próprio
 * PGlite em /tmp e carrega os dados de demonstração. Com `gen_random_uuid()`
 * cada instância sorteava ids diferentes — a lista vinha de uma instância e o
 * detalhe era pedido a outra, que respondia 404 ("registro não encontrado").
 *
 * Aqui os ids passam a sair de uma sequência fixa (md5 do número da sequência,
 * formatado como uuid). Como a carga de demonstração insere sempre na mesma
 * ordem, todas as instâncias geram os mesmos ids. Só para o banco de
 * demonstração: um banco real (DATABASE_URL) nunca passa por aqui.
 */
export async function applyDeterministicDemoIds(db: Db): Promise<void> {
  await db.query(`create sequence if not exists public.orion_demo_uuid_seq`);
  await db.query(
    `create or replace function public.orion_demo_uuid() returns uuid
       language sql volatile
       as $$
         -- md5 fixo da posição na sequência, com os bits de versão (4) e variante (8)
         -- de um uuid v4: os validadores do app aceitam como qualquer outro id.
         select overlay(overlay(md5('orion-demo:' || nextval('public.orion_demo_uuid_seq'))
                  placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid
       $$`,
  );
  await db.query(`
    do $$
    declare r record;
    begin
      for r in
        select table_schema, table_name, column_name
          from information_schema.columns
         where column_default like 'gen_random_uuid()%'
           and table_schema not in ('pg_catalog', 'information_schema')
      loop
        execute format('alter table %I.%I alter column %I set default public.orion_demo_uuid()',
                       r.table_schema, r.table_name, r.column_name);
      end loop;
    end $$;
  `);
}
