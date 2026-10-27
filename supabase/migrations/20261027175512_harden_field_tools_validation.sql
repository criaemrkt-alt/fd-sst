-- Enforce current profile state even for an access token issued before disable.
create policy "active field account" on public.field_tool_records as restrictive for all to authenticated
using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active) and (private.belongs_to_company(company_id) or private.is_master()))
with check (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active) and private.belongs_to_company(company_id));
create policy "active field photo account" on storage.objects as restrictive for all to authenticated
using (bucket_id<>'fd-sst-field-tools' or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active))
with check (bucket_id<>'fd-sst-field-tools' or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.active));

create or replace function public.validate_field_tool_record() returns trigger language plpgsql security invoker set search_path='' as $$
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
  foreach k in array array['departed_at','arrived_at','measured_at','occurred_at','starts_at','ends_at','calibration_date','action_deadline'] loop
    if nullif(d->>k,'') is not null then perform (d->>k)::timestamptz; end if;
  end loop;
  if octet_length(new.attachments::text)>40000 then raise exception 'Metadados de fotos muito grandes.'; end if;
  if new.kind='travel' and ((nullif(d->>'odometer_start','') is null) <> (nullif(d->>'odometer_end','') is null)) then raise exception 'Preencha os dois hodômetros ou deixe ambos vazios.'; end if;
  return new;
end $$;

