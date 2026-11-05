create or replace function public.reserve_photo_report_call(call_limit integer) returns boolean language plpgsql security definer set search_path='' as $$
declare used integer;
begin
 if call_limit is null or call_limit<1 or call_limit>200 then return false; end if;
 insert into private.photo_report_usage(day,calls) values((now() at time zone 'UTC')::date,1)
 on conflict(day) do update set calls=private.photo_report_usage.calls+1 where private.photo_report_usage.calls<call_limit returning calls into used;
 return used is not null;
end $$;
