-- Add hourly pay for medical professionals and store appointment payments.
alter table public.askmidwife_profiles
  add column if not exists hourly_pay_gbp numeric(10, 2);

alter table public.askmidwife_profiles
  drop constraint if exists askmidwife_profiles_hourly_pay_check;

alter table public.askmidwife_profiles
  add constraint askmidwife_profiles_hourly_pay_check
    check (hourly_pay_gbp is null or hourly_pay_gbp >= 0);

create table if not exists public.askmidwife_appointment_payments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.askmidwife_appointments(id) on delete cascade,
  patient_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null references auth.users(id) on delete cascade,
  currency text not null default 'GBP',
  hourly_rate_gbp numeric(10, 2) not null,
  duration_minutes integer not null,
  gross_amount_gbp numeric(10, 2) not null,
  platform_fee_gbp numeric(10, 2) not null,
  provider_earnings_gbp numeric(10, 2) not null,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint askmidwife_appointment_payments_duration_check check (duration_minutes > 0),
  constraint askmidwife_appointment_payments_currency_check check (currency = 'GBP'),
  constraint askmidwife_appointment_payments_amount_check check (
    gross_amount_gbp = round((hourly_rate_gbp * duration_minutes::numeric) / 60, 2)
    and platform_fee_gbp = round(gross_amount_gbp * 0.15, 2)
    and provider_earnings_gbp = gross_amount_gbp - platform_fee_gbp
  ),
  constraint askmidwife_appointment_payments_status_check
    check (status in ('pending', 'paid', 'refunded'))
);

create unique index if not exists askmidwife_appointment_payments_appointment_id_idx
  on public.askmidwife_appointment_payments (appointment_id);

create index if not exists askmidwife_appointment_payments_provider_id_idx
  on public.askmidwife_appointment_payments (provider_id, created_at);

create index if not exists askmidwife_appointment_payments_patient_id_idx
  on public.askmidwife_appointment_payments (patient_id, created_at);

alter table public.askmidwife_appointment_payments enable row level security;

create policy "Payments readable by participants"
  on public.askmidwife_appointment_payments
  for select
  using (auth.uid() = patient_id or auth.uid() = provider_id);
