-- Preserve the CNAE typed by a technician even before the administrator has
-- loaded/validated the official CNAE catalogue used by the foreign key.
alter table public.clients add column if not exists cnae_input text;

comment on column public.clients.cnae_input is 'CNAE informed in the field; pending catalogue validation when cnae_code is null.';
