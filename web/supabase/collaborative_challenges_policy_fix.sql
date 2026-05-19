create or replace function public.is_challenge_member(target_challenge_id uuid, target_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.challenge_members
    where challenge_members.challenge_id = target_challenge_id
      and challenge_members.user_id = target_user_id
      and challenge_members.status = 'active'
  );
$$;

drop policy if exists "Members can read shared challenges" on public.challenges;
drop policy if exists "Users can create own challenges" on public.challenges;
drop policy if exists "Owners can update own challenges" on public.challenges;
drop policy if exists "Owners can delete own challenges" on public.challenges;
drop policy if exists "Users can manage own challenges" on public.challenges;

create policy "Members can read shared challenges"
  on public.challenges for select
  using (
    auth.uid() = user_id
    or public.is_challenge_member(challenges.id, auth.uid())
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

drop policy if exists "Members can read shared goals" on public.goals;
drop policy if exists "Owners can manage challenge goals" on public.goals;
drop policy if exists "Users can manage own goals" on public.goals;

create policy "Members can read shared goals"
  on public.goals for select
  using (
    auth.uid() = user_id
    or public.is_challenge_member(goals.challenge_id, auth.uid())
  );

create policy "Owners can manage challenge goals"
  on public.goals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Members can read shared entries" on public.daily_entries;
drop policy if exists "Members can manage own entries" on public.daily_entries;
drop policy if exists "Users can manage own entries" on public.daily_entries;

create policy "Members can read shared entries"
  on public.daily_entries for select
  using (
    auth.uid() = user_id
    or public.is_challenge_member(daily_entries.challenge_id, auth.uid())
  );

create policy "Members can manage own entries"
  on public.daily_entries for all
  using (
    auth.uid() = user_id
    and public.is_challenge_member(daily_entries.challenge_id, auth.uid())
  )
  with check (
    auth.uid() = user_id
    and public.is_challenge_member(daily_entries.challenge_id, auth.uid())
  );

drop policy if exists "Members can read challenge members" on public.challenge_members;
drop policy if exists "Users can join invited challenges" on public.challenge_members;
drop policy if exists "Owners can create own membership" on public.challenge_members;

create policy "Members can read challenge members"
  on public.challenge_members for select
  using (public.is_challenge_member(challenge_members.challenge_id, auth.uid()));

create policy "Users can join invited challenges"
  on public.challenge_members for insert
  with check (
    auth.uid() = user_id
    and (
      role = 'owner'
      or exists (
        select 1
        from public.challenge_invites
        where challenge_invites.challenge_id = challenge_members.challenge_id
          and challenge_invites.status = 'active'
          and (challenge_invites.expires_at is null or challenge_invites.expires_at > now())
      )
    )
  );

drop policy if exists "Owners can create invites" on public.challenge_invites;
drop policy if exists "Authenticated users can read active invites" on public.challenge_invites;
drop policy if exists "Invite creators can update invites" on public.challenge_invites;

create policy "Owners can create invites"
  on public.challenge_invites for insert
  with check (
    auth.uid() = created_by
    and exists (
      select 1
      from public.challenges
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

drop policy if exists "Shared challenge members can read profiles" on public.profiles;

create policy "Shared challenge members can read profiles"
  on public.profiles for select
  using (
    auth.uid() = id
    or exists (
      select 1
      from public.challenge_members theirs
      where theirs.user_id = profiles.id
        and theirs.status = 'active'
        and public.is_challenge_member(theirs.challenge_id, auth.uid())
    )
  );
