begin;

create extension if not exists pgcrypto;

create or replace function public.has_app_role(required_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = auth.uid()
      and lower(role) in (
        select lower(role_name)
        from unnest(required_roles) as roles(role_name)
      )
  );
$$;

create or replace function public.is_backoffice_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_app_role(array[
    'admin',
    'operator',
    'partner_admin',
    'accountant',
    'operations',
    'driver_support',
    'auditor'
  ]);
$$;

create or replace function public.can_manage_finance()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_app_role(array[
    'admin',
    'operator',
    'partner_admin',
    'accountant'
  ]);
$$;

create or replace function public.can_approve_payouts()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_app_role(array[
    'admin',
    'partner_admin'
  ]);
$$;

grant execute on function public.has_app_role(text[]) to authenticated;
grant execute on function public.is_backoffice_user() to authenticated;
grant execute on function public.can_manage_finance() to authenticated;
grant execute on function public.can_approve_payouts() to authenticated;

alter table public.drivers
  add column if not exists tax_zus_profile text,
  add column if not exists cooperation_type text,
  add column if not exists bank_account_iban text,
  add column if not exists lifecycle_status text,
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update public.drivers
set lifecycle_status = coalesce(nullif(lifecycle_status, ''), nullif(status, ''), 'lead')
where lifecycle_status is null or lifecycle_status = '';

alter table public.vehicles
  add column if not exists taxi_license_number text,
  add column if not exists taxi_license_expiry date,
  add column if not exists registration_document_number text,
  add column if not exists platform_status text default 'not_connected',
  add column if not exists operational_status text default 'available',
  add column if not exists updated_at timestamptz not null default now();

alter table public.documents
  add column if not exists owner_type text,
  add column if not exists owner_id text,
  add column if not exists issue_date date,
  add column if not exists expiry_date date,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists rejection_reason text;

update public.documents
set
  owner_type = coalesce(nullif(owner_type, ''), nullif(entity_type, ''), 'other'),
  owner_id = coalesce(nullif(owner_id, ''), nullif(entity_id, ''))
where owner_type is null
   or owner_type = ''
   or owner_id is null
   or owner_id = '';

