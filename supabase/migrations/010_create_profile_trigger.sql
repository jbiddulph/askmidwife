-- Create a basic profile automatically when a new auth user is created.
create or replace function public.askmidwife_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.askmidwife_profiles (id, email, display_name, role)
  values (new.id, new.email, null, 'client')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists askmidwife_on_auth_user_created on auth.users;

create trigger askmidwife_on_auth_user_created
after insert on auth.users
for each row
execute function public.askmidwife_handle_new_user();
