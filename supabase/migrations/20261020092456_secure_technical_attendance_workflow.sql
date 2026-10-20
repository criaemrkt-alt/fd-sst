-- Attendance data is a technician draft until the assigned team finalizes it.
-- The policy model below intentionally separates operational appointment access
-- from sensitive field content (photos, findings, checklist and signature).

alter table public.appointments
  add column if not exists finalized_by uuid references auth.users(id),
  add column if not exists finalization_note text;

alter table public.evidence
  add column if not exists additional_notes text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id);

alter table public.function_activities
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id);

alter table public.service_records
  add column if not exists service_catalog_id uuid,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id);

create table if not exists public.company_services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(company_id, name)
);

alter table public.service_records
  drop constraint if exists service_records_service_catalog_id_fkey,
  add constraint service_records_service_catalog_id_fkey
    foreign key (service_catalog_id) references public.company_services(id) on delete set null;

create table if not exists public.appointment_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  note_kind text not null default 'general' check (note_kind in ('general','issue','guidance','recommendation','pending')),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id)
);

create index if not exists company_services_company_active_idx on public.company_services(company_id, active, sort_order);
create index if not exists appointment_notes_appointment_idx on public.appointment_notes(appointment_id, created_at);
create index if not exists evidence_appointment_idx on public.evidence(appointment_id, created_at);
create index if not exists service_records_appointment_idx on public.service_records(appointment_id, performed_at);
create index if not exists function_activities_appointment_idx on public.function_activities(appointment_id, created_at);

alter table public.company_services enable row level security;
alter table public.appointment_notes enable row level security;

-- Private helper functions stay out of the exposed schema. They are the single
-- authorization predicate shared by metadata and private object policies.
create or replace function private.is_assigned_technician(target_appointment uuid)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select exists (
    select 1
    from public.appointment_technicians at
    join public.appointments a on a.id = at.appointment_id
    join public.company_memberships m on m.company_id = a.company_id and m.user_id = at.technician_id
    join public.companies c on c.id = a.company_id
    where at.appointment_id = target_appointment
      and at.technician_id = auth.uid()
      and m.role = 'technician' and m.active and c.status = 'active'
  )
$$;

create or replace function private.can_read_appointment_content(target_appointment uuid)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select private.is_master()
  or private.is_assigned_technician(target_appointment)
  or exists (
    select 1 from public.appointments a
    where a.id = target_appointment
      and a.status = 'completed'
      and private.is_company_admin(a.company_id)
  )
$$;

create or replace function private.can_edit_appointment_draft(target_appointment uuid)
returns boolean
language sql stable security definer set search_path = public, auth
as $$
  select private.is_assigned_technician(target_appointment)
  and exists (
    select 1 from public.appointments a
    where a.id = target_appointment and a.status = 'in_progress'
  )
$$;

