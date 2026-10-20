-- Technicians use the protected Edge Function for field-work changes. This
-- prevents direct client calls from changing appointment client/company/time
-- fields or forging status history.
drop policy if exists "assigned technicians update appointments" on public.appointments;
drop policy if exists "tenant writes appointment history" on public.appointment_status_history;

create policy "admins write appointment history"
on public.appointment_status_history
for insert to authenticated
with check (private.is_master() or private.is_company_admin(company_id));
