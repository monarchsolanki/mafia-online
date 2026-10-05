-- Omertà online rooms. Run once in Supabase → SQL Editor.
-- Browsers never read these tables: only the Vercel function does, with the secret key.

create table if not exists public.rooms (
  code        text primary key,
  host_hash   text not null,
  version     bigint not null default 0,
  public_view jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.seats (
  room_code  text not null references public.rooms(code) on delete cascade,
  seat_id    text not null,
  ord        int  not null default 0,
  name       text not null,
  view       jsonb not null default '{}'::jsonb,
  token_hash text,
  claimed_at timestamptz,
  seen_at    timestamptz,
  primary key (room_code, seat_id)
);

create table if not exists public.votes (
  room_code  text not null references public.rooms(code) on delete cascade,
  seat_id    text not null,
  vote_key   text not null,
  target     text,
  updated_at timestamptz not null default now(),
  primary key (room_code, seat_id, vote_key)
);

-- Lock the tables: row level security on with no policies, and no rights for public roles.
alter table public.rooms enable row level security;
alter table public.seats enable row level security;
alter table public.votes enable row level security;
revoke all on public.rooms, public.seats, public.votes from anon, authenticated;
