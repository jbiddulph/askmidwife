-- Appointment chat messages.
create table if not exists public.askmidwife_appointment_messages (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.askmidwife_appointments(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists askmidwife_appointment_messages_appointment_id_idx
  on public.askmidwife_appointment_messages (appointment_id, created_at);

alter table public.askmidwife_appointment_messages enable row level security;

create policy "Appointment messages readable by participants"
  on public.askmidwife_appointment_messages
  for select
  using (
    exists (
      select 1
      from public.askmidwife_appointments
      where id = appointment_id
        and (patient_id = auth.uid() or provider_id = auth.uid())
    )
  );

create policy "Appointment messages insertable by participants"
  on public.askmidwife_appointment_messages
  for insert
  with check (
    exists (
      select 1
      from public.askmidwife_appointments
      where id = appointment_id
        and (patient_id = auth.uid() or provider_id = auth.uid())
    )
  );
