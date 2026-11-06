-- Omertà: online rooms and host accounts. Run in Supabase → SQL Editor. Safe to run again at any time.
-- Browsers never read these tables: only the Vercel functions do, with the secret key.

-- Online rooms ------------------------------------------------------------------------------------
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

-- Night choices sent from players' phones, when the Game Master allows it: one row per role step per night.
create table if not exists public.night_actions (
  room_code  text not null references public.rooms(code) on delete cascade,
  night_key  text not null,
  step_key   text not null,
  seat_id    text not null,
  ab         text,
  targets    jsonb not null default '[]'::jsonb,
  opts       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (room_code, night_key, step_key)
);

-- The silent chat for the Mafia (and Vampires) on their phones.
create table if not exists public.chat_messages (
  id         bigint generated always as identity primary key,
  room_code  text not null references public.rooms(code) on delete cascade,
  channel    text not null,
  seat_id    text not null,
  name       text not null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_room_idx on public.chat_messages (room_code, channel, id desc);

-- Host accounts -----------------------------------------------------------------------------------
-- Passwords and recovery codes are stored only as scrypt hashes; sessions only as SHA-256 hashes.
create table if not exists public.hosts (
  id            uuid primary key,
  username      text not null unique,
  display_name  text not null,
  pass_hash     text not null,
  recovery_hash text not null,
  failed_logins int  not null default 0,
  locked_until  timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists public.host_sessions (
  token_hash text primary key,
  host_id    uuid not null references public.hosts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists host_sessions_host_idx on public.host_sessions (host_id);

-- A host's library: saved role setups, player groups, custom roles and games.
create table if not exists public.host_items (
  id         uuid primary key,
  host_id    uuid not null references public.hosts(id) on delete cascade,
  kind       text not null check (kind in ('setup', 'group', 'role', 'game')),
  name       text not null,
  meta       jsonb not null default '{}'::jsonb,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists host_items_host_idx on public.host_items (host_id, kind, updated_at desc);

-- Lock everything: row level security on with no policies, and no rights for public roles.
alter table public.rooms enable row level security;
alter table public.seats enable row level security;
alter table public.votes enable row level security;
alter table public.night_actions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.hosts enable row level security;
alter table public.host_sessions enable row level security;
alter table public.host_items enable row level security;
revoke all on public.rooms, public.seats, public.votes, public.night_actions, public.chat_messages, public.hosts, public.host_sessions, public.host_items from anon, authenticated;

-- The Vercel functions use the secret (service_role) key. Grant it access explicitly so this also works on
-- projects where new tables are not opened to the Data API automatically.
grant usage on schema public to service_role;
grant all on public.rooms, public.seats, public.votes, public.night_actions, public.chat_messages, public.hosts, public.host_sessions, public.host_items to service_role;
grant usage, select on all sequences in schema public to service_role;
