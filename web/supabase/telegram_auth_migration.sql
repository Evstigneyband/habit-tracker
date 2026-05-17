alter table public.profiles add column if not exists auth_provider text not null default 'email';
alter table public.profiles add column if not exists telegram_id bigint unique;
alter table public.profiles add column if not exists telegram_username text;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.challenges to service_role;
grant select, insert, update, delete on public.goals to service_role;
grant select, insert, update, delete on public.daily_entries to service_role;
