-- Assigned technicians need names in a visit without exposing draft content.
create or replace function private.shares_active_company(target_user uuid)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select private.is_master() or exists (
    select 1
    from public.company_memberships mine
    join public.company_memberships theirs on theirs.company_id = mine.company_id
    where mine.user_id = auth.uid() and mine.active
      and theirs.user_id = target_user and theirs.active
  )
$$;

revoke all on function private.shares_active_company(uuid) from public;
grant execute on function private.shares_active_company(uuid) to authenticated;

create policy "active company colleagues read profiles" on public.profiles
for select to authenticated using (private.shares_active_company(id));
