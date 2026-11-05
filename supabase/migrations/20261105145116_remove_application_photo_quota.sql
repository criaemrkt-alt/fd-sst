-- Count attempts for observability without imposing an application daily cap.
-- Cloudflare's own plan quota remains authoritative.
create function public.record_photo_report_call() returns void
language sql security definer set search_path='' as $$
 insert into private.photo_report_usage(day,calls)
 values((now() at time zone 'UTC')::date,1)
 on conflict(day) do update set calls=private.photo_report_usage.calls+1;
$$;
revoke all on function public.record_photo_report_call() from public,anon,authenticated;
grant execute on function public.record_photo_report_call() to service_role;
