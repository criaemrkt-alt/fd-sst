-- FD SST core schema. All tenant data is scoped by company_id and protected by RLS.
create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;

create type public.app_role as enum ('master', 'admin', 'technician');
create type public.company_status as enum ('active', 'inactive');
create type public.appointment_status as enum ('scheduled', 'pending_confirmation', 'confirmed', 'in_progress', 'completed', 'cancelled');
create type public.evidence_risk_level as enum ('low', 'medium', 'high');
create type public.checklist_answer_kind as enum ('conforming', 'non_conforming', 'not_applicable', 'text', 'number', 'option');
create type public.email_delivery_status as enum ('queued', 'sent', 'failed', 'cancelled');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  cnpj text,
  email text,
  phone text,
  address_line text,
  city text,
  state char(2),
  postal_code text,
  logo_path text,
  report_header jsonb not null default '{}'::jsonb,
  status public.company_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create unique index companies_cnpj_unique on public.companies (cnpj) where cnpj is not null;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  global_role public.app_role,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null check (role in ('admin', 'technician')),
  active boolean not null default true,
  job_title text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id)
);
create index company_memberships_user_company_idx on public.company_memberships(user_id, company_id);

-- Safe RLS helpers: not exposed to API roles and limited to the current authenticated user.
create or replace function private.is_master()
returns boolean
language sql stable security definer set search_path = public, auth
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.global_role = 'master' and p.active) $$;

create or replace function private.belongs_to_company(target_company uuid)
returns boolean
language sql stable security definer set search_path = public, auth
as $$ select exists (select 1 from public.company_memberships m where m.company_id = target_company and m.user_id = auth.uid() and m.active) $$;

create or replace function private.is_company_admin(target_company uuid)
returns boolean
language sql stable security definer set search_path = public, auth
as $$ select exists (select 1 from public.company_memberships m where m.company_id = target_company and m.user_id = auth.uid() and m.role = 'admin' and m.active) $$;

revoke all on function private.is_master() from public;
revoke all on function private.belongs_to_company(uuid) from public;
revoke all on function private.is_company_admin(uuid) from public;

create table public.cnae_catalog (
  code text primary key,
  official_description text not null,
  risk_grade smallint check (risk_grade between 1 and 4),
  source_reference text,
  source_url text,
  normative_version text,
  validated_at date,
  created_at timestamptz not null default now()
);

create table public.regulatory_standards (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  normative_reference text,
  source_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cnae_nr_rules (
  id uuid primary key default gen_random_uuid(),
  cnae_code text not null references public.cnae_catalog(code) on delete cascade,
  regulatory_standard_id uuid not null references public.regulatory_standards(id) on delete cascade,
  justification text not null,
  source_reference text not null,
  normative_version text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (cnae_code, regulatory_standard_id)
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  legal_name text,
  cnpj text,
  phone text,
  whatsapp text,
  email text,
  address_line text,
  city text,
  state char(2),
  postal_code text,
  cnae_code text references public.cnae_catalog(code),
  business_activity text,
  notes text,
  risk_grade smallint check (risk_grade between 1 and 4),
  cnae_description_snapshot text,
  cnae_validated_at date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (company_id, cnpj)
);
create index clients_company_name_idx on public.clients(company_id, name);

create table public.client_regulatory_standards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  regulatory_standard_id uuid not null references public.regulatory_standards(id),
  origin text not null check (origin in ('system_suggestion', 'manual')),
  rule_id uuid references public.cnae_nr_rules(id),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (client_id, regulatory_standard_id)
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  service_type text not null,
  description text,
  location_text text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status public.appointment_status not null default 'pending_confirmation',
  confirmation_due_at timestamptz,
  client_confirmed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  check (ends_at is null or ends_at > starts_at)
);
create index appointments_company_starts_idx on public.appointments(company_id, starts_at);
create index appointments_client_idx on public.appointments(client_id);

create table public.appointment_technicians (
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  technician_id uuid not null references auth.users(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id),
  primary key (appointment_id, technician_id)
);
create index appointment_technicians_technician_idx on public.appointment_technicians(technician_id, company_id);

