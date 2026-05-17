alter table public.profiles add column if not exists auth_provider text not null default 'email';
alter table public.profiles add column if not exists telegram_id bigint unique;
alter table public.profiles add column if not exists telegram_username text;
