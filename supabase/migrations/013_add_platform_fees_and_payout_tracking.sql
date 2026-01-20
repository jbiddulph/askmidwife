-- Track payout status on appointment payments.
alter table public.askmidwife_appointment_payments
add column if not exists payout_request_id uuid references public.askmidwife_payout_requests(id),
add column if not exists payout_status text check (payout_status in ('pending', 'paid', 'failed')),
add column if not exists payout_paid_at timestamptz;

create index if not exists askmidwife_appointment_payments_payout_request_id_idx
  on public.askmidwife_appointment_payments (payout_request_id);

create index if not exists askmidwife_appointment_payments_payout_status_idx
  on public.askmidwife_appointment_payments (payout_status);

-- Record platform fees (15%) per consultation.
create table if not exists public.askmidwife_platform_fees (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.askmidwife_appointments(id) on delete cascade,
  payment_id uuid references public.askmidwife_appointment_payments(id) on delete set null,
  amount_gbp numeric(10,2) not null check (amount_gbp >= 0),
  status text not null default 'earned' check (status in ('earned', 'pending', 'paid')),
  payout_request_id uuid references public.askmidwife_payout_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create unique index if not exists askmidwife_platform_fees_appointment_id_idx
  on public.askmidwife_platform_fees (appointment_id);

create index if not exists askmidwife_platform_fees_status_idx
  on public.askmidwife_platform_fees (status);

-- Enable RLS.
alter table public.askmidwife_platform_fees enable row level security;

-- Platform fee policies (admin only).
drop policy if exists askmidwife_admin_platform_fees_select on public.askmidwife_platform_fees;
drop policy if exists askmidwife_admin_platform_fees_insert on public.askmidwife_platform_fees;
drop policy if exists askmidwife_admin_platform_fees_update on public.askmidwife_platform_fees;

create policy askmidwife_admin_platform_fees_select
  on public.askmidwife_platform_fees
  for select
  using (
    exists (
      select 1
      from public.askmidwife_profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy askmidwife_admin_platform_fees_insert
  on public.askmidwife_platform_fees
  for insert
  with check (
    exists (
      select 1
      from public.askmidwife_profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy askmidwife_admin_platform_fees_update
  on public.askmidwife_platform_fees
  for update
  using (
    exists (
      select 1
      from public.askmidwife_profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Grant table access (RLS still applies).
grant select, insert, update, delete on table public.askmidwife_platform_fees to anon, authenticated, service_role;
