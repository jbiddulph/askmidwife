-- Starter schema with the askmidwife_ prefix.
create table if not exists public.askmidwife_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'client',
  created_at timestamptz not null default now(),
  constraint askmidwife_profiles_role_check
    check (role in ('medical', 'client', 'admin'))
);

alter table public.askmidwife_profiles enable row level security;

create policy "Profiles are readable by the owner"
  on public.askmidwife_profiles
  for select
  using (auth.uid() = id);

create policy "Profiles are insertable by the owner"
  on public.askmidwife_profiles
  for insert
  with check (auth.uid() = id);

create policy "Profiles are updatable by the owner"
  on public.askmidwife_profiles
  for update
  using (auth.uid() = id);

create policy "Profiles are deletable by the owner"
  on public.askmidwife_profiles
  for delete
  using (auth.uid() = id);
