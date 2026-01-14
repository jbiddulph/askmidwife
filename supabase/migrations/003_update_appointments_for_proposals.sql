-- Allow proposed appointment changes with a reason.
alter table public.askmidwife_appointments
  add column if not exists proposed_reason text;

alter table public.askmidwife_appointments
  drop constraint if exists askmidwife_appointments_status_check;

alter table public.askmidwife_appointments
  add constraint askmidwife_appointments_status_check
    check (status in ('requested', 'proposed', 'confirmed', 'cancelled', 'completed'));
