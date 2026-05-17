create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  auth_provider text not null default 'email' check (auth_provider in ('email', 'telegram')),
  telegram_id bigint unique,
  telegram_username text,
  timezone text not null default 'Europe/Podgorica',
  last_active_challenge_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists auth_provider text not null default 'email';
alter table public.profiles add column if not exists telegram_id bigint unique;
alter table public.profiles add column if not exists telegram_username text;

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  duration_days integer not null check (duration_days > 0),
  start_date date not null,
  end_date date not null,
  status text not null default 'active' check (status in ('active', 'archived', 'deleted')),
  total_goals integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.profiles
  add constraint profiles_last_active_challenge_id_fkey
  foreign key (last_active_challenge_id)
  references public.challenges(id)
  on delete set null;

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_type text not null check (goal_type in ('simple', 'time')),
  title text not null,
  target_hours numeric(4, 1),
  sort_order integer not null default 0,
  weight numeric(8, 4) not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (
    (goal_type = 'simple' and target_hours is null)
    or
    (goal_type = 'time' and target_hours is not null and target_hours > 0)
  )
);

create table if not exists public.daily_entries (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  day_number integer not null,
  goal_type text not null check (goal_type in ('simple', 'time')),
  is_checked boolean not null default false,
  target_hours numeric(4, 1),
  actual_hours numeric(4, 1) not null default 0,
  is_completed boolean not null default false,
  completion_percent numeric(5, 2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (goal_id, entry_date)
);

alter table public.profiles enable row level security;
alter table public.challenges enable row level security;
alter table public.goals enable row level security;
alter table public.daily_entries enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.challenges to authenticated;
grant select, insert, update, delete on public.goals to authenticated;
grant select, insert, update, delete on public.daily_entries to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.daily_entries;
exception
  when duplicate_object then null;
end $$;

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can manage own challenges"
  on public.challenges for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage own goals"
  on public.goals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage own entries"
  on public.daily_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
