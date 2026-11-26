alter table private.photo_report_configuration
  add column if not exists ai_analysis_enabled boolean not null default false,
  add column if not exists ai_simulation_enabled boolean not null default false;

-- A read-only bridge for the internal Edge Function: never expose configuration
-- writes or user controls through the public REST API.
create or replace function public.get_photo_report_ai_flags()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'vision', c.ai_analysis_enabled,
    'simulation', c.ai_simulation_enabled
  )
  from private.photo_report_configuration as c
  where c.id = true;
$function$;

revoke all on function public.get_photo_report_ai_flags() from public, anon, authenticated;
grant usage on schema private to service_role;
grant select (id, ai_analysis_enabled, ai_simulation_enabled)
  on private.photo_report_configuration to service_role;
grant execute on function public.get_photo_report_ai_flags() to service_role;

-- Authorized first-stage rollout: vision only. No image edits.
update private.photo_report_configuration
set ai_analysis_enabled = true,
    ai_simulation_enabled = false
where id = true;