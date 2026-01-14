-- Appointment booking tables (askmidwife_ prefix).
create table if not exists public.askmidwife_provider_availability (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_blocked boolean not null default false,
  created_at timestamptz not null default now(),
  constraint askmidwife_availability_time_check check (ends_at > starts_at)
);

create table if not exists public.askmidwife_appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'requested',
  notes text,
  created_at timestamptz not null default now(),
  constraint askmidwife_appointments_status_check
    check (status in ('requested', 'confirmed', 'cancelled', 'completed')),
  constraint askmidwife_appointments_time_check check (ends_at > starts_at)
);

alter table public.askmidwife_provider_availability enable row level security;
alter table public.askmidwife_appointments enable row level security;

create policy "Availability readable by signed-in users"
  on public.askmidwife_provider_availability
  for select
  using (auth.uid() is not null);

create policy "Providers manage their availability"
  on public.askmidwife_provider_availability
  for all
  using (auth.uid() = provider_id)
  with check (auth.uid() = provider_id);

create policy "Appointments readable by participants"
  on public.askmidwife_appointments
  for select
  using (auth.uid() = patient_id or auth.uid() = provider_id);

create policy "Patients can request appointments"
  on public.askmidwife_appointments
  for insert
  with check (auth.uid() = patient_id);

create policy "Participants can update their appointments"
  on public.askmidwife_appointments
  for update
  using (auth.uid() = patient_id or auth.uid() = provider_id);

create policy "Patients can cancel their appointments"
  on public.askmidwife_appointments
  for delete
  using (auth.uid() = patient_id);
