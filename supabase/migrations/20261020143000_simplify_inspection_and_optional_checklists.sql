-- The technician's inspection is a quick photo + observation record.
-- Checklist use remains available as support, but never blocks finalization.
alter table public.evidence
  add column if not exists location_text text;

update public.checklist_items
set required = false
where required = true;

update public.cnae_checklist_profile_items
set required = false
where required = true;