create table public.appointment_status_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  from_status public.appointment_status,
  to_status public.appointment_status not null,
  note text,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id)
);

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  service_type text,
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table public.checklist_template_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(template_id, version_number)
);

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  template_version_id uuid not null references public.checklist_template_versions(id) on delete cascade,
  section_title text,
  prompt text not null,
  response_kind public.checklist_answer_kind not null,
  options jsonb not null default '[]'::jsonb,
  required boolean not null default false,
  sort_order integer not null default 0
);

create table public.appointment_checklists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  template_version_id uuid not null references public.checklist_template_versions(id),
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  unique (appointment_id, template_version_id)
);

create table public.checklist_answers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  appointment_checklist_id uuid not null references public.appointment_checklists(id) on delete cascade,
  checklist_item_id uuid not null references public.checklist_items(id),
  answer jsonb not null default '{}'::jsonb,
  note text,
  answered_at timestamptz not null default now(),
  answered_by uuid references auth.users(id),
  unique (appointment_checklist_id, checklist_item_id)
);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  checklist_answer_id uuid references public.checklist_answers(id) on delete set null,
  storage_bucket text not null,
  storage_path text not null,
  file_name text not null,
  content_type text,
  byte_size bigint,
  media_kind text not null check (media_kind in ('image', 'video', 'document')),
  risk_level public.evidence_risk_level,
  observation text,
  recommendation text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique(storage_bucket, storage_path)
);

create table public.appointment_signatures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  signer_name text not null,
  signer_job_title text,
  storage_bucket text not null,
  storage_path text not null,
  signed_at timestamptz not null default now(),
  captured_by uuid references auth.users(id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  report_type text not null,
  storage_bucket text,
  storage_path text,
  generated_at timestamptz not null default now(),
  generated_by uuid references auth.users(id),
  unique(appointment_id, report_type)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.email_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  recipient_email text not null,
  template_key text not null,
  payload jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null,
  status public.email_delivery_status not null default 'queued',
  attempts integer not null default 0,
  sent_at timestamptz,
  last_error text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table public.appointment_confirmation_tokens (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.function_activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  appointment_id uuid references public.appointments(id),
  role_name text not null,
  worker_name text,
  sector text,
  description text not null,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table public.service_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  appointment_id uuid references public.appointments(id),
  service_name text not null,
  notes text,
  performed_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table public.accident_investigations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  occurred_at timestamptz not null,
  location_text text,
  worker_name text,
  worker_role text,
  occurrence_type text,
  description text not null,
  circumstances text,
  possible_causes text,
  immediate_measures text,
  recommendations text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table public.action_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  accident_investigation_id uuid references public.accident_investigations(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  description text not null,
  responsible_name text,
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.trainings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  name text not null,
  regulatory_standard_id uuid references public.regulatory_standards(id),
  starts_at timestamptz not null,
  location_text text,
  workload_minutes integer check (workload_minutes > 0),
  instructor_name text,
  syllabus text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table public.training_participants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  training_id uuid not null references public.trainings(id) on delete cascade,
  participant_name text not null,
  job_title text,
  present_at timestamptz,
  signature_path text,
  unique(training_id, participant_name)
);

create table public.heat_assessments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  appointment_id uuid references public.appointments(id),
  tbn numeric(5,2),
  tg numeric(5,2),
  tbs numeric(5,2),
  solar_exposure boolean not null default false,
  activity_description text,
  formula_version text,
  calculated_ibutg numeric(5,2),
  validation_status text not null default 'pending_technical_validation' check (validation_status in ('pending_technical_validation', 'validated')),
  notes text,
  measured_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table public.travel_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  appointment_id uuid references public.appointments(id),
  technician_id uuid not null references auth.users(id),
  departed_at timestamptz,
  arrived_at timestamptz,
  ended_at timestamptz,
  distance_km numeric(8,2) check (distance_km >= 0),
  distance_source text check (distance_source in ('manual', 'estimated', 'geolocation')),
  notes text,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

create or replace function public.create_profile_on_signup()
returns trigger language plpgsql security definer set search_path = public
as $$ begin insert into public.profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email)); return new; end $$;

