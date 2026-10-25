# LeetCode Rooms

A Chrome extension for practising LeetCode daily with friends. A rotating
curator picks the day's problem, solves are verified automatically against
LeetCode's public data, and streaks keep everyone showing up.

Built for **practice first** — scoring rewards turning up and stretching, not
racing. The competitive edge is deliberately light: a weekly leaderboard that
resets every Monday, difficulty-weighted points, and a +1 nudge for solving first.

## How it works

1. One person creates a room and shares its 6-character code.
2. Each day the rotation picks a **curator**, who chooses the problem.
   If they miss the deadline, the server picks automatically — a busy curator
   can never kill the room's day.
3. Everyone solves it on leetcode.com as normal.
4. The server verifies each solve from LeetCode's public submission feed and
   updates points, streaks and the leaderboard.

Nobody self-reports anything. The extension asks the server to *check*; the
server confirms against LeetCode. That keeps the leaderboard honest even though
extension code is user-modifiable.

## Preventing repeats

The thing that quietly ruins a shared practice group is seeing the same problem
again, so this is enforced server-side rather than merely hidden in the UI:

| Situation | Behaviour |
|---|---|
| Problem used **within 30 days** | **Hard block.** The message names the date and who picked it: *"Two Sum was used 12 days ago (2026-10-13), picked by Sam. Available again in 18 days."* |
| Problem used **more than 30 days ago** | Offered as a **Revisit**. Allowed, but only with an explicit confirmation — never by accident. |
| Same **topic** repeatedly | Advisory warning: *"This room has had 4 Array problems in the last 7 rounds."* |
| Same **difficulty** repeatedly | Advisory warning: *"That would be 4 Easy problems in a row."* |
| One curator stuck in a rut | Advisory warning: *"You have picked Easy on your last 3 turns."* |

Blocked problems stay visible but greyed out with the reason attached — hiding
them would just leave the curator wondering where a problem went.

Every threshold is a per-room setting (`repeat_cooldown_days`,
`topic_warn_window`, `topic_warn_threshold`, `difficulty_run_threshold`), so you
can tune or silence them without a code change.

## Scoring

- **Points:** Easy 1, Medium 3, Hard 5, plus **+1** for solving first.
  The bonus is small on purpose: a Medium solved last still beats an Easy
  solved first.
- **Streak:** consecutive rounds solved. An unsolved *today* does not break it —
  the day is not over.
- **Weekly leaderboard** resets Monday in the room's timezone, so one strong
  week never permanently decides the standings.
- **The curator is scored normally.** Because ranking is by completion and
  streaks rather than speed, knowing the problem in advance confers almost
  nothing, so no handicap is needed.

## Layout

```
extension/   Chrome MV3 extension — popup, options, content script, service worker
worker/      Cloudflare Worker + D1 — rooms, rounds, scoring, verification cron
shared/      API contract types shared by both sides
scripts/     check-leetcode-api.ts — contract test against LeetCode's live API
```

## Setup

### 1. Install

```bash
npm install
```

### 2. Create the D1 database

```bash
npx wrangler d1 create leetcode-rooms
```

Copy the printed `database_id` into `worker/wrangler.toml`, replacing
`REPLACE_ME_AFTER_D1_CREATE`.

### 3. Run locally

```bash
npm run migrate:local --workspace worker && npm run dev:worker
```

Then seed the problem catalog (one-off; the cron tops it up afterwards):

```bash
curl -X POST "http://127.0.0.1:8787/api/dev/seed-catalog?pages=20"
```

### 4. Build and load the extension

```bash
npm run build --workspace extension
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**
and select `extension/dist`.

### 5. Link your LeetCode account

Open [leetcode.com](https://leetcode.com/) while signed in. The extension reads
your username from the page and links it automatically — you never type it in,
so nobody can claim someone else's handle.

If it does not link, open the extension's options page and press **Detect my
LeetCode account**. That runs the sign-in check in the page's own context on an
open leetcode.com tab and reports exactly what went wrong, rather than failing
silently.

## Deploying

```bash
npm run migrate:remote --workspace worker
npm run deploy --workspace worker
```

Seed the problem catalog on the remote database. The cron would eventually page
it in at 100 per tick, but that is hours for a cold start:

```bash
npm run build:catalog
npx wrangler d1 execute leetcode-rooms --remote --file=worker/seed/catalog.sql
```

Then rebuild the extension pointing at the deployed Worker:

```bash
VITE_API_BASE=https://leetcode-rooms.<your-subdomain>.workers.dev \
  npm run build --workspace extension
```

`host_permissions` is derived from that same variable, so there is nothing else
to edit — but the URL must be set at build time, because a missing host
permission only fails once the extension is running, not during the build.

The deployed Worker runs with `ENVIRONMENT = "production"`, which disables the
`/api/dev/*` endpoints. `wrangler dev` picks up `worker/.dev.vars` and keeps
them locally.

Everything fits comfortably in Cloudflare's free tier: 100k requests/day,
D1 at 5M rows read and 100k written per day, and 5 cron triggers per account
(this uses one).

### Sharing with friends

A Chrome Web Store developer account is a **one-time $5**; publish **Unlisted**
so only people with the link can install, and updates reach everyone
automatically. The free alternative is each friend using *Load unpacked*, but
they would have to reload the folder manually on every update.

## Testing

```bash
npm test              # 75 unit tests: scoring, repeats, timezones, selection, API client
npm run typecheck     # shared + worker + extension
npm run check:api     # contract test against LeetCode's live GraphQL API
```

`npm run check:api` is the important one to run periodically. LeetCode's API is
undocumented and **schema introspection is disabled**, so field and filter names
can only be validated empirically. If it fails, the Worker's queries need
updating; solve verification degrades to self-reported in the meantime rather
than breaking the room.

## Notes on LeetCode's API

This relies on `https://leetcode.com/graphql`, which is undocumented and can
change without notice. The four queries used, all verified working
unauthenticated:

- `recentAcSubmissionList(username, limit)` — the load-bearing one. Returns
  solved slugs and exact timestamps with **no credentials**, which is what lets
  the server verify solves without anyone's session.
- `questionList(... filters)` — the problem catalog, filterable by `difficulty`,
  `tags` and `status`.
- `matchedUser(username)` — confirms a handle exists. Note it signals an unknown
  user with a GraphQL *error*, not just a null, which the client distinguishes
  from a genuine outage.
- `activeDailyCodingChallengeQuestion` — LeetCode's official daily.

Two real constraints shape the design:

- **The submission feed caps at ~20 entries**, so someone grinding many problems
  could push the target off it between polls. Covered by a 10-minute cron plus
  an immediate check after you submit, with a manual "Re-check" button as backstop.
- **Workers Free allows 50 subrequests per invocation**, so the verification
  sweep processes bounded batches with a round-robin cursor and only polls
  members who have not solved yet.

Volume is modest and this reads the same public endpoints the site itself uses,
but it is worth knowing you are relying on an unofficial API.

## Limitations

- Handle verification proves the browser is **signed in as** that account.
  That is strong for a friends group; it is not bank-grade.
- Premium-only problems are excluded, so nobody is locked out of the day.
- If a room's filters are narrow enough that the 30-day cooldown leaves nothing
  legal to pick, the fallback reuses the least recently used problem and says so
  in the popup rather than skipping the day.
