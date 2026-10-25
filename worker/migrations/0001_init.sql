-- LeetCode Rooms: initial schema.
-- Times are unix epoch seconds unless the column name says _local or _date.

CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  leetcode_username TEXT UNIQUE,
  display_name      TEXT NOT NULL,
  -- Set when a content script read this handle from LeetCode's userStatus while
  -- the browser was signed in as them. NULL means unverified.
  verified_at       INTEGER,
  token_hash        TEXT NOT NULL,
  created_at        INTEGER NOT NULL
);

CREATE TABLE rooms (
  id                       TEXT PRIMARY KEY,
  code                     TEXT NOT NULL UNIQUE,
  name                     TEXT NOT NULL,
  owner_id                 TEXT NOT NULL REFERENCES users(id),
  -- IANA zone. Defines the room's day boundary and the weekly leaderboard reset.
  timezone                 TEXT NOT NULL DEFAULT 'UTC',
  -- JSON array of user ids in rotation order.
  curator_order            TEXT NOT NULL DEFAULT '[]',
  pick_deadline_local      TEXT NOT NULL DEFAULT '20:00',
  -- JSON arrays. Empty array = no restriction.
  difficulty_filter        TEXT NOT NULL DEFAULT '[]',
  topic_filter             TEXT NOT NULL DEFAULT '[]',
  -- Repeat controls.
  repeat_cooldown_days     INTEGER NOT NULL DEFAULT 30,
  topic_warn_window        INTEGER NOT NULL DEFAULT 7,
  topic_warn_threshold     INTEGER NOT NULL DEFAULT 3,
  difficulty_run_threshold INTEGER NOT NULL DEFAULT 3,
  created_at               INTEGER NOT NULL
);

CREATE TABLE room_members (
  room_id   TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX idx_room_members_user ON room_members(user_id);

CREATE TABLE rounds (
  id               TEXT PRIMARY KEY,
  room_id          TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  -- YYYY-MM-DD in the room's timezone.
  round_date       TEXT NOT NULL,
  curator_id       TEXT REFERENCES users(id),
  problem_slug     TEXT,
  problem_title    TEXT,
  difficulty       TEXT,
  -- JSON snapshot of tags at pick time, so repeat/topic checks stay correct
  -- even after problem_cache is refreshed.
  topic_tags       TEXT NOT NULL DEFAULT '[]',
  selection_source TEXT,
  window_start     INTEGER NOT NULL,
  window_end       INTEGER NOT NULL,
  -- JSON array of warning codes the curator explicitly confirmed.
  acknowledged     TEXT NOT NULL DEFAULT '[]',
  created_at       INTEGER NOT NULL,
  UNIQUE (room_id, round_date)
);
-- These two indexes carry all repeat detection.
CREATE INDEX idx_rounds_room_slug ON rounds(room_id, problem_slug);
CREATE INDEX idx_rounds_room_date ON rounds(room_id, round_date DESC);

CREATE TABLE solves (
  round_id    TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- LeetCode's own submission timestamp, not when we noticed it.
  solved_at   INTEGER NOT NULL,
  points      INTEGER NOT NULL,
  solve_order INTEGER NOT NULL,
  source      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  -- Insert-once, which is what makes repeated polling idempotent.
  PRIMARY KEY (round_id, user_id)
);
CREATE INDEX idx_solves_user ON solves(user_id);

CREATE TABLE problem_cache (
  slug        TEXT PRIMARY KEY,
  frontend_id TEXT NOT NULL,
  title       TEXT NOT NULL,
  difficulty  TEXT NOT NULL,
  paid_only   INTEGER NOT NULL DEFAULT 0,
  ac_rate     REAL NOT NULL DEFAULT 0,
  topic_tags  TEXT NOT NULL DEFAULT '[]',
  refreshed_at INTEGER NOT NULL
);
CREATE INDEX idx_problem_cache_difficulty ON problem_cache(difficulty, paid_only);

-- Round-robin position for the batched verification sweep, so no room starves
-- when the 50-subrequest-per-invocation ceiling truncates a run.
CREATE TABLE cron_cursor (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  position   INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER
);
INSERT INTO cron_cursor (id, position, last_run_at) VALUES (1, 0, NULL);
