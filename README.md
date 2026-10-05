# Omertà — Mafia Game Master, with players on their own phones

The Game Master (God) runs the game on one phone, exactly as before. Every other player opens the site
on their own phone, joins the room, and privately sees **their own role**, **their own night results**,
the **morning announcement**, and **votes** from there. Nobody passes the God's phone around.

## How it fits together

```
God's phone (index.html)  ──sync after every action──▶  Vercel function /api/room  ──▶  Supabase (Postgres)
     ▲  rules engine runs here                             stores each player's slice      rooms · seats · votes
     │  votes flow back in                                 hands each phone ONLY its own
Player phones (/play)  ◀──"something changed" ping (no secrets) via Supabase Realtime──
```

- The God's phone is the brain: it computes every player's private slice and uploads it.
- Each phone gets a secret token when its player taps their name. The server only ever returns the
  slice that matches that token, so a player cannot read anyone else's role, even with developer tools.
- Who died stays hidden on phones until the God starts the day. Night results arrive at the same moment.
- If live updates can't connect, phones fall back to checking every few seconds. The game still works.

## Project structure

```
omerta-online/
├── index.html              God's app — shell HTML only, loads external CSS/JS
├── play.html               Player app — shell HTML only, loads external CSS/JS
├── css/
│   ├── shared.css          Design system shared by both apps
│   └── player.css          Player-only layout styles
├── js/
│   ├── engine.js           Rules engine — pure game logic, no DOM (browser + Node)
│   ├── app.js              God app — state, views, handlers, online room management
│   └── player.js           Player phone app — join, role card, vote, reveal
├── api/room.js             The one Vercel function: /api/room?action=...
├── lib/
│   ├── logic.js            Room logic: create, sync, claim, view, vote, reset, close
│   └── store.js            Supabase REST storage (production) · in-memory storage (local)
├── supabase/schema.sql     Run once in Supabase: tables, locked down
├── vendor/                 supabase.js (live updates) · qrcode.js (join QR) — bundled, no CDN
├── sw.js                   Service worker — offline shell caching
├── manifest.webmanifest    PWA manifest
├── icons/                  App icons (192, 512, apple-touch)
├── dev-server.js           Local dev server — no accounts needed
├── tests/
│   ├── api.test.js         Server tests (no dependencies): node tests/api.test.js
│   └── phones.e2e.js       Optional 4-phone browser test
├── package.json · vercel.json · .gitignore
```

## Step 1 — Supabase (free), 5 minutes

1. Create an account at supabase.com and click **New project**. Pick any name and a region close to you (e.g. Mumbai).
2. Open **SQL Editor → New query**, paste everything from `supabase/schema.sql`, and click **Run**.
3. Open the **Connect** button (or **Project Settings → API Keys**) and copy three values:
   - **Project URL** — looks like `https://abcd1234.supabase.co`
   - **Publishable key** — starts with `sb_publishable_` (older projects: the `anon` key)
   - **Secret key** — starts with `sb_secret_` (older projects: the `service_role` key). Keep this one private.
4. In **Realtime → Settings**, make sure "Allow public access" is on (it is by default). Phones only receive
   "something changed" pings through it — never game data.

## Step 2 — Vercel

**Option A: GitHub (recommended)**
1. Create a new GitHub repository and push this folder to it.
2. On vercel.com: **Add New → Project →** import the repository. Framework preset: **Other**. No build command.
3. Before clicking Deploy, open **Environment Variables** and add:

   | Name | Value |
   | --- | --- |
   | `SUPABASE_URL` | your Project URL |
   | `SUPABASE_SECRET_KEY` | your secret key |
   | `SUPABASE_PUBLISHABLE_KEY` | your publishable key |

4. Click **Deploy**. Your site is at `https://<project>.vercel.app`.

**Option B: Vercel CLI**
```bash
npx vercel                      # first deploy, answer the prompts
npx vercel env add SUPABASE_URL
npx vercel env add SUPABASE_SECRET_KEY
npx vercel env add SUPABASE_PUBLISHABLE_KEY
npx vercel --prod               # redeploy with the keys
```

If you see "Online play isn't switched on for this site yet", the variables are missing — add them and redeploy.

## Step 3 — Game night

1. **God:** open the site, set the number of players, add names (or rename the seats later).
2. **God:** in the Players step, tap **Host an online room**. A QR code and a 5-letter room code appear.
3. **Players:** scan the QR (or open `<your-site>/play` and type the code), then tap **their own name** and confirm.
   The God sees each one turn to "Joined".
4. **God:** choose roles and deal as usual. The Reveal step now shows "Roles are on their phones" and how many
   players have looked. Players hold a button to see their card — it hides itself after 20 seconds.
5. **Night:** phones show "Night N — close your eyes". The God wakes roles and records actions as before.
6. **Day:** when the God starts the day, every phone shows the announcement, and each player privately gets
   their night results (hold to read). Dead players are told to stay silent.
7. **Vote:** when the God opens the vote, nominees appear on every phone. Votes fill the God's tally live.
   The God can still tap votes for anyone without a phone; a tap overrides that phone until they change it.
8. **Game over:** every phone shows the winners and every role.

Someone tapped the wrong name? In the room panel (Players step, Reveal step, or Menu), tap **Reset** next to
that name; their phone is sent back to the join screen. Closing the room never affects the game itself.

## Try it locally first (no accounts needed)

```bash
node dev-server.js
```
Open `http://localhost:3000` (God) and `http://localhost:3000/play` in another browser or a private window
(players). Locally, rooms live in memory and phones check for updates every 3 seconds.

## Tests

```bash
node tests/api.test.js          # 38 checks: every API action, on memory and on a Supabase REST stand-in
npm i puppeteer-core @sparticuz/chromium && node tests/phones.e2e.js   # optional: a full game on 4 browsers
```

## Updating

Change files, bump `VERSION` in `sw.js` (e.g. `omerta-online-v2`), and push. Games in progress are saved on the
God's phone, so a redeploy never loses a game; phones reconnect by themselves.
