-- Old installed app versions may still post to the legacy Edge Function.
-- Keep those new inserts discoverable, as private drafts awaiting completion.
create function public.bridge_legacy_field_record() returns trigger language plpgsql security invoker set search_path='' as $$
declare row_data jsonb:=to_jsonb(new); owner_id uuid; tool_kind text; record_client uuid; record_appointment uuid;
begin
  tool_kind:=case tg_table_name when 'travel_logs' then 'travel' when 'heat_assessments' then 'heat' when 'accident_investigations' then 'accident' else 'training' end;
  owner_id:=coalesce(nullif(row_data->>'technician_id','')::uuid,nullif(row_data->>'created_by','')::uuid);
  record_client:=nullif(row_data->>'client_id','')::uuid;
  record_appointment:=nullif(row_data->>'appointment_id','')::uuid;
  if owner_id is not null then
    insert into public.field_tool_records(id,company_id,technician_id,kind,status,client_id,appointment_id,data)
    values(new.id,new.company_id,owner_id,tool_kind,'draft',record_client,record_appointment,
      row_data-array['id','company_id','technician_id','created_by','client_id','appointment_id','created_at','updated_at'])
    on conflict(id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.bridge_legacy_field_record() from public;
create trigger bridge_travel_field_record after insert on public.travel_logs for each row execute function public.bridge_legacy_field_record();
create trigger bridge_heat_field_record after insert on public.heat_assessments for each row execute function public.bridge_legacy_field_record();
create trigger bridge_accident_field_record after insert on public.accident_investigations for each row execute function public.bridge_legacy_field_record();
create trigger bridge_training_field_record after insert on public.trainings for each row execute function public.bridge_legacy_field_record();
