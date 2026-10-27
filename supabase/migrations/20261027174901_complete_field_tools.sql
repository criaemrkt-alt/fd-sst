-- Complete stand-alone field tooling. Attendance tables and their draft rules
-- are intentionally unchanged. Old records are copied, never deleted.
create table public.field_tool_records (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  technician_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('travel','heat','accident','training')),
  status text not null default 'draft' check (status in ('draft','submitted')),
  client_id uuid references public.clients(id),
  appointment_id uuid references public.appointments(id),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 200000),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 20),
  version integer not null default 1,
  last_mutation uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index field_tool_records_owner_idx on public.field_tool_records(company_id, technician_id, updated_at desc);
create index field_tool_records_submitted_idx on public.field_tool_records(company_id, updated_at desc) where status='submitted';
create index field_tool_records_client_idx on public.field_tool_records(client_id);
create index field_tool_records_appointment_idx on public.field_tool_records(appointment_id);

insert into public.field_tool_records(id,company_id,technician_id,kind,status,client_id,appointment_id,data,created_at,updated_at)
select id, company_id, technician_id,'travel','submitted',null,appointment_id,
  to_jsonb(t) - array['id','company_id','technician_id','appointment_id','created_at'],created_at,created_at from public.travel_logs t
where technician_id is not null;
insert into public.field_tool_records(id,company_id,technician_id,kind,status,client_id,appointment_id,data,created_at,updated_at)
select id,company_id,created_by,'heat','submitted',client_id,appointment_id,
  to_jsonb(t) - array['id','company_id','created_by','client_id','appointment_id'],measured_at,measured_at from public.heat_assessments t where created_by is not null;
insert into public.field_tool_records(id,company_id,technician_id,kind,status,client_id,data,created_at,updated_at)
select id,company_id,created_by,'accident','submitted',client_id,
  to_jsonb(t) - array['id','company_id','created_by','client_id','created_at','updated_at'],created_at,updated_at from public.accident_investigations t where created_by is not null;
insert into public.field_tool_records(id,company_id,technician_id,kind,status,client_id,data,created_at,updated_at)
select id,company_id,created_by,'training','submitted',client_id,
  to_jsonb(t) - array['id','company_id','created_by','client_id','created_at'],created_at,created_at from public.trainings t where created_by is not null;

alter table public.field_tool_records enable row level security;
revoke all on public.field_tool_records from anon, authenticated;
grant select,insert,update on public.field_tool_records to authenticated;
grant all on public.field_tool_records to service_role;
create policy "field owner reads" on public.field_tool_records for select to authenticated using (
  technician_id=(select auth.uid()) and private.belongs_to_company(company_id));
create policy "admin reads submitted field records" on public.field_tool_records for select to authenticated using (
  private.is_master() or (status='submitted' and private.is_company_admin(company_id)));
create policy "field technician inserts own" on public.field_tool_records for insert to authenticated with check (
  technician_id=(select auth.uid()) and private.belongs_to_company(company_id) and exists (
    select 1 from public.company_memberships m where m.user_id=(select auth.uid()) and m.company_id=field_tool_records.company_id and m.active and m.role='technician'));
create policy "field technician updates own" on public.field_tool_records for update to authenticated using (
  technician_id=(select auth.uid()) and private.belongs_to_company(company_id) and exists (
    select 1 from public.company_memberships m where m.user_id=(select auth.uid()) and m.company_id=field_tool_records.company_id and m.active and m.role='technician')) with check (
  technician_id=(select auth.uid()) and private.belongs_to_company(company_id));

