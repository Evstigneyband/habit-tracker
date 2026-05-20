create table if not exists public.telegram_pending_invites (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique,
  chat_id bigint,
  invite_token text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.telegram_pending_invites enable row level security;

grant select, insert, update, delete on public.telegram_pending_invites to service_role;

drop policy if exists "Service role manages Telegram pending invites" on public.telegram_pending_invites;

create policy "Service role manages Telegram pending invites"
  on public.telegram_pending_invites for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
