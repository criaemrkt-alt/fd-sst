-- A disabled company must lose tenant access immediately, while the Master
-- continues to retain global visibility to reactivate it.
create or replace function private.belongs_to_company(target_company uuid)
returns boolean
language sql stable security definer set search_path = public, auth
as $$ select exists (
  select 1
  from public.company_memberships m
  join public.companies c on c.id = m.company_id
  where m.company_id = target_company
    and m.user_id = auth.uid()
    and m.active
    and c.status = 'active'
) $$;

create or replace function private.is_company_admin(target_company uuid)
returns boolean
language sql stable security definer set search_path = public, auth
as $$ select exists (
  select 1
  from public.company_memberships m
  join public.companies c on c.id = m.company_id
  where m.company_id = target_company
    and m.user_id = auth.uid()
    and m.role = 'admin'
    and m.active
    and c.status = 'active'
) $$;

grant execute on function private.belongs_to_company(uuid) to authenticated;
grant execute on function private.is_company_admin(uuid) to authenticated;