create function public.validate_field_tool_record() returns trigger language plpgsql security invoker set search_path='' as $$
declare k text; required_keys text[]; d jsonb:=new.data; val numeric; at jsonb;
begin
  if tg_op='UPDATE' then
    if (new.company_id,new.technician_id,new.kind,new.created_at) is distinct from (old.company_id,old.technician_id,old.kind,old.created_at) then
      raise exception 'Empresa, autor, tipo e criação não podem ser alterados.';
    end if;
    new.version:=old.version+1;
  else new.version:=1; new.created_at:=now(); end if;
  new.updated_at:=now();
  if new.client_id is not null and not exists(select 1 from public.clients c where c.id=new.client_id and c.company_id=new.company_id) then raise exception 'Cliente não pertence à empresa ou não está acessível.'; end if;
  if new.appointment_id is not null and not exists(select 1 from public.appointments a join public.appointment_technicians t on t.appointment_id=a.id where a.id=new.appointment_id and a.company_id=new.company_id and t.technician_id=new.technician_id and (new.client_id is null or a.client_id=new.client_id)) then raise exception 'Atendimento não atribuído a este técnico ou cliente incompatível.'; end if;
  for at in select value from jsonb_array_elements(new.attachments) loop
    if at->>'path' not like new.company_id::text||'/'||new.technician_id::text||'/'||new.id::text||'/%' or at->>'path' like '%..%' or coalesce(at->>'path','')='' then raise exception 'Caminho de anexo inválido.'; end if;
  end loop;
  foreach k in array array['tbn','tg','tbs','odometer_start','odometer_end','distance_km','duration_minutes','metabolic_rate','workload_minutes','toll','parking'] loop
    if nullif(d->>k,'') is not null then
      val:=(d->>k)::numeric;
      if val::text in ('NaN','Infinity','-Infinity') or (k in ('tbn','tg','tbs') and (val< -50 or val>150)) or (k not in ('tbn','tg','tbs') and val<0) then raise exception 'Valor numérico inválido: %', k; end if;
    end if;
  end loop;
  if new.kind='travel' and nullif(d->>'odometer_start','') is not null and nullif(d->>'odometer_end','') is not null then
    val:=(d->>'odometer_end')::numeric-(d->>'odometer_start')::numeric;
    if val<0 then raise exception 'Hodômetro final menor que o inicial.'; end if;
    new.data:=jsonb_set(new.data,'{distance_km}',to_jsonb(val));
  end if;
  if new.kind='heat' and nullif(d->>'tbn','') is not null and nullif(d->>'tg','') is not null then
    if coalesce((d->>'solar_exposure')::boolean,false) then
      if nullif(d->>'tbs','') is not null then val:=.7*(d->>'tbn')::numeric+.2*(d->>'tg')::numeric+.1*(d->>'tbs')::numeric; else val:=null; end if;
    else val:=.7*(d->>'tbn')::numeric+.3*(d->>'tg')::numeric; end if;
    new.data:=jsonb_set(new.data,'{calculated_ibutg}',coalesce(to_jsonb(round(val,2)),'null'::jsonb));
  end if;
  if new.kind='travel' and nullif(d->>'departed_at','') is not null and nullif(d->>'arrived_at','') is not null and (d->>'arrived_at')::timestamptz<(d->>'departed_at')::timestamptz then raise exception 'Chegada anterior à saída.'; end if;
  if new.kind='training' and nullif(d->>'starts_at','') is not null and nullif(d->>'ends_at','') is not null then
    if (d->>'ends_at')::timestamptz<(d->>'starts_at')::timestamptz then raise exception 'Fim anterior ao início.'; end if;
    if nullif(d->>'workload_minutes','') is not null and (d->>'workload_minutes')::numeric > extract(epoch from ((d->>'ends_at')::timestamptz-(d->>'starts_at')::timestamptz))/60 then raise exception 'Carga horária maior que o intervalo.'; end if;
  end if;
  if new.status='submitted' then
    if new.kind!='travel' and new.client_id is null then raise exception 'Selecione o cliente.'; end if;
    required_keys:=case new.kind
      when 'travel' then array['origin','destination','departed_at','arrived_at','distance_km']
      when 'heat' then array['measured_at','location_text','activity_description','instrument','tbn','tg']
      when 'accident' then array['occurred_at','location_text','worker_name','occurrence_type','description','recommendations','action_owner']
      when 'training' then array['name','starts_at','ends_at','location_text','workload_minutes','instructor_name','syllabus','participants'] end;
    foreach k in array required_keys loop if nullif(btrim(new.data->>k),'') is null then raise exception 'Campo obrigatório: %', k; end if; end loop;
    if new.kind='heat' and coalesce((d->>'solar_exposure')::boolean,false) and nullif(d->>'tbs','') is null then raise exception 'Informe o bulbo seco com carga solar.'; end if;
    if new.kind='training' and (d->>'workload_minutes')::numeric<=0 then raise exception 'Carga horária inválida.'; end if;
  end if;
  return new;
end $$;
revoke all on function public.validate_field_tool_record() from public;
create trigger validate_field_tool before insert or update on public.field_tool_records for each row execute function public.validate_field_tool_record();

-- Legacy tables remain for compatibility, with owner-only writes and tenant ADM read.
drop policy "tenant manages investigations" on public.accident_investigations;
drop policy "tenant manages heat assessments" on public.heat_assessments;
drop policy "tenant manages trainings" on public.trainings;
drop policy "technicians manage own travel" on public.travel_logs;
create policy "legacy accident owner" on public.accident_investigations for all to authenticated using (created_by=(select auth.uid()) and private.belongs_to_company(company_id)) with check (created_by=(select auth.uid()) and private.belongs_to_company(company_id));
create policy "legacy heat owner" on public.heat_assessments for all to authenticated using (created_by=(select auth.uid()) and private.belongs_to_company(company_id)) with check (created_by=(select auth.uid()) and private.belongs_to_company(company_id));
create policy "legacy training owner" on public.trainings for all to authenticated using (created_by=(select auth.uid()) and private.belongs_to_company(company_id)) with check (created_by=(select auth.uid()) and private.belongs_to_company(company_id));
create policy "legacy travel owner" on public.travel_logs for all to authenticated using (technician_id=(select auth.uid()) and private.belongs_to_company(company_id)) with check (technician_id=(select auth.uid()) and private.belongs_to_company(company_id));
create policy "admin reads legacy accidents" on public.accident_investigations for select to authenticated using (private.is_master() or private.is_company_admin(company_id));
create policy "admin reads legacy heat" on public.heat_assessments for select to authenticated using (private.is_master() or private.is_company_admin(company_id));
create policy "admin reads legacy training" on public.trainings for select to authenticated using (private.is_master() or private.is_company_admin(company_id));
create policy "admin reads legacy travel" on public.travel_logs for select to authenticated using (private.is_master() or private.is_company_admin(company_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('fd-sst-field-tools','fd-sst-field-tools',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy "field photos owner insert" on storage.objects for insert to authenticated with check (
  bucket_id='fd-sst-field-tools' and (storage.foldername(name))[2]=(select auth.uid())::text and private.belongs_to_company(((storage.foldername(name))[1])::uuid));
create policy "field photos owner read" on storage.objects for select to authenticated using (
  bucket_id='fd-sst-field-tools' and (storage.foldername(name))[2]=(select auth.uid())::text and private.belongs_to_company(((storage.foldername(name))[1])::uuid));
create policy "field photos admin read submitted" on storage.objects for select to authenticated using (
  bucket_id='fd-sst-field-tools' and exists(select 1 from public.field_tool_records f where f.id::text=(storage.foldername(name))[3] and f.company_id::text=(storage.foldername(name))[1] and f.status='submitted' and (private.is_master() or private.is_company_admin(f.company_id)) and exists(select 1 from jsonb_array_elements(f.attachments) a where a->>'path'=name)));
