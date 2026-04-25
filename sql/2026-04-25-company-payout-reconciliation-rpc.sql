begin;

create or replace function public.record_company_platform_payout_import(
  target_period_id uuid,
  target_platform text,
  target_file_name text,
  target_file_hash text,
  target_row_number integer,
  target_row_hash text,
  target_raw_data jsonb,
  target_company_name text,
  target_external_id text,
  target_amount numeric,
  target_raw_amount numeric,
  target_source_files text[],
  target_archive_file_url text,
  target_archive_folder_url text,
  target_metadata jsonb default '{}'::jsonb
)
returns public.reconciliation_issues
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_raw_row_id uuid;
  v_transaction_id uuid;
  v_issue_row public.reconciliation_issues;
  v_row_key text;
  v_platform text;
  v_amount numeric;
  v_batch_metadata jsonb;
  v_transaction_metadata jsonb;
  v_issue_metadata jsonb;
begin
  if not public.is_backoffice_user() then
    raise exception 'Not allowed to record reconciliation imports.';
  end if;

  v_platform := lower(coalesce(nullif(target_platform, ''), 'unknown'));
  v_amount := abs(coalesce(target_amount, 0));
  v_row_key := coalesce(
    nullif(target_row_hash, ''),
    md5(
      v_platform || '|' ||
      coalesce(target_file_name, '') || '|' ||
      coalesce(target_row_number::text, '') || '|' ||
      coalesce(target_external_id, '') || '|' ||
      coalesce(target_raw_amount::text, '')
    )
  );

  v_batch_metadata :=
    jsonb_build_object(
      'source', 'driver_settlements_auto_calc',
      'source_files', coalesce(to_jsonb(target_source_files), '[]'::jsonb),
      'archive_folder_url', target_archive_folder_url
    ) || coalesce(target_metadata, '{}'::jsonb);

  select rib.id
    into v_batch_id
  from public.raw_import_batches rib
  where rib.platform = v_platform
    and rib.period_id is not distinct from target_period_id
    and rib.file_name is not distinct from target_file_name
    and rib.file_hash is not distinct from target_file_hash
  order by rib.imported_at desc
  limit 1;

  if v_batch_id is null then
    insert into public.raw_import_batches (
      platform,
      period_id,
      source_type,
      file_name,
      file_hash,
      status,
      imported_by,
      row_count,
      metadata
    )
    values (
      v_platform,
      target_period_id,
      'csv',
      target_file_name,
      target_file_hash,
      'needs_reconciliation',
      auth.uid(),
      1,
      v_batch_metadata
    )
    returning id into v_batch_id;
  else
    update public.raw_import_batches
    set
      status = 'needs_reconciliation',
      row_count = greatest(coalesce(row_count, 0), 1),
      metadata = coalesce(metadata, '{}'::jsonb) || v_batch_metadata,
      updated_at = now()
    where id = v_batch_id;
  end if;

  select rir.id
    into v_raw_row_id
  from public.raw_import_rows rir
  where rir.batch_id = v_batch_id
    and rir.row_hash = v_row_key
  limit 1;

  if v_raw_row_id is null then
    insert into public.raw_import_rows (
      batch_id,
      row_number,
      raw_data,
      row_hash,
      status
    )
    values (
      v_batch_id,
      coalesce(target_row_number, 0),
      coalesce(target_raw_data, '{}'::jsonb),
      v_row_key,
      'needs_reconciliation'
    )
    returning id into v_raw_row_id;
  else
    update public.raw_import_rows
    set
      raw_data = coalesce(target_raw_data, raw_data),
      status = 'needs_reconciliation',
      error_message = null
    where id = v_raw_row_id;
  end if;

  v_transaction_metadata :=
    jsonb_build_object(
      'company_row_key', v_row_key,
      'company_name', target_company_name,
      'external_id', target_external_id,
      'raw_amount', coalesce(target_raw_amount, target_amount),
      'archive_file_url', target_archive_file_url,
      'archive_folder_url', target_archive_folder_url
    ) || coalesce(target_metadata, '{}'::jsonb);

  select npt.id
    into v_transaction_id
  from public.normalized_platform_transactions npt
  where npt.platform = v_platform
    and npt.external_transaction_id = v_row_key
  limit 1;

  if v_transaction_id is null then
    insert into public.normalized_platform_transactions (
      batch_id,
      raw_row_id,
      platform,
      external_transaction_id,
      transaction_type,
      gross_amount,
      net_amount,
      cash_collected,
      currency,
      status,
      metadata
    )
    values (
      v_batch_id,
      v_raw_row_id,
      v_platform,
      v_row_key,
      'company_platform_payout',
      0,
      v_amount,
      0,
      'PLN',
      'needs_reconciliation',
      v_transaction_metadata
    )
    returning id into v_transaction_id;
  else
    update public.normalized_platform_transactions
    set
      batch_id = v_batch_id,
      raw_row_id = v_raw_row_id,
      transaction_type = 'company_platform_payout',
      net_amount = v_amount,
      status = 'needs_reconciliation',
      metadata = coalesce(metadata, '{}'::jsonb) || v_transaction_metadata,
      updated_at = now()
    where id = v_transaction_id;
  end if;

  v_issue_metadata :=
    jsonb_build_object(
      'company_row_key', v_row_key,
      'company_name', target_company_name,
      'imported_name', target_company_name,
      'external_id', target_external_id,
      'platform', v_platform,
      'file_name', target_file_name,
      'file_hash', target_file_hash,
      'row_number', target_row_number,
      'company_payout_amount', v_amount,
      'raw_amount', coalesce(target_raw_amount, target_amount),
      'archive_file_url', target_archive_file_url,
      'archive_folder_url', target_archive_folder_url,
      'source_files', coalesce(to_jsonb(target_source_files), '[]'::jsonb),
      'transaction_type', 'company_platform_payout'
    ) || coalesce(target_metadata, '{}'::jsonb);

  select ri.*
    into v_issue_row
  from public.reconciliation_issues ri
  where ri.issue_type = 'company_platform_payout'
    and ri.source_import_batch_id = v_batch_id
    and ri.metadata ->> 'company_row_key' = v_row_key
  limit 1;

  if v_issue_row.id is null then
    insert into public.reconciliation_issues (
      severity,
      status,
      issue_type,
      source_import_batch_id,
      related_transaction_id,
      metadata
    )
    values (
      'medium',
      'open',
      'company_platform_payout',
      v_batch_id,
      v_transaction_id,
      v_issue_metadata
    )
    returning * into v_issue_row;
  else
    update public.reconciliation_issues
    set
      related_transaction_id = v_transaction_id,
      status = case
        when status in ('resolved', 'ignored') then status
        else 'open'
      end,
      metadata = coalesce(metadata, '{}'::jsonb) || v_issue_metadata,
      updated_at = now()
    where id = v_issue_row.id
    returning * into v_issue_row;
  end if;

  return v_issue_row;
end;
$$;

grant execute on function public.record_company_platform_payout_import(
  uuid,
  text,
  text,
  text,
  integer,
  text,
  jsonb,
  text,
  text,
  numeric,
  numeric,
  text[],
  text,
  text,
  jsonb
) to authenticated;

notify pgrst, 'reload schema';

commit;
