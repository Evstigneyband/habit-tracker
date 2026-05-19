create table if not exists public.challenge_members (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'active' check (status in ('active', 'left', 'removed')),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (challenge_id, user_id)
);

create table if not exists public.challenge_invites (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  challenge_title text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

insert into public.challenge_members (challenge_id, user_id, role, status)
select id, user_id, 'owner', 'active'
from public.challenges
where status <> 'deleted'
on conflict (challenge_id, user_id) do nothing;

alter table public.challenge_members enable row level security;
alter table public.challenge_invites enable row level security;

grant select, insert, update, delete on public.challenge_members to authenticated;
grant select, insert, update, delete on public.challenge_invites to authenticated;
grant select, insert, update, delete on public.challenge_members to service_role;
grant select, insert, update, delete on public.challenge_invites to service_role;

do $$
begin
  alter table public.daily_entries drop constraint if exists daily_entries_goal_id_entry_date_key;
  alter table public.daily_entries add constraint daily_entries_goal_user_date_key unique (goal_id, user_id, entry_date);
exception
  when duplicate_table then null;
end $$;

drop policy if exists "Users can manage own challenges" on public.challenges;
drop policy if exists "Users can manage own goals" on public.goals;
drop policy if exists "Users can manage own entries" on public.daily_entries;

create policy "Members can read shared challenges"
  on public.challenges for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.challenge_members
      where challenge_members.challenge_id = challenges.id
        and challenge_members.user_id = auth.uid()
        and challenge_members.status = 'active'
    )
  );

create policy "Users can create own challenges"
  on public.challenges for insert
  with check (auth.uid() = user_id);

create policy "Owners can update own challenges"
  on public.challenges for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Owners can delete own challenges"
  on public.challenges for delete
  using (auth.uid() = user_id);

create policy "Members can read shared goals"
  on public.goals for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.challenge_members
      where challenge_members.challenge_id = goals.challenge_id
        and challenge_members.user_id = auth.uid()
        and challenge_members.status = 'active'
    )
  );

create policy "Owners can manage challenge goals"
  on public.goals for all
  using (
    exists (
      select 1 from public.challenges
      where challenges.id = goals.challenge_id
        and challenges.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.challenges
      where challenges.id = goals.challenge_id
        and challenges.user_id = auth.uid()
    )
  );

create policy "Members can read shared entries"
  on public.daily_entries for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.challenge_members
      where challenge_members.challenge_id = daily_entries.challenge_id
        and challenge_members.user_id = auth.uid()
        and challenge_members.status = 'active'
    )
  );

create policy "Members can manage own entries"
  on public.daily_entries for all
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.challenge_members
      where challenge_members.challenge_id = daily_entries.challenge_id
        and challenge_members.user_id = auth.uid()
        and challenge_members.status = 'active'
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.challenge_members
      where challenge_members.challenge_id = daily_entries.challenge_id
        and challenge_members.user_id = auth.uid()
        and challenge_members.status = 'active'
    )
  );

create policy "Members can read challenge members"
  on public.challenge_members for select
  using (
    exists (
      select 1 from public.challenge_members viewer
      where viewer.challenge_id = challenge_members.challenge_id
        and viewer.user_id = auth.uid()
        and viewer.status = 'active'
    )
  );

create policy "Users can join invited challenges"
  on public.challenge_members for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.challenge_invites
      where challenge_invites.challenge_id = challenge_members.challenge_id
        and challenge_invites.status = 'active'
        and (challenge_invites.expires_at is null or challenge_invites.expires_at > now())
    )
  );

create policy "Owners can create own membership"
  on public.challenge_members for insert
  with check (
    auth.uid() = user_id
    and role = 'owner'
    and exists (
      select 1 from public.challenges
      where challenges.id = challenge_members.challenge_id
        and challenges.user_id = auth.uid()
    )
  );

create policy "Owners can create invites"
  on public.challenge_invites for insert
  with check (
    auth.uid() = created_by
    and exists (
      select 1 from public.challenges
      where challenges.id = challenge_invites.challenge_id
        and challenges.user_id = auth.uid()
    )
  );

create policy "Authenticated users can read active invites"
  on public.challenge_invites for select
  using (
    status = 'active'
    and (expires_at is null or expires_at > now())
  );

create policy "Invite creators can update invites"
  on public.challenge_invites for update
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

create policy "Shared challenge members can read profiles"
  on public.profiles for select
  using (
    auth.uid() = id
    or exists (
      select 1
      from public.challenge_members mine
      join public.challenge_members theirs on theirs.challenge_id = mine.challenge_id
      where mine.user_id = auth.uid()
        and theirs.user_id = profiles.id
        and mine.status = 'active'
        and theirs.status = 'active'
    )
  );
