-- Enable realtime for appointment messages.
alter publication supabase_realtime add table public.askmidwife_appointment_messages;
alter table public.askmidwife_appointment_messages replica identity full;
