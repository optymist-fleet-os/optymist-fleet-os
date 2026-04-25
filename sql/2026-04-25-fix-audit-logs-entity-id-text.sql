begin;

-- Audit logs reference many CRM objects, so entity_id must accept UUIDs and text keys.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'audit_logs'
      and c.contype = 'f'
      and exists (
        select 1
        from unnest(c.conkey) as key(attnum)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key.attnum
        where a.attname = 'entity_id'
      )
  loop
    execute format('alter table public.audit_logs drop constraint if exists %I', constraint_name);
  end loop;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'audit_logs'
      and column_name = 'entity_id'
      and data_type <> 'text'
  ) then
    alter table public.audit_logs
      alter column entity_id drop not null,
      alter column entity_id type text
      using entity_id::text;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
