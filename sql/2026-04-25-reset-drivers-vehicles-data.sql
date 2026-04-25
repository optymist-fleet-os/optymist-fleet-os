begin;

-- Clean reset for replacing the fleet roster.
-- Keeps users, roles, settlement periods, vehicle owners, app settings, and Google Drive files.

delete from public.documents
where entity_type in ('driver', 'vehicle', 'settlement', 'owner_settlement');

delete from public.owner_vehicle_settlements;
delete from public.driver_settlements;
delete from public.driver_vehicle_assignments;

do $$
begin
  if to_regclass('public.ledger_entries') is not null then
    delete from public.ledger_entries;
  end if;

  if to_regclass('public.tasks_alerts') is not null then
    delete from public.tasks_alerts;
  end if;

  if to_regclass('public.platform_accounts') is not null then
    delete from public.platform_accounts;
  end if;
end $$;

delete from public.vehicles;
delete from public.drivers;

notify pgrst, 'reload schema';

commit;
