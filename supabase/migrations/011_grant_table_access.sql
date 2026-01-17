-- Ensure API roles can access tables (RLS still applies).
-- First grant USAGE on the public schema (required before table access)
grant usage on schema public to anon, authenticated, service_role;

-- Then grant table permissions (service_role also needs grants, even though it bypasses RLS)
grant select, insert, update, delete on table public.askmidwife_profiles to anon, authenticated, service_role;
grant select, insert, update, delete on table public.askmidwife_provider_availability to anon, authenticated, service_role;
grant select, insert, update, delete on table public.askmidwife_appointments to anon, authenticated, service_role;
grant select, insert, update, delete on table public.askmidwife_appointment_messages to anon, authenticated, service_role;
grant select, insert, update, delete on table public.askmidwife_appointment_payments to anon, authenticated, service_role;

-- Also grant on any sequences (for future use)
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