alter table public.platform_accounts
  add column if not exists driver_id uuid references public.drivers(id) on delete cascade,
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null,
  add column if not exists platform text,
  add column if not exists external_driver_id text,
  add column if not exists status text default 'draft',
  add column if not exists activation_date date,
  add column if not exists suspended_at timestamptz,
  add column if not exists last_import_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references public.drivers(id) on delete cascade,
  contract_type text not null default 'cooperation',
  cooperation_model text,
  start_date date,
  end_date date,
  status text not null default 'draft',
  commission_scheme jsonb not null default '{}'::jsonb,
  payout_rules jsonb not null default '{}'::jsonb,
  signed_document_id uuid references public.documents(id) on delete set null,
  e_sign_status text default 'not_started',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.raw_import_batches (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  period_id uuid references public.settlement_periods(id) on delete set null,
  source_type text not null default 'csv',
  source_file_document_id uuid references public.documents(id) on delete set null,
  file_name text,
  file_hash text,
  status text not null default 'uploaded',
  imported_by uuid references auth.users(id),
  imported_at timestamptz not null default now(),
  row_count integer not null default 0,
  duplicate_count integer not null default 0,
  failed_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.raw_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.raw_import_batches(id) on delete cascade,
  row_number integer not null,
  raw_data jsonb not null default '{}'::jsonb,
  row_hash text,
  status text not null default 'raw',
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.normalized_platform_transactions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.raw_import_batches(id) on delete set null,
  raw_row_id uuid references public.raw_import_rows(id) on delete set null,
  platform text not null,
  external_transaction_id text,
  transaction_type text not null default 'trip_earning',
  occurred_at timestamptz,
  driver_id uuid references public.drivers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  platform_account_id uuid references public.platform_accounts(id) on delete set null,
  gross_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  cash_collected numeric(12,2) not null default 0,
  currency text not null default 'PLN',
  status text not null default 'normalized',
  duplicate_of uuid references public.normalized_platform_transactions(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_normalized_platform_transactions_external
  on public.normalized_platform_transactions (platform, external_transaction_id)
  where external_transaction_id is not null;

create table if not exists public.reconciliation_issues (
  id uuid primary key default gen_random_uuid(),
  severity text not null default 'medium',
  status text not null default 'open',
  issue_type text not null,
  assigned_user_id uuid references auth.users(id),
  source_import_batch_id uuid references public.raw_import_batches(id) on delete set null,
  related_driver_id uuid references public.drivers(id) on delete set null,
  related_vehicle_id uuid references public.vehicles(id) on delete set null,
  related_transaction_id uuid references public.normalized_platform_transactions(id) on delete set null,
  resolution_note text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references public.drivers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  platform text,
  period_id uuid references public.settlement_periods(id) on delete set null,
  source_type text,
  source_id text,
  entry_type text not null,
  amount numeric(12,2) not null,
  currency text not null default 'PLN',
  direction text not null,
  tax_vat_code text,
  description text,
  status text not null default 'draft',
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  posted_by uuid references auth.users(id),
  posted_at timestamptz,
  reversed_entry_id uuid references public.ledger_entries(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ledger_entries
  add column if not exists driver_id uuid references public.drivers(id) on delete set null,
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null,
  add column if not exists platform text,
  add column if not exists period_id uuid references public.settlement_periods(id) on delete set null,
  add column if not exists source_type text,
  add column if not exists source_id text,
  add column if not exists entry_type text,
  add column if not exists amount numeric(12,2),
  add column if not exists currency text not null default 'PLN',
  add column if not exists direction text,
  add column if not exists tax_vat_code text,
  add column if not exists description text,
  add column if not exists status text not null default 'draft',
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists posted_by uuid references auth.users(id),
  add column if not exists posted_at timestamptz,
  add column if not exists reversed_entry_id uuid references public.ledger_entries(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.settlement_periods
  add column if not exists status text not null default 'open',
  add column if not exists closed_at timestamptz,
  add column if not exists locked_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id),
  add column if not exists locked_by uuid references auth.users(id),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.payout_batches (
  id uuid primary key default gen_random_uuid(),
  period_id uuid references public.settlement_periods(id) on delete set null,
  status text not null default 'draft',
  currency text not null default 'PLN',
  total_amount numeric(12,2) not null default 0,
  item_count integer not null default 0,
  created_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  exported_by uuid references auth.users(id),
  paid_by uuid references auth.users(id),
  approved_at timestamptz,
  exported_at timestamptz,
  paid_at timestamptz,
  bank_export_document_id uuid references public.documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payout_batch_items (
  id uuid primary key default gen_random_uuid(),
  payout_batch_id uuid not null references public.payout_batches(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete set null,
  period_id uuid references public.settlement_periods(id) on delete set null,
  driver_settlement_id uuid references public.driver_settlements(id) on delete set null,
  amount numeric(12,2) not null default 0,
  currency text not null default 'PLN',
  bank_account text,
  status text not null default 'draft',
  failure_reason text,
  paid_at timestamptz,
  bank_reference text,
  related_ledger_entry_id uuid references public.ledger_entries(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.driver_statements (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  period_id uuid not null references public.settlement_periods(id) on delete cascade,
  status text not null default 'draft',
  statement_data jsonb not null default '{}'::jsonb,
  document_id uuid references public.documents(id) on delete set null,
  generated_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, period_id)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references public.drivers(id) on delete set null,
  period_id uuid references public.settlement_periods(id) on delete set null,
  payout_batch_item_id uuid references public.payout_batch_items(id) on delete set null,
  invoice_number text,
  issue_date date,
  sale_date date,
  net_amount numeric(12,2) not null default 0,
  vat_amount numeric(12,2) not null default 0,
  gross_amount numeric(12,2) not null default 0,
  currency text not null default 'PLN',
  status text not null default 'draft',
  ksef_status text default 'not_sent',
  ksef_reference_number text,
  upo_document_id uuid references public.documents(id) on delete set null,
  accounting_export_status text default 'not_exported',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoice_ledger_entries (
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  ledger_entry_id uuid not null references public.ledger_entries(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (invoice_id, ledger_entry_id)
);

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_type text not null default 'other',
  status text not null default 'open',
  priority text not null default 'normal',
  title text not null,
  description text,
  driver_id uuid references public.drivers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  assigned_user_id uuid references auth.users(id),
  created_by uuid references auth.users(id),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_ticket_links (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs
  add column if not exists actor_user_id uuid references auth.users(id),
  add column if not exists action text,
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists before_data jsonb,
  add column if not exists after_data jsonb,
  add column if not exists ip_address inet,
  add column if not exists user_agent text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

alter table public.driver_settlements drop constraint if exists driver_settlements_status_check;
update public.driver_settlements
set status = case lower(coalesce(status, ''))
  when 'draft' then 'draft'
  when 'pending' then 'draft'
  when 'imported' then 'calculated'
  when 'generated' then 'calculated'
  when 'ready' then 'calculated'
  when 'calculated' then 'calculated'
  when 'approved' then 'approved'
  when 'sent' then 'sent'
  when 'paid' then 'paid'
  when 'disputed' then 'disputed'
  when 'cancelled' then 'cancelled'
  else 'draft'
end;
alter table public.driver_settlements
  add constraint driver_settlements_status_check
  check (status in ('draft', 'calculated', 'approved', 'sent', 'paid', 'disputed', 'cancelled'));

alter table public.settlement_periods drop constraint if exists settlement_periods_status_check;
update public.settlement_periods
set status = case lower(coalesce(status, ''))
  when 'open' then 'open'
  when 'draft' then 'open'
  when 'active' then 'open'
  when 'current' then 'open'
  when 'pending' then 'open'
  when 'new' then 'open'
  when 'imported' then 'open'
  when 'calculating' then 'calculating'
  when 'calculation' then 'calculating'
  when 'processing' then 'calculating'
  when 'in_progress' then 'calculating'
  when 'review' then 'reviewed'
  when 'reviewed' then 'reviewed'
  when 'ready' then 'approved'
  when 'approved' then 'approved'
  when 'completed' then 'closed'
  when 'paid' then 'closed'
  when 'sent' then 'closed'
  when 'closed' then 'closed'
  when 'locked' then 'locked'
  else 'open'
end;
alter table public.settlement_periods
  add constraint settlement_periods_status_check
  check (status in ('open', 'calculating', 'reviewed', 'approved', 'closed', 'locked'));

alter table public.ledger_entries drop constraint if exists ledger_entries_status_check;
alter table public.ledger_entries
  add constraint ledger_entries_status_check
  check (status in ('draft', 'posted', 'reversed', 'locked', 'imported', 'pending'));

alter table public.ledger_entries drop constraint if exists ledger_entries_direction_check;
alter table public.ledger_entries
  add constraint ledger_entries_direction_check
  check (direction in ('credit', 'debit'));

alter table public.ledger_entries drop constraint if exists ledger_entries_type_check;
alter table public.ledger_entries
  add constraint ledger_entries_type_check
  check (entry_type in (
    'trip_earning',
    'bonus',
    'tip',
    'cash_collected',
    'platform_fee',
    'partner_commission',
    'vehicle_rent',
    'fuel',
    'penalty',
    'refund',
    'cost_invoice',
    'tax',
    'zus',
    'adjustment',
    'payout',
    'payout_reversal',
    'invoice',
    'correction'
  ));

alter table public.payout_batches drop constraint if exists payout_batches_status_check;
alter table public.payout_batches
  add constraint payout_batches_status_check
  check (status in ('draft', 'pending_review', 'approved', 'exported', 'paid', 'failed', 'cancelled'));

alter table public.payout_batch_items drop constraint if exists payout_batch_items_status_check;
alter table public.payout_batch_items
  add constraint payout_batch_items_status_check
  check (status in ('draft', 'pending_review', 'approved', 'exported', 'paid', 'failed', 'cancelled'));

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check
  check (status in ('draft', 'issued', 'sent_to_ksef', 'accepted_by_ksef', 'rejected_by_ksef', 'exported_to_accounting', 'cancelled'));

alter table public.documents drop constraint if exists documents_status_check;
update public.documents
set status = case lower(coalesce(status, ''))
  when 'draft' then 'draft'
  when 'missing' then 'missing'
  when 'uploaded' then 'uploaded'
  when 'pending' then 'pending_review'
  when 'pending_review' then 'pending_review'
  when 'approved' then 'approved'
  when 'rejected' then 'rejected'
  when 'expired' then 'expired'
  when 'ready' then 'ready'
  when 'sent' then 'sent'
  when 'signed' then 'signed'
  when 'generated' then 'generated'
  when 'archived' then 'archived'
  when 'imported' then 'archived'
  else 'draft'
end;
alter table public.documents
  add constraint documents_status_check
  check (status in (
    'draft',
    'missing',
    'uploaded',
    'pending_review',
    'approved',
    'rejected',
    'expired',
    'ready',
    'sent',
    'signed',
    'generated',
    'archived'
  ));

create index if not exists idx_platform_accounts_driver_platform
  on public.platform_accounts (driver_id, platform);
create index if not exists idx_raw_import_batches_period_platform
  on public.raw_import_batches (period_id, platform, status);
create index if not exists idx_raw_import_rows_batch_status
  on public.raw_import_rows (batch_id, status);
create index if not exists idx_reconciliation_issues_status
  on public.reconciliation_issues (status, severity);
create index if not exists idx_ledger_entries_driver_period
  on public.ledger_entries (driver_id, period_id, status);
create index if not exists idx_ledger_entries_source
  on public.ledger_entries (source_type, source_id);
create index if not exists idx_payout_batches_period_status
  on public.payout_batches (period_id, status);
create index if not exists idx_payout_items_batch_driver
  on public.payout_batch_items (payout_batch_id, driver_id);
create index if not exists idx_invoices_driver_period
  on public.invoices (driver_id, period_id, status);
create index if not exists idx_support_tickets_driver_status
  on public.support_tickets (driver_id, status);
create index if not exists idx_audit_logs_entity
  on public.audit_logs (entity_type, entity_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.prevent_locked_ledger_mutation()
returns trigger
language plpgsql
as $$
declare
  related_period_status text;
begin
  if tg_op = 'DELETE' then
    if old.status in ('posted', 'reversed', 'locked') then
      raise exception 'Posted, reversed or locked ledger entries are immutable. Use correction/reversal entries.';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.status in ('posted', 'reversed', 'locked') then
    raise exception 'Posted, reversed or locked ledger entries are immutable. Use correction/reversal entries.';
  end if;

  if new.period_id is not null then
    select status
      into related_period_status
      from public.settlement_periods
      where id = new.period_id;

    if related_period_status in ('closed', 'locked')
       and coalesce(new.entry_type, '') not in ('correction', 'payout_reversal') then
      raise exception 'Settlement period is closed or locked. Only correction/reversal ledger entries are allowed.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_locked_period_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'locked' then
    raise exception 'Locked settlement periods cannot be edited.';
  end if;

  return new;
end;
$$;

create or replace function public.audit_log_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_data jsonb;
  new_data jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    old_data = to_jsonb(old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    new_data = to_jsonb(new);
  end if;

  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    metadata
  ) values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(new_data->>'id', old_data->>'id'),
    old_data,
    new_data,
    jsonb_build_object('schema', tg_table_schema)
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.post_ledger_entry(entry_id uuid)
returns public.ledger_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  posted_entry public.ledger_entries;
begin
  if not public.can_manage_finance() then
    raise exception 'Not allowed to post ledger entries.';
  end if;

  update public.ledger_entries
    set
      status = 'posted',
      posted_by = auth.uid(),
      posted_at = now(),
      updated_at = now()
    where id = entry_id
      and status = 'draft'
    returning * into posted_entry;

  if posted_entry.id is null then
    raise exception 'Only draft ledger entries can be posted.';
  end if;

  return posted_entry;
end;
$$;

create or replace function public.create_payout_batch_from_period(target_period_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_batch_id uuid;
begin
  if not public.can_manage_finance() then
    raise exception 'Not allowed to create payout batches.';
  end if;

  insert into public.payout_batches (
    period_id,
    status,
    currency,
    total_amount,
    item_count,
    created_by
  )
  select
    target_period_id,
    'draft',
    'PLN',
    coalesce(sum(greatest(payout_to_driver, 0)), 0),
    count(*),
    auth.uid()
  from public.driver_settlements
  where period_id = target_period_id
    and status in ('calculated', 'approved', 'sent', 'paid')
    and payout_to_driver > 0
  returning id into new_batch_id;

  insert into public.payout_batch_items (
    payout_batch_id,
    driver_id,
    period_id,
    driver_settlement_id,
    amount,
    currency,
    bank_account,
    status
  )
  select
    new_batch_id,
    ds.driver_id,
    ds.period_id,
    ds.id,
    ds.payout_to_driver,
    'PLN',
    d.bank_account_iban,
    'draft'
  from public.driver_settlements ds
  left join public.drivers d on d.id = ds.driver_id
  where ds.period_id = target_period_id
    and ds.status in ('calculated', 'approved', 'sent', 'paid')
    and ds.payout_to_driver > 0;

  return new_batch_id;
end;
$$;

grant execute on function public.post_ledger_entry(uuid) to authenticated;
grant execute on function public.create_payout_batch_from_period(uuid) to authenticated;

drop trigger if exists trg_ledger_entries_immutable on public.ledger_entries;
create trigger trg_ledger_entries_immutable
  before insert or update or delete on public.ledger_entries
  for each row execute function public.prevent_locked_ledger_mutation();

drop trigger if exists trg_settlement_periods_locked on public.settlement_periods;
create trigger trg_settlement_periods_locked
  before update on public.settlement_periods
  for each row execute function public.prevent_locked_period_mutation();

drop trigger if exists trg_drivers_updated_at on public.drivers;
create trigger trg_drivers_updated_at before update on public.drivers
  for each row execute function public.set_updated_at();
drop trigger if exists trg_vehicles_updated_at on public.vehicles;
create trigger trg_vehicles_updated_at before update on public.vehicles
  for each row execute function public.set_updated_at();
drop trigger if exists trg_platform_accounts_updated_at on public.platform_accounts;
create trigger trg_platform_accounts_updated_at before update on public.platform_accounts
  for each row execute function public.set_updated_at();
drop trigger if exists trg_contracts_updated_at on public.contracts;
create trigger trg_contracts_updated_at before update on public.contracts
  for each row execute function public.set_updated_at();
drop trigger if exists trg_raw_import_batches_updated_at on public.raw_import_batches;
create trigger trg_raw_import_batches_updated_at before update on public.raw_import_batches
  for each row execute function public.set_updated_at();
drop trigger if exists trg_normalized_transactions_updated_at on public.normalized_platform_transactions;
create trigger trg_normalized_transactions_updated_at before update on public.normalized_platform_transactions
  for each row execute function public.set_updated_at();
drop trigger if exists trg_reconciliation_issues_updated_at on public.reconciliation_issues;
create trigger trg_reconciliation_issues_updated_at before update on public.reconciliation_issues
  for each row execute function public.set_updated_at();
drop trigger if exists trg_ledger_entries_updated_at on public.ledger_entries;
create trigger trg_ledger_entries_updated_at before update on public.ledger_entries
  for each row execute function public.set_updated_at();
drop trigger if exists trg_settlement_periods_updated_at on public.settlement_periods;
create trigger trg_settlement_periods_updated_at before update on public.settlement_periods
  for each row execute function public.set_updated_at();
drop trigger if exists trg_payout_batches_updated_at on public.payout_batches;
create trigger trg_payout_batches_updated_at before update on public.payout_batches
  for each row execute function public.set_updated_at();
drop trigger if exists trg_payout_items_updated_at on public.payout_batch_items;
create trigger trg_payout_items_updated_at before update on public.payout_batch_items
  for each row execute function public.set_updated_at();
drop trigger if exists trg_driver_statements_updated_at on public.driver_statements;
create trigger trg_driver_statements_updated_at before update on public.driver_statements
  for each row execute function public.set_updated_at();
drop trigger if exists trg_invoices_updated_at on public.invoices;
create trigger trg_invoices_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();
drop trigger if exists trg_support_tickets_updated_at on public.support_tickets;
create trigger trg_support_tickets_updated_at before update on public.support_tickets
  for each row execute function public.set_updated_at();

drop trigger if exists trg_audit_driver_settlements on public.driver_settlements;
create trigger trg_audit_driver_settlements
  after insert or update or delete on public.driver_settlements
  for each row execute function public.audit_log_row_change();
drop trigger if exists trg_audit_ledger_entries on public.ledger_entries;
create trigger trg_audit_ledger_entries
  after insert or update or delete on public.ledger_entries
  for each row execute function public.audit_log_row_change();
drop trigger if exists trg_audit_settlement_periods on public.settlement_periods;
create trigger trg_audit_settlement_periods
  after insert or update or delete on public.settlement_periods
  for each row execute function public.audit_log_row_change();
drop trigger if exists trg_audit_payout_batches on public.payout_batches;
create trigger trg_audit_payout_batches
  after insert or update or delete on public.payout_batches
  for each row execute function public.audit_log_row_change();
drop trigger if exists trg_audit_payout_items on public.payout_batch_items;
create trigger trg_audit_payout_items
  after insert or update or delete on public.payout_batch_items
  for each row execute function public.audit_log_row_change();
drop trigger if exists trg_audit_documents on public.documents;
create trigger trg_audit_documents
  after insert or update or delete on public.documents
  for each row execute function public.audit_log_row_change();
drop trigger if exists trg_audit_contracts on public.contracts;
create trigger trg_audit_contracts
  after insert or update or delete on public.contracts
  for each row execute function public.audit_log_row_change();
drop trigger if exists trg_audit_reconciliation_issues on public.reconciliation_issues;
create trigger trg_audit_reconciliation_issues
  after insert or update or delete on public.reconciliation_issues
  for each row execute function public.audit_log_row_change();
drop trigger if exists trg_audit_invoices on public.invoices;
create trigger trg_audit_invoices
  after insert or update or delete on public.invoices
  for each row execute function public.audit_log_row_change();
drop trigger if exists trg_audit_support_tickets on public.support_tickets;
create trigger trg_audit_support_tickets
  after insert or update or delete on public.support_tickets
  for each row execute function public.audit_log_row_change();

create or replace view public.v_driver_statement_period_summary as
select
  driver_id,
  period_id,
  currency,
  sum(case when direction = 'credit' then amount else -amount end) as balance_delta,
  sum(case when entry_type in ('trip_earning', 'bonus', 'tip') and direction = 'credit' then amount else 0 end) as income_total,
  sum(case when entry_type in ('cash_collected', 'platform_fee', 'partner_commission', 'vehicle_rent', 'fuel', 'penalty', 'cost_invoice', 'tax', 'zus') then amount else 0 end) as deductions_total,
  sum(case when entry_type = 'payout' then amount else 0 end) as payout_total,
  count(*) as ledger_entry_count
from public.ledger_entries
where status in ('posted', 'locked')
group by driver_id, period_id, currency;

alter table public.driver_settlements enable row level security;
drop policy if exists driver_settlements_select_backoffice on public.driver_settlements;
drop policy if exists driver_settlements_insert_finance on public.driver_settlements;
drop policy if exists driver_settlements_update_finance on public.driver_settlements;
drop policy if exists driver_settlements_delete_finance_admin on public.driver_settlements;
create policy driver_settlements_select_backoffice
  on public.driver_settlements for select to authenticated
  using (public.is_backoffice_user());
create policy driver_settlements_insert_finance
  on public.driver_settlements for insert to authenticated
  with check (public.can_manage_finance());
create policy driver_settlements_update_finance
  on public.driver_settlements for update to authenticated
  using (public.can_manage_finance())
  with check (public.can_manage_finance());
create policy driver_settlements_delete_finance_admin
  on public.driver_settlements for delete to authenticated
  using (public.can_approve_payouts());

alter table public.owner_vehicle_settlements enable row level security;
drop policy if exists owner_vehicle_settlements_select_backoffice on public.owner_vehicle_settlements;
drop policy if exists owner_vehicle_settlements_write_finance on public.owner_vehicle_settlements;
create policy owner_vehicle_settlements_select_backoffice
  on public.owner_vehicle_settlements for select to authenticated
  using (public.is_backoffice_user());
create policy owner_vehicle_settlements_write_finance
  on public.owner_vehicle_settlements for all to authenticated
  using (public.can_manage_finance())
  with check (public.can_manage_finance());

alter table public.ledger_entries enable row level security;
drop policy if exists ledger_entries_select_backoffice on public.ledger_entries;
drop policy if exists ledger_entries_write_finance on public.ledger_entries;
create policy ledger_entries_select_backoffice
  on public.ledger_entries for select to authenticated
  using (public.is_backoffice_user());
create policy ledger_entries_write_finance
  on public.ledger_entries for all to authenticated
  using (public.can_manage_finance())
  with check (public.can_manage_finance());

alter table public.settlement_periods enable row level security;
drop policy if exists settlement_periods_select_backoffice on public.settlement_periods;
drop policy if exists settlement_periods_write_finance on public.settlement_periods;
create policy settlement_periods_select_backoffice
  on public.settlement_periods for select to authenticated
  using (public.is_backoffice_user());
create policy settlement_periods_write_finance
  on public.settlement_periods for all to authenticated
  using (public.can_manage_finance())
  with check (public.can_manage_finance());

alter table public.payout_batches enable row level security;
alter table public.payout_batch_items enable row level security;
drop policy if exists payout_batches_select_backoffice on public.payout_batches;
drop policy if exists payout_batches_write_finance on public.payout_batches;
drop policy if exists payout_items_select_backoffice on public.payout_batch_items;
drop policy if exists payout_items_write_finance on public.payout_batch_items;
create policy payout_batches_select_backoffice
  on public.payout_batches for select to authenticated
  using (public.is_backoffice_user());
create policy payout_batches_write_finance
  on public.payout_batches for all to authenticated
  using (public.can_manage_finance())
  with check (public.can_manage_finance());
create policy payout_items_select_backoffice
  on public.payout_batch_items for select to authenticated
  using (public.is_backoffice_user());
create policy payout_items_write_finance
  on public.payout_batch_items for all to authenticated
  using (public.can_manage_finance())
  with check (public.can_manage_finance());

alter table public.raw_import_batches enable row level security;
alter table public.raw_import_rows enable row level security;
alter table public.normalized_platform_transactions enable row level security;
alter table public.reconciliation_issues enable row level security;
drop policy if exists raw_import_batches_backoffice on public.raw_import_batches;
drop policy if exists raw_import_rows_backoffice on public.raw_import_rows;
drop policy if exists normalized_transactions_backoffice on public.normalized_platform_transactions;
drop policy if exists reconciliation_issues_backoffice on public.reconciliation_issues;
create policy raw_import_batches_backoffice
  on public.raw_import_batches for all to authenticated
  using (public.is_backoffice_user())
  with check (public.is_backoffice_user());
create policy raw_import_rows_backoffice
  on public.raw_import_rows for all to authenticated
  using (public.is_backoffice_user())
  with check (public.is_backoffice_user());
create policy normalized_transactions_backoffice
  on public.normalized_platform_transactions for all to authenticated
  using (public.is_backoffice_user())
  with check (public.is_backoffice_user());
create policy reconciliation_issues_backoffice
  on public.reconciliation_issues for all to authenticated
  using (public.is_backoffice_user())
  with check (public.is_backoffice_user());

alter table public.contracts enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_ledger_entries enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_links enable row level security;
alter table public.driver_statements enable row level security;
alter table public.audit_logs enable row level security;
drop policy if exists contracts_backoffice on public.contracts;
drop policy if exists invoices_backoffice on public.invoices;
drop policy if exists invoice_ledger_entries_backoffice on public.invoice_ledger_entries;
drop policy if exists support_tickets_backoffice on public.support_tickets;
drop policy if exists support_ticket_links_backoffice on public.support_ticket_links;
drop policy if exists driver_statements_backoffice on public.driver_statements;
drop policy if exists audit_logs_select_backoffice on public.audit_logs;
drop policy if exists audit_logs_insert_backoffice on public.audit_logs;
create policy contracts_backoffice
  on public.contracts for all to authenticated
  using (public.is_backoffice_user())
  with check (public.is_backoffice_user());
create policy invoices_backoffice
  on public.invoices for all to authenticated
  using (public.can_manage_finance())
  with check (public.can_manage_finance());
create policy invoice_ledger_entries_backoffice
  on public.invoice_ledger_entries for all to authenticated
  using (public.can_manage_finance())
  with check (public.can_manage_finance());
create policy support_tickets_backoffice
  on public.support_tickets for all to authenticated
  using (public.is_backoffice_user())
  with check (public.is_backoffice_user());
create policy support_ticket_links_backoffice
  on public.support_ticket_links for all to authenticated
  using (public.is_backoffice_user())
  with check (public.is_backoffice_user());
create policy driver_statements_backoffice
  on public.driver_statements for all to authenticated
  using (public.is_backoffice_user())
  with check (public.is_backoffice_user());
create policy audit_logs_select_backoffice
  on public.audit_logs for select to authenticated
  using (public.is_backoffice_user());
create policy audit_logs_insert_backoffice
  on public.audit_logs for insert to authenticated
  with check (public.is_backoffice_user());

notify pgrst, 'reload schema';

commit;
