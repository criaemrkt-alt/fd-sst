create extension if not exists pg_cron;
create extension if not exists pg_net;
create table public.photo_report_jobs (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 appointment_id uuid not null unique references public.appointments(id),
 status text not null default 'queued' check(status in ('queued','analyzing','assembling','completed','partial','failed')),
 photo_total integer not null default 0, photo_done integer not null default 0,
 attempts integer not null default 0, lease_until timestamptz, next_attempt_at timestamptz not null default now(),
 report_path text, report_bytes bigint, warning text, error_code text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index photo_report_jobs_company on public.photo_report_jobs(company_id,created_at desc);
create index photo_report_jobs_queue on public.photo_report_jobs(next_attempt_at) where status in ('queued','analyzing','assembling');
create table public.photo_report_items (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.photo_report_jobs(id) on delete cascade,
 evidence_id uuid not null references public.evidence(id), company_id uuid not null references public.companies(id),
 original_bucket text not null, original_path text not null, observation text, location_text text, sort_order integer not null default 0,
 status text not null default 'pending' check(status in ('pending','done','failed')),
 attempts integer not null default 0, analysis jsonb, work_path text, annotated_path text, simulation_path text,
 model text, error_code text, unique(job_id,evidence_id)
);
create index photo_report_items_job on public.photo_report_items(job_id,status);
create index photo_report_items_evidence on public.photo_report_items(evidence_id);
create index photo_report_items_company on public.photo_report_items(company_id);
create table private.photo_report_dispatch (
 job_id uuid primary key references public.photo_report_jobs(id) on delete cascade,
 token uuid not null default gen_random_uuid(), consumed boolean not null default false
);
create table private.photo_report_usage (day date primary key, calls integer not null default 0);
create table private.photo_report_configuration (id boolean primary key default true check(id), started_at timestamptz not null default now(), enabled boolean not null default false);
insert into private.photo_report_configuration(id) values(true);
revoke all on private.photo_report_configuration from public,anon,authenticated;
alter table private.photo_report_configuration enable row level security;
alter table private.photo_report_dispatch enable row level security;
alter table private.photo_report_usage enable row level security;
revoke all on private.photo_report_dispatch,private.photo_report_usage from public,anon,authenticated;
grant all on private.photo_report_dispatch,private.photo_report_usage to service_role;
alter table public.photo_report_jobs enable row level security;
alter table public.photo_report_items enable row level security;
revoke all on public.photo_report_jobs,public.photo_report_items from anon,authenticated;
grant select on public.photo_report_jobs,public.photo_report_items to authenticated;
grant all on public.photo_report_jobs,public.photo_report_items to service_role;
create policy "authorized finalized job readers" on public.photo_report_jobs for select to authenticated using(private.can_read_appointment_content(appointment_id));
create policy "authorized finalized photo readers" on public.photo_report_items for select to authenticated using(exists(select 1 from public.photo_report_jobs j where j.id=job_id));

create function private.enqueue_photo_report(target uuid) returns void language plpgsql security definer set search_path='' as $$
declare a public.appointments; job uuid;
begin
 select * into a from public.appointments where id=target and status='completed';
 if not found then return; end if;
 insert into public.photo_report_jobs(company_id,appointment_id) values(a.company_id,a.id) on conflict(appointment_id) do nothing returning id into job;
 if job is null then return; end if;
 insert into public.photo_report_items(job_id,evidence_id,company_id,original_bucket,original_path,observation,location_text,sort_order)
 select job,e.id,e.company_id,e.storage_bucket,e.storage_path,e.observation,e.location_text,row_number() over(order by e.sort_order,e.created_at,e.id)::integer from public.evidence e where e.appointment_id=a.id and e.media_kind='image';
 update public.photo_report_jobs set photo_total=(select count(*) from public.photo_report_items where job_id=job) where id=job;
end $$;
revoke all on function private.enqueue_photo_report(uuid) from public,anon,authenticated;
create function private.on_attendance_photo_report() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='completed' and old.status is distinct from new.status then
  begin perform private.enqueue_photo_report(new.id); exception when others then raise log 'photo_report enqueue failed for appointment %, SQLSTATE %',new.id,sqlstate; end;
 end if;
 return new;
end $$;
revoke all on function private.on_attendance_photo_report() from public,anon,authenticated;
create trigger enqueue_attendance_photo_report after update of status on public.appointments for each row execute function private.on_attendance_photo_report();

-- A private one-use dispatch token authenticates the cron request. No user JWT
-- or service key is stored in an HTTP URL or exposed in report rows.
create function public.accept_photo_report_dispatch(target uuid, dispatch_token uuid) returns setof public.photo_report_jobs language plpgsql security definer set search_path='' as $$
begin
 update private.photo_report_dispatch set consumed=true where job_id=target and token=dispatch_token and not consumed;
 if not found then return; end if;
 return query select * from public.photo_report_jobs where id=target and lease_until>now() and status in ('queued','analyzing','assembling');
end $$;
revoke all on function public.accept_photo_report_dispatch(uuid,uuid) from public,anon,authenticated;
grant execute on function public.accept_photo_report_dispatch(uuid,uuid) to service_role;
create function public.reserve_photo_report_call(call_limit integer) returns boolean language plpgsql security definer set search_path='' as $$
declare used integer;
begin
 if call_limit<1 or call_limit>200 then return false; end if;
 insert into private.photo_report_usage(day,calls) values((now() at time zone 'UTC')::date,1)
 on conflict(day) do update set calls=private.photo_report_usage.calls+1 where private.photo_report_usage.calls<call_limit returning calls into used;
 return used is not null;
end $$;
revoke all on function public.reserve_photo_report_call(integer) from public,anon,authenticated;
grant execute on function public.reserve_photo_report_call(integer) to service_role;

create function private.dispatch_photo_reports() returns integer language plpgsql security definer set search_path='' as $$
declare j public.photo_report_jobs; token_value uuid; sent integer:=0;
begin
 if not exists(select 1 from private.photo_report_configuration where enabled) then return 0; end if;
 -- Reconcile a missed enqueue without revisiting old historical attendances.
 perform private.enqueue_photo_report(a.id) from public.appointments a
 where a.status='completed' and a.completed_at>=(select started_at from private.photo_report_configuration)
 and not exists(select 1 from public.photo_report_jobs j where j.appointment_id=a.id);
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
revoke all on function private.dispatch_photo_reports() from public,anon,authenticated;
select cron.schedule('fd-sst-photo-reports','* * * * *','select private.dispatch_photo_reports()');

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('fd-sst-ai-reports','fd-sst-ai-reports',false,52428800,array['image/jpeg','image/png','image/svg+xml','application/vnd.openxmlformats-officedocument.presentationml.presentation']);
create policy "authorized report artifact readers" on storage.objects for select to authenticated using(bucket_id='fd-sst-ai-reports' and exists(select 1 from public.photo_report_jobs j where j.company_id::text=(storage.foldername(name))[1] and j.appointment_id::text=(storage.foldername(name))[2] and j.id::text=(storage.foldername(name))[3]));
alter table public.reports add column if not exists byte_size bigint;
alter table public.reports add column if not exists photo_job_id uuid references public.photo_report_jobs(id);
create index reports_photo_job on public.reports(photo_job_id);
drop policy "tenant reads reports" on public.reports;
drop policy "tenant creates reports" on public.reports;
create policy "assigned or finalized admin reads reports" on public.reports for select to authenticated using(private.can_read_appointment_content(appointment_id));
