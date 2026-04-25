begin;

-- Documents are a metadata layer for many entity types, so entity_id must be text.
-- This keeps UUID values as their string representation and also supports synthetic keys.

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
      and t.relname = 'documents'
      and c.contype = 'f'
      and exists (
        select 1
        from unnest(c.conkey) as key(attnum)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key.attnum
        where a.attname = 'entity_id'
      )
  loop
    execute format('alter table public.documents drop constraint if exists %I', constraint_name);
  end loop;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'documents'
      and column_name = 'entity_id'
      and data_type <> 'text'
  ) then
    alter table public.documents
      alter column entity_id type text
      using entity_id::text;
  end if;
end $$;

alter table public.documents
  add column if not exists owner_type text,
  add column if not exists owner_id text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'documents'
      and column_name = 'owner_id'
      and data_type <> 'text'
  ) then
    alter table public.documents
      alter column owner_id type text
      using owner_id::text;
  end if;
end $$;

update public.documents
set
  owner_type = coalesce(nullif(owner_type, ''), nullif(entity_type, ''), 'other'),
  owner_id = coalesce(nullif(owner_id, ''), nullif(entity_id, ''))
where owner_type is null
   or owner_type = ''
   or owner_id is null
   or owner_id = '';

notify pgrst, 'reload schema';

commit;
