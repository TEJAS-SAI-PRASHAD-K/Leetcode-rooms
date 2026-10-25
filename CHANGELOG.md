# Changelog

Notable changes per release. Versions follow [semver](https://semver.org/);
`npm run bump patch|minor|major` updates every package at once.

## 0.3.0

**Picker**
- Quick topic filters, ordered by how many free problems carry each tag in
  LeetCode's catalog (measured against the live 3,308-problem set).
- Multi-select up to the room's set size, with a staged list that survives
  filter changes. Picking past the limit replaces the oldest selection.
- Candidates are annotated against the rest of the pending set, so a duplicate
  is greyed out while being chosen rather than only on submit.

**Room settings** (owner only)
- Daily completion vs time trial, problems per round, trial length, repeat
  cooldown, pick deadline. Values are clamped server-side rather than rejected.

**Popup**
- Shows the whole set with per-problem state and progress.
- Time-trial countdown, ticked locally rather than re-fetched each second.
- Header puts the room name on its own line so a long name cannot squeeze the
  code and date into an unreadable sliver.
- Date reads "Today" / "Yesterday" / "Sat 25 Oct" instead of a bare ISO string.
- A real SVG gear icon; the "⚙" character renders inconsistently across fonts.
- Toolbar badge shows how many problems remain instead of a bare dot.

**Options**
- Create and Join buttons share a baseline. They previously drifted apart
  because each column sized itself and the helper text differs in length.

## 0.2.0

- **Problem sets per round.** A round holds several problems; solves are keyed
  per problem, so partial progress counts and the first-solver bonus is awarded
  per problem.
- **Room modes.** `daily` counts a round toward a streak only once the whole set
  is solved. `time_trial` opens a window when the set is published and ranks by
  problems solved, then earliest finish.
- Repeat rules extend to sets: a set cannot contain the same problem twice.
  Topic and difficulty warnings now count occurrences across the recent window
  instead of consecutive rounds, which generalises to multi-problem rounds.
- The verification sweep fetches each user's feed once per run rather than once
  per problem, which matters under the Workers free 50-subrequest ceiling.
- Migration `0002_problem_sets.sql` backfills existing rounds and rebuilds
  `solves` with the wider primary key.

### Upgrading to 0.2.0

The migration rebuilds the `solves` table, so apply it before deploying:

```bash
npm run migrate:remote --workspace worker
npm run deploy --workspace worker
```

`rounds.problem_slug`, `problem_title`, `difficulty` and `topic_tags` are no
longer read but are deliberately left in place: D1 applies migrations without a
transaction, so dropping them would make a mid-migration failure unrecoverable.

## 0.1.0

Initial release. Rooms with a rotating curator, server-side solve verification
from LeetCode's public submission feed, difficulty-weighted points, streaks and
a weekly leaderboard. Repeat prevention blocks exact repeats within 30 days,
offers older ones as an acknowledged "Revisit", and warns on topic or
difficulty runs.
