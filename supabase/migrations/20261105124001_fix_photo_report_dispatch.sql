create or replace function private.dispatch_photo_reports() returns integer language plpgsql security definer set search_path='' as $$
declare j public.photo_report_jobs; token_value uuid; sent integer:=0;
begin
 if not exists(select 1 from private.photo_report_configuration where enabled) then return 0; end if;
 -- Reconcile a missed enqueue without revisiting old historical attendances.
 perform private.enqueue_photo_report(a.id) from public.appointments a
 where a.status='completed' and a.completed_at>=(select started_at from private.photo_report_configuration)
 and not exists(select 1 from public.photo_report_jobs existing_job where existing_job.appointment_id=a.id);
 for j in select * from public.photo_report_jobs where status in ('queued','analyzing','assembling') and next_attempt_at<=now() and (lease_until is null or lease_until<now()) order by created_at limit 3 for update skip locked loop
  if j.attempts>=600 then update public.photo_report_jobs set status='failed',error_code='worker_retry_limit',updated_at=now() where id=j.id; continue; end if;
  token_value:=gen_random_uuid();
  insert into private.photo_report_dispatch(job_id,token,consumed) values(j.id,token_value,false) on conflict(job_id) do update set token=excluded.token,consumed=false;
  update public.photo_report_jobs set lease_until=now()+interval '3 minutes',attempts=attempts+1,updated_at=now() where id=j.id;
  perform net.http_post(url:='https://cperyeyppyhpzyjafqtp.supabase.co/functions/v1/photo-report-worker',body:=jsonb_build_object('job_id',j.id,'token',token_value),timeout_milliseconds:=120000);
  sent:=sent+1;
 end loop;
 return sent;
end $$;