create trigger auth_user_profile_trigger after insert on auth.users for each row execute procedure public.create_profile_on_signup();
create trigger companies_updated_at before update on public.companies for each row execute procedure public.set_updated_at();
create trigger profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger memberships_updated_at before update on public.company_memberships for each row execute procedure public.set_updated_at();
create trigger clients_updated_at before update on public.clients for each row execute procedure public.set_updated_at();
create trigger appointments_updated_at before update on public.appointments for each row execute procedure public.set_updated_at();
create trigger checklist_templates_updated_at before update on public.checklist_templates for each row execute procedure public.set_updated_at();
create trigger accident_investigations_updated_at before update on public.accident_investigations for each row execute procedure public.set_updated_at();

-- RLS is enabled on every private table in the exposed schema.
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.company_memberships enable row level security;
alter table public.cnae_catalog enable row level security;
alter table public.regulatory_standards enable row level security;
alter table public.cnae_nr_rules enable row level security;
alter table public.clients enable row level security;
alter table public.client_regulatory_standards enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_technicians enable row level security;
alter table public.appointment_status_history enable row level security;
alter table public.checklist_templates enable row level security;
alter table public.checklist_template_versions enable row level security;
alter table public.checklist_items enable row level security;
alter table public.appointment_checklists enable row level security;
alter table public.checklist_answers enable row level security;
alter table public.evidence enable row level security;
alter table public.appointment_signatures enable row level security;
alter table public.reports enable row level security;
alter table public.notifications enable row level security;
alter table public.email_queue enable row level security;
alter table public.appointment_confirmation_tokens enable row level security;
alter table public.function_activities enable row level security;
alter table public.service_records enable row level security;
alter table public.accident_investigations enable row level security;
alter table public.action_plans enable row level security;
alter table public.trainings enable row level security;
alter table public.training_participants enable row level security;
alter table public.heat_assessments enable row level security;
alter table public.travel_logs enable row level security;
alter table public.audit_logs enable row level security;

-- Master has global access. Company members can only reach their own tenant.
create policy "master manages companies" on public.companies for all to authenticated using (private.is_master()) with check (private.is_master());
create policy "members read own company" on public.companies for select to authenticated using (private.belongs_to_company(id));
create policy "admins update own company" on public.companies for update to authenticated using (private.is_company_admin(id)) with check (private.is_company_admin(id));
create policy "profiles self read" on public.profiles for select to authenticated using (id = (select auth.uid()) or private.is_master());
create policy "profiles self update" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()) and global_role is null);
create policy "master manages profiles" on public.profiles for all to authenticated using (private.is_master()) with check (private.is_master());
create policy "members see company colleagues" on public.company_memberships for select to authenticated using (user_id = (select auth.uid()) or private.is_master() or private.is_company_admin(company_id));
create policy "master manages memberships" on public.company_memberships for all to authenticated using (private.is_master()) with check (private.is_master());
create policy "admins manage technician memberships" on public.company_memberships for all to authenticated using (private.is_company_admin(company_id) and role = 'technician') with check (private.is_company_admin(company_id) and role = 'technician');
create policy "authenticated reads normative catalog" on public.cnae_catalog for select to authenticated using (true);
create policy "master manages cnae catalog" on public.cnae_catalog for all to authenticated using (private.is_master()) with check (private.is_master());
create policy "authenticated reads nr catalog" on public.regulatory_standards for select to authenticated using (true);
create policy "master manages nr catalog" on public.regulatory_standards for all to authenticated using (private.is_master()) with check (private.is_master());
create policy "authenticated reads cnae rules" on public.cnae_nr_rules for select to authenticated using (true);
create policy "master manages cnae rules" on public.cnae_nr_rules for all to authenticated using (private.is_master()) with check (private.is_master());

