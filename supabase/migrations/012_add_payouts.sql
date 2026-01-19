-- Add PayPal email to profiles for payout linkage.
alter table public.askmidwife_profiles
add column if not exists paypal_email text;

-- Payout requests from medical professionals.
create table if not exists public.askmidwife_payout_requests (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.askmidwife_profiles(id) on delete cascade,
  amount_gbp numeric(10,2) not null check (amount_gbp >= 0),
  paypal_email text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'rejected', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists askmidwife_payout_requests_provider_id_idx
  on public.askmidwife_payout_requests (provider_id);

create index if not exists askmidwife_payout_requests_status_idx
  on public.askmidwife_payout_requests (status);

-- Payout payments (manual or PayPal).
create table if not exists public.askmidwife_payout_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.askmidwife_payout_requests(id) on delete set null,
  provider_id uuid not null references public.askmidwife_profiles(id) on delete cascade,
  amount_gbp numeric(10,2) not null check (amount_gbp >= 0),
  payout_provider text not null check (payout_provider in ('manual', 'paypal')),
  payout_reference text,
  status text not null default 'paid' check (status in ('pending', 'paid', 'failed')),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists askmidwife_payout_payments_provider_id_idx
  on public.askmidwife_payout_payments (provider_id);

create index if not exists askmidwife_payout_payments_request_id_idx
  on public.askmidwife_payout_payments (request_id);

-- Enable RLS.
alter table public.askmidwife_payout_requests enable row level security;
alter table public.askmidwife_payout_payments enable row level security;

-- Payout request policies.
create policy askmidwife_admin_payout_requests_select
  on public.askmidwife_payout_requests
  for select
  using (
    exists (
      select 1
      from public.askmidwife_profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy askmidwife_provider_payout_requests_select
  on public.askmidwife_payout_requests
  for select
  using (provider_id = auth.uid());

create policy askmidwife_provider_payout_requests_insert
  on public.askmidwife_payout_requests
  for insert
  with check (
    provider_id = auth.uid()
    and status = 'pending'
  );

create policy askmidwife_admin_payout_requests_update
  on public.askmidwife_payout_requests
  for update
  using (
    exists (
      select 1
      from public.askmidwife_profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Payout payment policies.
create policy askmidwife_admin_payout_payments_select
  on public.askmidwife_payout_payments
  for select
  using (
    exists (
      select 1
      from public.askmidwife_profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy askmidwife_provider_payout_payments_select
  on public.askmidwife_payout_payments
  for select
  using (provider_id = auth.uid());

create policy askmidwife_admin_payout_payments_insert
  on public.askmidwife_payout_payments
  for insert
  with check (
    exists (
      select 1
      from public.askmidwife_profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy askmidwife_admin_payout_payments_update
  on public.askmidwife_payout_payments
  for update
  using (
    exists (
      select 1
      from public.askmidwife_profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Grant table access (RLS still applies).
grant select, insert, update, delete on table public.askmidwife_payout_requests to anon, authenticated, service_role;
grant select, insert, update, delete on table public.askmidwife_payout_payments to anon, authenticated, service_role;
