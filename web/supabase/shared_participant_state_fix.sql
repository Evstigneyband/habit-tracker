alter table public.profiles add column if not exists photo_url text;

do $$
begin
  alter table public.daily_entries drop constraint if exists daily_entries_goal_id_entry_date_key;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'daily_entries_goal_user_date_key'
      and conrelid = 'public.daily_entries'::regclass
  ) then
    alter table public.daily_entries
      add constraint daily_entries_goal_user_date_key unique (goal_id, user_id, entry_date);
  end if;
end $$;

insert into public.challenge_members (challenge_id, user_id, role, status)
select id, user_id, 'owner', 'active'
from public.challenges
where status <> 'deleted'
on conflict (challenge_id, user_id) do update
set role = 'owner',
    status = 'active',
    updated_at = now();

grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.challenge_members to service_role;
grant select, insert, update, delete on public.daily_entries to service_role;
