alter table public.clients add column if not exists cnae_input text;
alter table public.checklist_templates add column if not exists cnae_profile_id uuid;
alter table public.checklist_templates add column if not exists source_label text;
alter table public.checklist_items add column if not exists guidance text;

create table if not exists public.cnae_checklist_profiles (
  id uuid primary key default gen_random_uuid(),
  cnae_prefix text not null default '' check (cnae_prefix ~ '^[0-9]*$'),
  title text not null,
  description text not null,
  technical_notice text not null,
  revision integer not null default 1 check (revision > 0),
  active boolean not null default true,
  source_reference text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (cnae_prefix, title, revision)
);

create table if not exists public.cnae_checklist_profile_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.cnae_checklist_profiles(id) on delete cascade,
  regulatory_standard_code text,
  section_title text not null,
  prompt text not null,
  guidance text,
  required boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (profile_id, sort_order)
);

create table if not exists public.company_cnae_checklist_cache (
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.cnae_checklist_profiles(id) on delete restrict,
  profile_revision integer not null,
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  template_version_id uuid not null references public.checklist_template_versions(id) on delete cascade,
  provisioned_at timestamptz not null default now(),
  primary key (company_id, profile_id, profile_revision),
  unique (template_id),
  unique (template_version_id)
);

alter table public.checklist_templates
  drop constraint if exists checklist_templates_cnae_profile_id_fkey,
  add constraint checklist_templates_cnae_profile_id_fkey
  foreign key (cnae_profile_id) references public.cnae_checklist_profiles(id) on delete set null;

create index if not exists cnae_checklist_profile_items_profile_order_idx on public.cnae_checklist_profile_items(profile_id, sort_order);
create index if not exists company_cnae_checklist_cache_company_idx on public.company_cnae_checklist_cache(company_id);

alter table public.cnae_checklist_profiles enable row level security;
alter table public.cnae_checklist_profile_items enable row level security;
alter table public.company_cnae_checklist_cache enable row level security;

drop policy if exists "authenticated users read CNAE checklist profiles" on public.cnae_checklist_profiles;
create policy "authenticated users read CNAE checklist profiles" on public.cnae_checklist_profiles for select to authenticated using (true);
drop policy if exists "authenticated users read CNAE checklist profile items" on public.cnae_checklist_profile_items;
create policy "authenticated users read CNAE checklist profile items" on public.cnae_checklist_profile_items for select to authenticated using (true);
drop policy if exists "master manages CNAE checklist profiles" on public.cnae_checklist_profiles;
create policy "master manages CNAE checklist profiles" on public.cnae_checklist_profiles for all to authenticated using (private.is_master()) with check (private.is_master());
drop policy if exists "master manages CNAE checklist profile items" on public.cnae_checklist_profile_items;
create policy "master manages CNAE checklist profile items" on public.cnae_checklist_profile_items for all to authenticated using (private.is_master()) with check (private.is_master());
drop policy if exists "company members read own CNAE checklist cache" on public.company_cnae_checklist_cache;
create policy "company members read own CNAE checklist cache" on public.company_cnae_checklist_cache for select to authenticated using (private.is_master() or private.belongs_to_company(company_id));

grant select on public.cnae_checklist_profiles, public.cnae_checklist_profile_items, public.company_cnae_checklist_cache to authenticated;
