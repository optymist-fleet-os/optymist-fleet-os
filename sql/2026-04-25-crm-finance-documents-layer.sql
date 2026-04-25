begin;

alter table public.drivers
  add column if not exists exclude_from_settlements boolean not null default false,
  add column if not exists driver_type text default 'driver';

alter table public.driver_settlements
  add column if not exists commission_rate_snapshot numeric(10,4),
  add column if not exists penalties_total numeric(12,2) not null default 0,
  add column if not exists adjustments_total numeric(12,2) not null default 0,
  add column if not exists carry_forward_balance numeric(12,2) not null default 0,
  add column if not exists calculation_notes text,
  add column if not exists pdf_status text default 'not_generated',
  add column if not exists pdf_url text,
  add column if not exists drive_file_id text,
  add column if not exists drive_folder_id text,
  add column if not exists updated_at timestamptz not null default now();

update public.driver_settlements
set
  commission_rate_snapshot = coalesce(commission_rate_snapshot, 8),
  penalties_total = coalesce(penalties_total, 0),
  adjustments_total = coalesce(adjustments_total, 0),
  carry_forward_balance = coalesce(carry_forward_balance, 0),
  weekly_settlement_fee = coalesce(weekly_settlement_fee, 50),
  pdf_status = coalesce(nullif(pdf_status, ''), 'not_generated'),
  updated_at = coalesce(updated_at, created_at, now());

alter table public.owner_vehicle_settlements
  add column if not exists owner_id uuid,
  add column if not exists owner_payout_base numeric(12,2) not null default 0,
  add column if not exists adjustments_total numeric(12,2) not null default 0,
  add column if not exists payout_to_owner numeric(12,2),
  add column if not exists status text default 'draft',
  add column if not exists notes text,
  add column if not exists pdf_url text,
  add column if not exists drive_file_id text,
  add column if not exists drive_folder_id text,
  add column if not exists folder_url text,
  add column if not exists updated_at timestamptz not null default now();

update public.owner_vehicle_settlements
set
  owner_payout_base = coalesce(owner_payout_base, 0),
  adjustments_total = coalesce(adjustments_total, 0),
  payout_to_owner = coalesce(payout_to_owner, owner_payout_base + adjustments_total, 0),
  status = coalesce(nullif(status, ''), 'draft'),
  updated_at = coalesce(updated_at, created_at, now());

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
    execute 'alter table public.documents alter column entity_id type text using entity_id::text';
  end if;
end $$;

alter table public.documents
  add column if not exists entity_type text default 'other',
  add column if not exists title text,
  add column if not exists status text default 'draft',
  add column if not exists storage_provider text default 'google_drive',
  add column if not exists drive_file_id text,
  add column if not exists drive_folder_id text,
  add column if not exists file_url text,
  add column if not exists folder_url text,
  add column if not exists mime_type text,
  add column if not exists updated_at timestamptz not null default now();

update public.documents
set
  entity_type = coalesce(nullif(entity_type, ''), 'other'),
  status = coalesce(nullif(status, ''), 'draft'),
  storage_provider = coalesce(nullif(storage_provider, ''), 'google_drive'),
  updated_at = coalesce(updated_at, created_at, now());

create index if not exists idx_driver_settlements_period_driver
  on public.driver_settlements (period_id, driver_id);

create index if not exists idx_driver_settlements_status
  on public.driver_settlements (status);

create index if not exists idx_driver_vehicle_assignments_driver_dates
  on public.driver_vehicle_assignments (driver_id, assigned_from, assigned_to);

create index if not exists idx_driver_vehicle_assignments_vehicle_dates
  on public.driver_vehicle_assignments (vehicle_id, assigned_from, assigned_to);

create index if not exists idx_owner_vehicle_settlements_period_vehicle
  on public.owner_vehicle_settlements (period_id, vehicle_id);

create index if not exists idx_documents_entity_lookup
  on public.documents (entity_type, entity_id);

create index if not exists idx_documents_type_status
  on public.documents (document_type, status);

commit;
