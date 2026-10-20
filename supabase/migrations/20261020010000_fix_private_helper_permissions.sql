-- RLS policies invoke these private helpers for authenticated requests.
-- The private schema remains outside the Data API; this grants execution only
-- to the signed-in role so policy evaluation can complete.
grant execute on function private.is_master() to authenticated;
grant execute on function private.belongs_to_company(uuid) to authenticated;
grant execute on function private.is_company_admin(uuid) to authenticated;