create or replace function private.checklist_appointment(target_checklist uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select appointment_id from public.appointment_checklists where id = target_checklist $$;

create or replace function private.content_appointment_from_evidence(target_evidence uuid)
returns uuid
language sql stable security definer set search_path = public
as $$ select appointment_id from public.evidence where id = target_evidence $$;

revoke all on function private.is_assigned_technician(uuid) from public;
revoke all on function private.can_read_appointment_content(uuid) from public;
revoke all on function private.can_edit_appointment_draft(uuid) from public;
revoke all on function private.checklist_appointment(uuid) from public;
revoke all on function private.content_appointment_from_evidence(uuid) from public;
grant execute on function private.is_assigned_technician(uuid), private.can_read_appointment_content(uuid), private.can_edit_appointment_draft(uuid), private.checklist_appointment(uuid), private.content_appointment_from_evidence(uuid) to authenticated;

-- Replace company-wide content permissions: company admins only receive
-- finalized content; assigned technicians keep access to their own draft.
drop policy if exists "tenant reads appointment checklists" on public.appointment_checklists;
drop policy if exists "tenant writes appointment checklists" on public.appointment_checklists;
drop policy if exists "tenant reads checklist answers" on public.checklist_answers;
drop policy if exists "tenant writes checklist answers" on public.checklist_answers;
drop policy if exists "tenant manages evidence metadata" on public.evidence;
drop policy if exists "tenant manages signatures" on public.appointment_signatures;
drop policy if exists "tenant manages activities" on public.function_activities;
drop policy if exists "tenant manages services" on public.service_records;

create policy "assigned tech or finalized admin reads appointment checklists" on public.appointment_checklists
for select to authenticated using (private.can_read_appointment_content(appointment_id));
create policy "assigned tech writes draft appointment checklists" on public.appointment_checklists
for all to authenticated using (private.can_edit_appointment_draft(appointment_id)) with check (private.can_edit_appointment_draft(appointment_id));

create policy "assigned tech or finalized admin reads checklist answers" on public.checklist_answers
for select to authenticated using (private.can_read_appointment_content(private.checklist_appointment(appointment_checklist_id)));
create policy "assigned tech writes draft checklist answers" on public.checklist_answers
for all to authenticated using (private.can_edit_appointment_draft(private.checklist_appointment(appointment_checklist_id))) with check (private.can_edit_appointment_draft(private.checklist_appointment(appointment_checklist_id)));

create policy "assigned tech or finalized admin reads evidence" on public.evidence
for select to authenticated using (private.can_read_appointment_content(appointment_id));
create policy "assigned tech writes draft evidence" on public.evidence
for all to authenticated using (private.can_edit_appointment_draft(appointment_id)) with check (private.can_edit_appointment_draft(appointment_id));

create policy "assigned tech or finalized admin reads signatures" on public.appointment_signatures
for select to authenticated using (private.can_read_appointment_content(appointment_id));
create policy "assigned tech writes draft signatures" on public.appointment_signatures
for all to authenticated using (private.can_edit_appointment_draft(appointment_id)) with check (private.can_edit_appointment_draft(appointment_id));

create policy "assigned tech or finalized admin reads activities" on public.function_activities
for select to authenticated using (appointment_id is not null and private.can_read_appointment_content(appointment_id));
create policy "assigned tech writes draft activities" on public.function_activities
for all to authenticated using (appointment_id is not null and private.can_edit_appointment_draft(appointment_id)) with check (appointment_id is not null and private.can_edit_appointment_draft(appointment_id));

create policy "assigned tech or finalized admin reads services" on public.service_records
for select to authenticated using (appointment_id is not null and private.can_read_appointment_content(appointment_id));
create policy "assigned tech writes draft services" on public.service_records
for all to authenticated using (appointment_id is not null and private.can_edit_appointment_draft(appointment_id)) with check (appointment_id is not null and private.can_edit_appointment_draft(appointment_id));

create policy "assigned tech or finalized admin reads notes" on public.appointment_notes
for select to authenticated using (private.can_read_appointment_content(appointment_id));
create policy "assigned tech writes draft notes" on public.appointment_notes
for all to authenticated using (private.can_edit_appointment_draft(appointment_id)) with check (private.can_edit_appointment_draft(appointment_id));

create policy "company members read available services" on public.company_services
for select to authenticated using (private.is_master() or private.belongs_to_company(company_id));
create policy "admins manage company services" on public.company_services
for all to authenticated using (private.is_master() or private.is_company_admin(company_id)) with check (private.is_master() or private.is_company_admin(company_id));

-- Restrict private evidence files using the appointment UUID in the second path
-- segment: <company_id>/<appointment_id>/<object>. Admins cannot fetch draft files.
drop policy if exists "tenant reads private FD files" on storage.objects;
drop policy if exists "tenant uploads private FD files" on storage.objects;
drop policy if exists "tenant updates private FD files" on storage.objects;
drop policy if exists "tenant deletes private FD files" on storage.objects;

create policy "assigned tech or finalized admin reads evidence files" on storage.objects
for select to authenticated using (
  bucket_id = 'fd-sst-evidence'
  and private.can_read_appointment_content((storage.foldername(name))[2]::uuid)
);
create policy "assigned tech uploads draft evidence files" on storage.objects
for insert to authenticated with check (
  bucket_id = 'fd-sst-evidence'
  and private.can_edit_appointment_draft((storage.foldername(name))[2]::uuid)
);
create policy "assigned tech updates draft evidence files" on storage.objects
for update to authenticated using (
  bucket_id = 'fd-sst-evidence'
  and private.can_edit_appointment_draft((storage.foldername(name))[2]::uuid)
) with check (
  bucket_id = 'fd-sst-evidence'
  and private.can_edit_appointment_draft((storage.foldername(name))[2]::uuid)
);
create policy "assigned tech deletes draft evidence files" on storage.objects
for delete to authenticated using (
  bucket_id = 'fd-sst-evidence'
  and private.can_edit_appointment_draft((storage.foldername(name))[2]::uuid)
);

grant select, insert, update, delete on public.company_services, public.appointment_notes to authenticated;