-- Shared tenant pattern for operational tables. Admin-only tables have additional write policies below.
create policy "tenant members read clients" on public.clients for select to authenticated using (private.is_master() or private.belongs_to_company(company_id));
create policy "admins manage clients" on public.clients for all to authenticated using (private.is_master() or private.is_company_admin(company_id)) with check (private.is_master() or private.is_company_admin(company_id));
create policy "tenant members read client standards" on public.client_regulatory_standards for select to authenticated using (private.is_master() or private.belongs_to_company(company_id));
create policy "admins manage client standards" on public.client_regulatory_standards for all to authenticated using (private.is_master() or private.is_company_admin(company_id)) with check (private.is_master() or private.is_company_admin(company_id));
create policy "authorized users read appointments" on public.appointments for select to authenticated using (private.is_master() or private.is_company_admin(company_id) or exists (select 1 from public.appointment_technicians t where t.appointment_id = id and t.technician_id = (select auth.uid())));
create policy "admins manage appointments" on public.appointments for all to authenticated using (private.is_master() or private.is_company_admin(company_id)) with check (private.is_master() or private.is_company_admin(company_id));
create policy "assigned technicians update appointments" on public.appointments for update to authenticated using (exists (select 1 from public.appointment_technicians t where t.appointment_id = id and t.technician_id = (select auth.uid()))) with check (private.belongs_to_company(company_id));
create policy "tenant reads appointment technicians" on public.appointment_technicians for select to authenticated using (private.is_master() or private.belongs_to_company(company_id));
create policy "admins manage appointment technicians" on public.appointment_technicians for all to authenticated using (private.is_master() or private.is_company_admin(company_id)) with check (private.is_master() or private.is_company_admin(company_id));
create policy "tenant reads appointment history" on public.appointment_status_history for select to authenticated using (private.is_master() or private.belongs_to_company(company_id));
create policy "tenant writes appointment history" on public.appointment_status_history for insert to authenticated with check (private.is_master() or private.belongs_to_company(company_id));
create policy "tenant reads templates" on public.checklist_templates for select to authenticated using (private.is_master() or private.belongs_to_company(company_id));
create policy "admins manage templates" on public.checklist_templates for all to authenticated using (private.is_master() or private.is_company_admin(company_id)) with check (private.is_master() or private.is_company_admin(company_id));
create policy "tenant reads template versions" on public.checklist_template_versions for select to authenticated using (private.is_master() or private.belongs_to_company(company_id));
create policy "admins manage template versions" on public.checklist_template_versions for all to authenticated using (private.is_master() or private.is_company_admin(company_id)) with check (private.is_master() or private.is_company_admin(company_id));
create policy "tenant reads checklist items" on public.checklist_items for select to authenticated using (private.is_master() or private.belongs_to_company(company_id));
create policy "admins manage checklist items" on public.checklist_items for all to authenticated using (private.is_master() or private.is_company_admin(company_id)) with check (private.is_master() or private.is_company_admin(company_id));
create policy "tenant reads appointment checklists" on public.appointment_checklists for select to authenticated using (private.is_master() or private.belongs_to_company(company_id));
create policy "tenant writes appointment checklists" on public.appointment_checklists for all to authenticated using (private.is_master() or private.belongs_to_company(company_id)) with check (private.is_master() or private.belongs_to_company(company_id));
create policy "tenant reads checklist answers" on public.checklist_answers for select to authenticated using (private.is_master() or private.belongs_to_company(company_id));
create policy "tenant writes checklist answers" on public.checklist_answers for all to authenticated using (private.is_master() or private.belongs_to_company(company_id)) with check (private.is_master() or private.belongs_to_company(company_id));
create policy "tenant manages evidence metadata" on public.evidence for all to authenticated using (private.is_master() or private.belongs_to_company(company_id)) with check (private.is_master() or private.belongs_to_company(company_id));
create policy "tenant manages signatures" on public.appointment_signatures for all to authenticated using (private.is_master() or private.belongs_to_company(company_id)) with check (private.is_master() or private.belongs_to_company(company_id));
create policy "tenant reads reports" on public.reports for select to authenticated using (private.is_master() or private.belongs_to_company(company_id));
create policy "tenant creates reports" on public.reports for insert to authenticated with check (private.is_master() or private.belongs_to_company(company_id));
create policy "users manage own notifications" on public.notifications for select to authenticated using (recipient_id = (select auth.uid()) or private.is_master());
create policy "users mark own notifications" on public.notifications for update to authenticated using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
create policy "tenant inserts notifications" on public.notifications for insert to authenticated with check (private.is_master() or private.belongs_to_company(company_id));
create policy "admins read email queue" on public.email_queue for select to authenticated using (private.is_master() or private.is_company_admin(company_id));
create policy "admins manage email queue" on public.email_queue for all to authenticated using (private.is_master() or private.is_company_admin(company_id)) with check (private.is_master() or private.is_company_admin(company_id));
create policy "tenant manages activities" on public.function_activities for all to authenticated using (private.is_master() or private.belongs_to_company(company_id)) with check (private.is_master() or private.belongs_to_company(company_id));
create policy "tenant manages services" on public.service_records for all to authenticated using (private.is_master() or private.belongs_to_company(company_id)) with check (private.is_master() or private.belongs_to_company(company_id));
create policy "tenant manages investigations" on public.accident_investigations for all to authenticated using (private.is_master() or private.belongs_to_company(company_id)) with check (private.is_master() or private.belongs_to_company(company_id));
create policy "tenant manages action plans" on public.action_plans for all to authenticated using (private.is_master() or private.belongs_to_company(company_id)) with check (private.is_master() or private.belongs_to_company(company_id));
create policy "tenant manages trainings" on public.trainings for all to authenticated using (private.is_master() or private.belongs_to_company(company_id)) with check (private.is_master() or private.belongs_to_company(company_id));
create policy "tenant manages participants" on public.training_participants for all to authenticated using (private.is_master() or private.belongs_to_company(company_id)) with check (private.is_master() or private.belongs_to_company(company_id));
create policy "tenant manages heat assessments" on public.heat_assessments for all to authenticated using (private.is_master() or private.belongs_to_company(company_id)) with check (private.is_master() or private.belongs_to_company(company_id));
create policy "technicians manage own travel" on public.travel_logs for all to authenticated using (technician_id = (select auth.uid()) or private.is_master() or private.is_company_admin(company_id)) with check ((technician_id = (select auth.uid()) and private.belongs_to_company(company_id)) or private.is_master() or private.is_company_admin(company_id));
create policy "admins read audit logs" on public.audit_logs for select to authenticated using (private.is_master() or private.is_company_admin(company_id));

