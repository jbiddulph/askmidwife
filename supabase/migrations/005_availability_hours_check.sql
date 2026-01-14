-- Restrict availability slots to 07:30-18:00 and same-day windows.
alter table public.askmidwife_provider_availability
  drop constraint if exists askmidwife_availability_hours_check;

alter table public.askmidwife_provider_availability
  add constraint askmidwife_availability_hours_check
    check (
      date_trunc('day', starts_at) = date_trunc('day', ends_at)
      and starts_at::time >= time '07:30'
      and ends_at::time <= time '18:00'
    );
