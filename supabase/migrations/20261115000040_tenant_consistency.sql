-- =============================================================================
-- Consistência multiempresa no banco (defesa em profundidade)
-- -----------------------------------------------------------------------------
-- Os serviços já filtram tudo por company_id, mas uma checagem esquecida em um
-- parâmetro opcional (ex.: zona/endereço/produto de OUTRA empresa) gravava uma
-- referência cruzada — a bateria multiempresa (tests/multi-tenant-isolation)
-- encontrou casos assim. Este gatilho impede, no próprio banco, que uma linha de
-- uma empresa aponte (por FK) para registro de outra empresa.
--
-- Para cada tabela erp/wms com company_id, o gatilho recebe os pares
-- (coluna, tabela pai, coluna pai) de todas as FKs de coluna única cujo pai
-- também tem company_id (ou é erp.companies). A verificação só roda quando a
-- coluna (ou o company_id) muda, então UPDATEs comuns de status/quantidade não
-- pagam nada a mais. O erro é P0001 (mensagem exibida ao usuário).
--
-- Tabelas criadas em migrations FUTURAS não são cobertas automaticamente:
-- execute `select wms.install_tenant_guards();` no fim da nova migration.
-- =============================================================================

create or replace function wms.enforce_same_company() returns trigger
language plpgsql as $$
declare
  i int := 0;
  newj jsonb := to_jsonb(new);
  oldj jsonb;
  ref text;
  owner uuid;
begin
  if tg_op = 'UPDATE' then
    oldj := to_jsonb(old);
  end if;
  while i < tg_nargs loop
    ref := newj ->> tg_argv[i];
    if ref is not null and (
      tg_op = 'INSERT'
      or (oldj ->> tg_argv[i]) is distinct from ref
      or (oldj ->> 'company_id') is distinct from (newj ->> 'company_id')
    ) then
      if tg_argv[i + 1] = 'erp.companies' then
        owner := ref::uuid;
      else
        execute format('select company_id from %s where %I = $1', tg_argv[i + 1], tg_argv[i + 2]) into owner using ref::uuid;
      end if;
      if owner is not null and owner is distinct from (newj ->> 'company_id')::uuid then
        raise exception 'Operação recusada: o registro informado pertence a outra empresa (%.%).', tg_table_name, tg_argv[i]
          using errcode = 'P0001';
      end if;
    end if;
    i := i + 3;
  end loop;
  return new;
end
$$;

create or replace function wms.install_tenant_guards() returns integer
language plpgsql as $$
declare
  t record;
  args text;
  n integer := 0;
begin
  for t in
    select c.oid, cn.nspname as schema_name, c.relname as table_name,
           string_agg(format('%L, %L, %L', a.attname, pn.nspname || '.' || p.relname, pa.attname), ', ' order by a.attname) as args
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid join pg_namespace cn on cn.oid = c.relnamespace
    join pg_class p on p.oid = k.confrelid join pg_namespace pn on pn.oid = p.relnamespace
    join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
    join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = k.confkey[1]
    where k.contype = 'f' and array_length(k.conkey, 1) = 1
      and cn.nspname in ('erp', 'wms') and pn.nspname in ('erp', 'wms')
      and a.attname <> 'company_id'
      and exists (select 1 from pg_attribute x where x.attrelid = c.oid and x.attname = 'company_id' and not x.attisdropped)
      and (p.relname = 'companies' and pn.nspname = 'erp'
           or exists (select 1 from pg_attribute x where x.attrelid = p.oid and x.attname = 'company_id' and not x.attisdropped))
    group by c.oid, cn.nspname, c.relname
  loop
    execute format('drop trigger if exists tenant_guard on %I.%I', t.schema_name, t.table_name);
    execute format(
      'create trigger tenant_guard before insert or update on %I.%I for each row execute function wms.enforce_same_company(%s)',
      t.schema_name, t.table_name, t.args);
    n := n + 1;
  end loop;
  return n;
end
$$;

select wms.install_tenant_guards();
