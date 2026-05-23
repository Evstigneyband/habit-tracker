create table if not exists public.user_award_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'day_completed_100',
      'challenge_completed',
      'friend_battle_win'
    )
  ),
  event_date date not null,
  challenge_id uuid references public.challenges(id) on delete set null,
  goal_id uuid references public.goals(id) on delete set null,
  value numeric(8, 2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.user_awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  award_id text not null,
  unlocked_at timestamptz not null default now(),
  source_challenge_id uuid references public.challenges(id) on delete set null,
  source_event_id uuid references public.user_award_events(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, award_id)
);

create unique index if not exists user_award_events_day_completed_once
  on public.user_award_events (user_id, event_type, event_date)
  where event_type = 'day_completed_100';

create unique index if not exists user_award_events_challenge_completed_once
  on public.user_award_events (user_id, event_type, challenge_id)
  where event_type = 'challenge_completed' and challenge_id is not null;

create unique index if not exists user_award_events_friend_battle_win_once
  on public.user_award_events (user_id, event_type, challenge_id)
  where event_type = 'friend_battle_win' and challenge_id is not null;

create index if not exists user_award_events_user_date_idx
  on public.user_award_events (user_id, event_date);

alter table public.user_award_events enable row level security;
alter table public.user_awards enable row level security;

grant select on public.user_award_events to authenticated;
grant select on public.user_awards to authenticated;
grant select, insert, update, delete on public.user_award_events to service_role;
grant select, insert, update, delete on public.user_awards to service_role;

drop policy if exists "Users can read own award events" on public.user_award_events;
create policy "Users can read own award events"
  on public.user_award_events for select
  using (auth.uid() = user_id);

drop policy if exists "Users can read own awards" on public.user_awards;
create policy "Users can read own awards"
  on public.user_awards for select
  using (auth.uid() = user_id);
