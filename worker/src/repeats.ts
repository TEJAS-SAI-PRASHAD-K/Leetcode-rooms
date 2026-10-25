import type {
  Difficulty,
  PickVerdict,
  PickWarning,
  Problem,
  RoomSettings,
  WarningCode,
} from "@lcr/shared";

/**
 * A past round, reduced to just what repeat detection needs. `topicTags` is the
 * snapshot taken at pick time, so these checks stay correct even after the
 * problem catalog is refreshed.
 */
export interface PastRound {
  roundDate: string; // YYYY-MM-DD, room-local
  problemSlug: string;
  problemTitle: string;
  difficulty: Difficulty;
  topicTags: string[];
  curatorId: string | null;
  curatorName: string | null;
}

/** Turns a LeetCode tag slug into something readable: "linked-list" -> "Linked List". */
export function humanizeTag(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Whole days between two room-local YYYY-MM-DD calendar dates. */
export function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Decide whether a candidate problem may be picked for a room today.
 *
 * Pure on purpose: all DB access happens in the caller, so every branch here is
 * cheap to unit test. Callers MUST treat this as authoritative rather than
 * relying on the UI having hidden blocked problems — a stale popup or a direct
 * API call would otherwise slip a repeat through.
 */
export function evaluatePick(args: {
  settings: Pick<
    RoomSettings,
    | "repeatCooldownDays"
    | "topicWarnWindow"
    | "topicWarnThreshold"
    | "difficultyRunThreshold"
  >;
  candidate: Problem;
  /** This room's past rounds, newest first. */
  pastRounds: PastRound[];
  /** Today's room-local date, YYYY-MM-DD. */
  today: string;
  /** Curator about to pick, for the per-curator pattern checks. */
  curatorId?: string | null;
}): PickVerdict {
  const { settings, candidate, pastRounds, today, curatorId } = args;
  const warnings: PickWarning[] = [];

  // --- Premium problems would lock out anyone without a subscription. -------
  if (candidate.paidOnly) {
    return {
      blocked: {
        code: "paid_only",
        message: `"${candidate.title}" is LeetCode Premium only, so not everyone in the room could open it.`,
      },
      warnings: [],
    };
  }

  // --- Exact repeat --------------------------------------------------------
  // pastRounds is newest first, so the first match is the most recent use.
  const previous = pastRounds.find((r) => r.problemSlug === candidate.slug);
  if (previous) {
    const daysAgo = daysBetween(previous.roundDate, today);
    const by = previous.curatorName ?? "someone";

    if (daysAgo < settings.repeatCooldownDays) {
      const availableInDays = settings.repeatCooldownDays - daysAgo;
      return {
        blocked: {
          code: "repeat_recent",
          message:
            `"${candidate.title}" was used ${daysAgo === 0 ? "today" : `${plural(daysAgo, "day")} ago`}` +
            ` (${previous.roundDate}), picked by ${by}.` +
            ` Available again in ${plural(availableInDays, "day")}.`,
          lastUsedDate: previous.roundDate,
          lastUsedBy: by,
          daysAgo,
          availableInDays,
        },
        warnings: [],
      };
    }

    // Outside the cooldown: deliberate revision is good for learning, so allow
    // it — but only on an explicit acknowledgement, never by accident.
    warnings.push({
      code: "repeat_old",
      message: `Revisit — last used ${previous.roundDate} (${plural(daysAgo, "day")} ago) by ${by}.`,
    });
  }

  // --- Repetitive topic / difficulty --------------------------------------
  // The more damaging kind of repetition: not the same problem, but the same
  // *kind* of problem over and over.
  const window = pastRounds.slice(0, Math.max(0, settings.topicWarnWindow));

  const topicHit = concentratedTag(window, candidate, settings.topicWarnThreshold);
  if (topicHit) {
    warnings.push({
      code: "topic_concentration",
      message: `This room has had ${plural(topicHit.count, `${humanizeTag(topicHit.tag)} problem`)} in the last ${plural(window.length, "round")}.`,
    });
  }

  const run = leadingDifficultyRun(window, candidate.difficulty);
  if (run >= settings.difficultyRunThreshold) {
    warnings.push({
      code: "difficulty_run",
      message: `That would be ${run + 1} ${candidate.difficulty} problems in a row.`,
    });
  }

  // --- Per-curator patterns ----------------------------------------------
  // Catches one person repeatedly defaulting to their comfort zone, which the
  // room-wide checks miss when curators rotate.
  if (curatorId) {
    const mine = pastRounds.filter((r) => r.curatorId === curatorId).slice(0, window.length || 7);

    const myRun = leadingDifficultyRun(mine, candidate.difficulty);
    if (myRun >= settings.difficultyRunThreshold) {
      warnings.push({
        code: "curator_difficulty_pattern",
        message: `You have picked ${candidate.difficulty} on your last ${plural(myRun, "turn")}.`,
      });
    }

    const myTopic = concentratedTag(mine, candidate, settings.topicWarnThreshold);
    if (myTopic) {
      warnings.push({
        code: "curator_topic_pattern",
        message: `${plural(myTopic.count, "of your recent pick")} ${myTopic.count === 1 ? "was" : "were"} ${humanizeTag(myTopic.tag)}.`,
      });
    }
  }

  return { blocked: null, warnings };
}

/** The candidate tag most over-represented in `rounds`, if it hits `threshold`. */
function concentratedTag(
  rounds: PastRound[],
  candidate: Problem,
  threshold: number,
): { tag: string; count: number } | null {
  let best: { tag: string; count: number } | null = null;

  for (const tag of candidate.topicTags) {
    const count = rounds.filter((r) => r.topicTags.includes(tag)).length;
    if (count >= threshold && (!best || count > best.count)) {
      best = { tag, count };
    }
  }
  return best;
}

/** How many of the most recent consecutive rounds share `difficulty`. */
function leadingDifficultyRun(rounds: PastRound[], difficulty: Difficulty): number {
  let run = 0;
  for (const r of rounds) {
    if (r.difficulty !== difficulty) break;
    run++;
  }
  return run;
}

/**
 * Gate a pick on the curator having confirmed every overridable warning.
 * Omitting an acknowledgement is not consent, so an old client that knows
 * nothing about a new warning code fails closed rather than silently bypassing it.
 */
export function unacknowledgedWarnings(
  verdict: PickVerdict,
  acknowledged: WarningCode[] = [],
): WarningCode[] {
  return verdict.warnings
    .filter((w) => REQUIRES_ACK.has(w.code))
    .map((w) => w.code)
    .filter((code) => !acknowledged.includes(code));
}

/**
 * Only the exact-repeat warning needs confirming. The topic and difficulty
 * warnings are advisory nudges — blocking on those would make picking tedious
 * for a practice group.
 */
const REQUIRES_ACK: ReadonlySet<WarningCode> = new Set<WarningCode>(["repeat_old"]);
