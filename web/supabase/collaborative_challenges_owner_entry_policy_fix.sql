create or replace function public.is_challenge_owner(target_challenge_id uuid, target_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.challenges
    where challenges.id = target_challenge_id
      and challenges.user_id = target_user_id
      and challenges.status <> 'deleted'
  );
$$;

insert into public.challenge_members (challenge_id, user_id, role, status)
select id, user_id, 'owner', 'active'
from public.challenges
where status <> 'deleted'
on conflict (challenge_id, user_id) do update
set role = 'owner',
    status = 'active',
    updated_at = now();

drop policy if exists "Members can read shared entries" on public.daily_entries;
drop policy if exists "Members can manage own entries" on public.daily_entries;
drop policy if exists "Users can manage own entries" on public.daily_entries;

create policy "Members can read shared entries"
  on public.daily_entries for select
  using (
    auth.uid() = user_id
    or public.is_challenge_owner(daily_entries.challenge_id, auth.uid())
    or public.is_challenge_member(daily_entries.challenge_id, auth.uid())
  );

create policy "Members can manage own entries"
  on public.daily_entries for all
  using (
    auth.uid() = user_id
    and (
      public.is_challenge_owner(daily_entries.challenge_id, auth.uid())
      or public.is_challenge_member(daily_entries.challenge_id, auth.uid())
    )
  )
  with check (
    auth.uid() = user_id
    and (
      public.is_challenge_owner(daily_entries.challenge_id, auth.uid())
      or public.is_challenge_member(daily_entries.challenge_id, auth.uid())
    )
  );

drop policy if exists "Members can read challenge members" on public.challenge_members;
drop policy if exists "Users can join invited challenges" on public.challenge_members;
drop policy if exists "Owners can create own membership" on public.challenge_members;

create policy "Members can read challenge members"
  on public.challenge_members for select
  using (
    public.is_challenge_owner(challenge_members.challenge_id, auth.uid())
    or public.is_challenge_member(challenge_members.challenge_id, auth.uid())
  );

create policy "Users can join invited challenges"
  on public.challenge_members for insert
  with check (
    auth.uid() = user_id
    and (
      (
        role = 'owner'
        and public.is_challenge_owner(challenge_members.challenge_id, auth.uid())
      )
      or exists (
        select 1
        from public.challenge_invites
        where challenge_invites.challenge_id = challenge_members.challenge_id
          and challenge_invites.status = 'active'
          and (challenge_invites.expires_at is null or challenge_invites.expires_at > now())
      )
    )
  );
