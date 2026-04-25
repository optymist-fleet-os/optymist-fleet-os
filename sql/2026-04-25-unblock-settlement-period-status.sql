begin;

alter table public.settlement_periods
  drop constraint if exists settlement_periods_status_check;

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

notify pgrst, 'reload schema';

commit;
