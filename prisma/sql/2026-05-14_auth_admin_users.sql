create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'admin',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create index if not exists admin_users_is_active_idx on public.admin_users (is_active);

create or replace function public.touch_admin_users_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_admin_users_updated_at on public.admin_users;
create trigger trg_admin_users_updated_at
before update on public.admin_users
for each row execute procedure public.touch_admin_users_updated_at();

alter table public.admin_users enable row level security;

drop policy if exists admin_users_service_role_all on public.admin_users;
create policy admin_users_service_role_all
on public.admin_users
for all
to service_role
using (true)
with check (true);

drop policy if exists admin_users_owner_read on public.admin_users;
create policy admin_users_owner_read
on public.admin_users
for select
to authenticated
using (user_id = auth.uid());

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
      and is_active = true
  );
$$;

revoke all on function public.is_admin_user() from public;
grant execute on function public.is_admin_user() to authenticated, service_role;

