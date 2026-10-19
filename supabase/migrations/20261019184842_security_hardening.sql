-- Functions used only by triggers must never be callable through the Data API.
alter function public.set_updated_at() set search_path = public;
revoke execute on function public.create_profile_on_signup() from public, anon, authenticated;
