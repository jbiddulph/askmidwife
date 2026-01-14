-- Allow signed-in users to list medical professionals.
create policy "Medical profiles readable by signed-in users"
  on public.askmidwife_profiles
  for select
  using (auth.uid() is not null and role = 'medical');
