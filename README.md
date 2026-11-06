# Omertà — Mafia, run from one phone or played on everyone's

The Game Master runs the game on one phone: secret roles, a guided night, rulings by the book, and an
announcement scene for every death. Players can also join on their own phones to see **their own role**,
**their own night results**, the **morning announcement** and **the vote** — and, if the Game Master allows it,
make their **night choices** there too, with a **silent chat** for the Mafia.

Hosts can sign in (username and password, no email) so saved setups, player groups, custom roles and games
follow them to any device.

## How it fits together

```
Game Master's phone (/)  ──sync after every action──▶  /api/room  ──▶  Supabase (Postgres)
   ▲  rules engine runs here                             stores each player's slice     rooms · seats · votes
   │  votes and night choices flow back in               hands each phone ONLY its own  night_actions · chat_messages
Player phones (/play)  ◀──"something changed" ping (no secrets) via Supabase Realtime──

Host account (/api/auth, /api/library)  ──▶  hosts · host_sessions · host_items
```

- The Game Master's phone is the brain: it computes every player's private slice and uploads it.
- Each phone gets a secret token when its player taps their name. The server only ever returns the slice that
  matches that token, so a player cannot read anyone else's role, even with developer tools.
- Night choices sent from phones are checked twice: by the server against the options the Game Master's phone
  offered that player, and again by the rules engine on the Game Master's phone before they count.
- The Mafia chat is only readable by living members of that faction (and, read-only, by the Game Master).
- Who died stays hidden on phones until the Game Master starts the day. Night results arrive at the same moment.
- If live updates can't connect, phones fall back to checking every few seconds. The game still works.

## Project structure

```
app/                        Next.js App Router
├── page.tsx                The Game Master's app (client only)
├── play/page.tsx           The player's phone app (client only)
├── api/room/route.ts       Online rooms: create, sync, claim, view, vote, act (night choices), chat, diagnose
├── api/auth/route.ts       Host accounts: sign up, log in, recover with the recovery code, log out
├── api/library/route.ts    A signed-in host's saved setups, groups, custom roles and games
├── globals.css · fx.css    The “Afterglow” design system and the death / win animations
└── layout.tsx              Fonts (self-hosted Bricolage Grotesque), metadata, theme colour
components/
├── gm/                     Game Master screens: Home, Setup, Game (night · dawn · day · end), Players, Roles, Rules, sheets
├── player/PlayerApp.tsx    Player phone: join, role card, night choices, Mafia chat, announcements, vote, results
├── fx/                     DeathScene (heartbeat, flatline, colour drain) · RoleCard
└── ui/                     Icon · Hold (press-and-hold to reveal)
lib/
├── engine/engine.js        Rules engine — pure game logic, unchanged rules (+ engine.d.ts types)
├── client/                 Game Master state, actions, online rooms, cloud sync, sound, shared phrases
└── server/                 Room logic, host auth (scrypt), library, Supabase REST storage · in-memory storage
supabase/schema.sql         Run in Supabase: every table, locked down
public/                     Service worker, manifest, icons
tests/                      Vitest: rules engine, every API action, phone night choices end to end
```

## Step 1 — Supabase (free), 5 minutes

1. Create an account at supabase.com and click **New project**. Pick any name and a region close to you (e.g. Mumbai).
2. Open **SQL Editor → New query**, paste everything from `supabase/schema.sql`, and click **Run**.
   **Already set up from an earlier version? Run it again** — it adds the tables for host accounts, phone night
   choices and the Mafia chat, and leaves existing data alone.
3. Open the **Connect** button (or **Project Settings → API Keys**) and copy three values:
   - **Project URL** — looks like `https://abcd1234.supabase.co`
   - **Publishable key** — starts with `sb_publishable_` (older projects: the `anon` key)
   - **Secret key** — starts with `sb_secret_` (older projects: the `service_role` key). Keep this one private.
4. In **Realtime → Settings**, make sure "Allow public access" is on (it is by default). Phones only receive
   "something changed" pings through it — never game data.

## Step 2 — Vercel

