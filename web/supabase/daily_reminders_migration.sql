alter table public.profiles add column if not exists last_seen_at timestamptz;

create table if not exists public.telegram_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  telegram_id bigint not null,
  reminder_type text not null default 'daily_open_challenge',
  reminder_date date not null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, reminder_type, reminder_date)
);

alter table public.telegram_reminders enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.challenges to service_role;
grant select, insert, update, delete on public.goals to service_role;
grant select, insert, update, delete on public.daily_entries to service_role;
grant select, insert, update, delete on public.telegram_reminders to service_role;

grant select, insert, update, delete on public.telegram_reminders to authenticated;

do $$
begin
  create policy "Users can read own reminders"
    on public.telegram_reminders for select
    using (auth.uid() = user_id);
exception
  when duplicate_object then null;
end $$;