-- Tokens are never readable by regular clients. Confirmation must go through a protected Edge Function.
create policy "master manages confirmation tokens" on public.appointment_confirmation_tokens for all to authenticated using (private.is_master()) with check (private.is_master());

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Private buckets. Object paths must start with the UUID of the tenant: <company_id>/<appointment_id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('fd-sst-evidence', 'fd-sst-evidence', false, 52428800, array['image/jpeg','image/png','image/webp','application/pdf','video/mp4']),
  ('fd-sst-reports', 'fd-sst-reports', false, 52428800, array['application/pdf','image/png'])
on conflict (id) do nothing;

create policy "tenant reads private FD files" on storage.objects for select to authenticated using (
  bucket_id in ('fd-sst-evidence','fd-sst-reports') and (private.is_master() or private.belongs_to_company((storage.foldername(name))[1]::uuid))
);
create policy "tenant uploads private FD files" on storage.objects for insert to authenticated with check (
  bucket_id in ('fd-sst-evidence','fd-sst-reports') and (private.is_master() or private.belongs_to_company((storage.foldername(name))[1]::uuid))
);
create policy "tenant updates private FD files" on storage.objects for update to authenticated using (
  bucket_id in ('fd-sst-evidence','fd-sst-reports') and (private.is_master() or private.belongs_to_company((storage.foldername(name))[1]::uuid))
) with check (
  bucket_id in ('fd-sst-evidence','fd-sst-reports') and (private.is_master() or private.belongs_to_company((storage.foldername(name))[1]::uuid))
);
create policy "tenant deletes private FD files" on storage.objects for delete to authenticated using (
  bucket_id in ('fd-sst-evidence','fd-sst-reports') and (private.is_master() or private.is_company_admin((storage.foldername(name))[1]::uuid))
);
