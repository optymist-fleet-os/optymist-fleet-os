begin;

alter table public.documents
  add column if not exists notes text,
  add column if not exists mime_type text,
  add column if not exists drive_folder_id text,
  add column if not exists file_url text,
  add column if not exists folder_url text,
  add column if not exists updated_at timestamptz not null default now();

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
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%document_type%'
  loop
    execute format('alter table public.documents drop constraint if exists %I', constraint_name);
  end loop;
end $$;

alter table public.documents
  add constraint documents_document_type_check
  check (
    document_type is null or document_type in (
      'contract',
      'annex',
      'settlement_pdf',
      'owner_settlement_pdf',
      'platform_report',
      'fuel_report',
      'payout_export',
      'insurance',
      'inspection',
      'passport_scan',
      'driver_license_scan',
      'invoice',
      'protocol',
      'other'
    )
  );

notify pgrst, 'reload schema';

commit;
