-- Ensure API roles can access tables (RLS still applies).
grant select, insert, update, delete on table public.askmidwife_profiles to anon, authenticated;
grant select, insert, update, delete on table public.askmidwife_provider_availability to anon, authenticated;
grant select, insert, update, delete on table public.askmidwife_appointments to anon, authenticated;
grant select, insert, update, delete on table public.askmidwife_appointment_messages to anon, authenticated;
grant select, insert, update, delete on table public.askmidwife_appointment_payments to anon, authenticated;
