alter table public.photo_report_items add column thumbnail_path text;
alter table public.photo_report_items add column source_details jsonb not null default '{}'::jsonb;
create or replace function private.enqueue_photo_report(target uuid) returns void language plpgsql security definer set search_path='' as $$
declare a public.appointments; job uuid;
begin
 select * into a from public.appointments where id=target and status='completed';
 if not found then return; end if;
 insert into public.photo_report_jobs(company_id,appointment_id) values(a.company_id,a.id) on conflict(appointment_id) do nothing returning id into job;
 if job is null then return; end if;
 insert into public.photo_report_items(job_id,evidence_id,company_id,original_bucket,original_path,observation,location_text,sort_order,source_details)
 select job,e.id,e.company_id,e.storage_bucket,e.storage_path,e.observation,e.location_text,row_number() over(order by e.sort_order,e.created_at,e.id)::integer,
 jsonb_build_object('risk_level',e.risk_level,'recommendation',e.recommendation,'additional_notes',e.additional_notes,'file_name',e.file_name)
 from public.evidence e where e.appointment_id=a.id and e.media_kind='image';
 update public.photo_report_jobs set photo_total=(select count(*) from public.photo_report_items where job_id=job) where id=job;
end $$;
