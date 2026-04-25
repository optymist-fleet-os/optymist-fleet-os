begin;

create or replace function public.is_backoffice_user()
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
      and lower(role) in ('admin', 'operator')
  );
$$;

grant execute on function public.is_backoffice_user() to authenticated;

alter table public.documents enable row level security;

drop policy if exists documents_select_backoffice on public.documents;
drop policy if exists documents_insert_backoffice on public.documents;
drop policy if exists documents_update_backoffice on public.documents;
drop policy if exists documents_delete_backoffice on public.documents;

create policy documents_select_backoffice
  on public.documents
  for select
  to authenticated
  using (public.is_backoffice_user());

create policy documents_insert_backoffice
  on public.documents
  for insert
  to authenticated
  with check (public.is_backoffice_user());

create policy documents_update_backoffice
  on public.documents
  for update
  to authenticated
  using (public.is_backoffice_user())
  with check (public.is_backoffice_user());

create policy documents_delete_backoffice
  on public.documents
  for delete
  to authenticated
  using (public.is_backoffice_user());

notify pgrst, 'reload schema';

commit;
