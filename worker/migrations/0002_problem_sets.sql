-- Multiple problems per round, plus the room mode that decides how a set is
-- scored.
--
-- Rounds previously carried a single problem inline. A round now owns a set in
-- round_problems, and a solve is recorded per problem rather than per round.

-- --- Room settings -----------------------------------------------------------
-- 'daily'      : solve the set any time during the room's local day.
-- 'time_trial' : the set opens when it is picked and closes after
--                time_trial_minutes; solves outside that window do not count.
ALTER TABLE rooms ADD COLUMN mode TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE rooms ADD COLUMN problems_per_round INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rooms ADD COLUMN time_trial_minutes INTEGER NOT NULL DEFAULT 90;

-- --- The problem set for a round ---------------------------------------------
CREATE TABLE round_problems (
  round_id   TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  slug       TEXT NOT NULL,
  title      TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  -- Snapshot at pick time, so repeat and topic checks stay correct even after
  -- problem_cache is refreshed.
  topic_tags TEXT NOT NULL DEFAULT '[]',
  position   INTEGER NOT NULL,
  PRIMARY KEY (round_id, slug)
);
CREATE INDEX idx_round_problems_round ON round_problems(round_id, position);
-- Repeat detection reads this; it must be fast per room via the rounds join.
CREATE INDEX idx_round_problems_slug ON round_problems(slug);

-- Carry existing single-problem rounds over.
INSERT INTO round_problems (round_id, slug, title, difficulty, topic_tags, position)
SELECT id, problem_slug, COALESCE(problem_title, problem_slug),
       COALESCE(difficulty, 'Medium'), topic_tags, 0
  FROM rounds
 WHERE problem_slug IS NOT NULL;

-- --- Solves are now per problem ----------------------------------------------
-- SQLite cannot widen a primary key in place, so the table is rebuilt.
CREATE TABLE solves_new (
  round_id    TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  solved_at   INTEGER NOT NULL,
  points      INTEGER NOT NULL,
  -- Order among solvers of THIS problem; 1 earns the first-solver bonus.
  solve_order INTEGER NOT NULL,
  source      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  -- Insert-once, which is what keeps repeated polling idempotent.
  PRIMARY KEY (round_id, user_id, slug)
);

INSERT INTO solves_new (round_id, user_id, slug, solved_at, points, solve_order, source, created_at)
SELECT s.round_id, s.user_id, COALESCE(r.problem_slug, ''), s.solved_at,
       s.points, s.solve_order, s.source, s.created_at
  FROM solves s
  JOIN rounds r ON r.id = s.round_id
 WHERE r.problem_slug IS NOT NULL;

DROP TABLE solves;
ALTER TABLE solves_new RENAME TO solves;
CREATE INDEX idx_solves_user ON solves(user_id);
CREATE INDEX idx_solves_round ON solves(round_id, slug);

-- rounds.problem_* are now redundant. They are left in place rather than
-- dropped: D1 applies migrations without a transaction, so a failure midway
-- through would otherwise lose data with no way back. They are no longer read.