The repository is a Next.js app; `vercel.json` tells Vercel so. If the project was created for the old static
version, open **Project → Settings → Build and Deployment** and make sure the Framework Preset is **Next.js** and
the Build Command, Output Directory and Install Command have **no overrides**.

Environment variables (**Settings → Environment Variables**), unchanged from before:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | your Project URL |
| `SUPABASE_SECRET_KEY` | your secret key |
| `SUPABASE_PUBLISHABLE_KEY` | your publishable key |

Push to the main branch (or import the repository on vercel.com) and Vercel builds and deploys it. Changing an
environment variable only takes effect after a redeploy.

### If hosting a room or signing in fails

In the Game Master's app tap **Check connection** (it appears next to the error in the online room panel), or open
`https://<your-site>/api/room?action=diagnose` in any browser. It tests the URL, the key and each table in turn and
says what to fix — no need to read Vercel logs. Nothing secret is ever shown.

| What it says | What to do |
| --- | --- |
| "contains a character a key cannot have" | You copied the masked key (`••••`). Reveal the full key in Supabase and paste it again. |
| "This is the publishable key" / "rejected the secret key" | `SUPABASE_SECRET_KEY` must be the **secret** key (`sb_secret_…`, or the legacy `service_role` key). |
| "The database tables are missing" (e.g. `hosts`, `night_actions`) | Run `supabase/schema.sql` in Supabase → SQL Editor. |
| "Supabase denied access to the tables" | Run `supabase/schema.sql` again — it also grants the server key access. |
| "Cannot find a Supabase project" / "paused" | Check `SUPABASE_URL`; free projects pause after a week of inactivity — restore it in the Supabase dashboard. |

## Step 3 — Game night

1. **Game Master:** open the site, tap **New game**, add names, choose roles. Signed in? Setups, groups and the
   game itself are saved to your account as you go.
2. **Game Master:** tap **Host an online room** (in the Players step, the menu, or Rules). A QR code and a
   5-letter room code appear.
3. **Players:** scan the QR, or open the site and type the code under **Join a game**, then tap **their own name**.
4. **Night choices on phones** (in the room panel, under *On their phones*):
   - **Off** — you call every role and tap their choice, as always.
   - **Mafia kill only** — the Mafia pick their victim (and who carries it out) on their phones.
   - **Every role** — each role picks on their own phone; your console shows who has chosen and who you're waiting on.
   Choices fill in your night console as they arrive; you can still change any of them before resolving.
5. **Silent Mafia chat:** when two or more of the Mafia (or Vampires) are alive, they can message each other on their
   phones — **at night** (default), **day and night**, or **off**. You can read along from the room panel.
6. **Day:** when you start the day, every phone plays the announcement and each player privately gets their
   night results (hold to read). Executions play on every phone too.
7. **Vote:** tap **Let phones vote** on the Day screen, or skip the tally and simply tap the player the table chose.
8. **Game over:** every phone shows the winners and every role.

Someone tapped the wrong name? In the room panel tap **Reset** next to that name; their phone goes back to the
join screen. Closing the room never affects the game itself.

## Host accounts

Create an account from the home screen with a username and password. You get a **recovery code** once — keep
it somewhere safe; it is the only way back in if you forget the password (there is no email). Passwords and
recovery codes are stored only as scrypt hashes, sessions as SHA-256 hashes in an HttpOnly cookie, and repeated
wrong passwords lock the account for 15 minutes.

## Run it locally (no accounts needed)

```bash
npm install
npm run dev                     # http://localhost:3000 — Game Master; /play — players
```
Without Supabase variables, rooms and accounts live in memory and phones check for updates every 3 seconds.

## Tests

```bash
npm test                        # rules engine, every API action (memory + a Supabase REST stand-in), phone night choices
npm run typecheck
npm run build
```

## Updating

Push to the main branch. Built files carry content hashes, so phones pick up a new version on their next visit.
Games in progress are saved on the Game Master's phone (and in their account when signed in), so a redeploy never
loses a game; phones reconnect by themselves.
