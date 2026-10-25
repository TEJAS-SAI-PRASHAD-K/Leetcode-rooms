import type {
  Difficulty,
  PickVerdict,
  PickWarning,
  Problem,
  RoomSettings,
  WarningCode,
} from "@lcr/shared";

/**
 * One problem the room has used before, with the round it belonged to.
 *
 * A round can now hold several problems, so repeat detection works at problem
 * granularity while the topic and difficulty windows are measured in rounds.
 * `topicTags` is the snapshot taken at pick time, so these checks stay correct
 * even after the problem catalog is refreshed.
 */
export interface PastPick {
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

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

/** The picks belonging to the most recent `rounds` distinct round dates. */
function recentWindow(picks: PastPick[], rounds: number): PastPick[] {
  const dates: string[] = [];
  for (const p of picks) {
    if (!dates.includes(p.roundDate)) dates.push(p.roundDate);
    if (dates.length > rounds) break;
  }
  const keep = new Set(dates.slice(0, rounds));
  return picks.filter((p) => keep.has(p.roundDate));
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
  /** This room's past picks, newest first. */
  pastPicks: PastPick[];
  /** Today's room-local date, YYYY-MM-DD. */
  today: string;
  /** Curator about to pick, for the per-curator pattern checks. */
  curatorId?: string | null;
  /**
   * Problems already chosen for this same round. A set must not contain the
   * same problem twice, which the cooldown alone would not catch because those
   * picks are not yet saved as past rounds.
   */
  alreadyInSet?: string[];
}): PickVerdict {
  const { settings, candidate, pastPicks, today, curatorId, alreadyInSet } = args;
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

  // --- Already in today's set ---------------------------------------------
  if (alreadyInSet?.includes(candidate.slug)) {
    return {
      blocked: {
        code: "repeat_recent",
        message: `"${candidate.title}" is already in today's set.`,
        daysAgo: 0,
      },
      warnings: [],
    };
  }

  // --- Exact repeat --------------------------------------------------------
  // pastPicks is newest first, so the first match is the most recent use.
  const previous = pastPicks.find((r) => r.problemSlug === candidate.slug);
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
  // *kind* of problem over and over. Counted over the most recent N rounds,
  // which works whether a round holds one problem or five.
  const window = recentWindow(pastPicks, Math.max(0, settings.topicWarnWindow));
  const roundsInWindow = new Set(window.map((p) => p.roundDate)).size;

  const topicHit = concentratedTag(window, candidate, settings.topicWarnThreshold);
  if (topicHit) {
    warnings.push({
      code: "topic_concentration",
      message: `This room has had ${plural(topicHit.count, `${humanizeTag(topicHit.tag)} problem`)} in the last ${plural(roundsInWindow, "round")}.`,
    });
  }

  const sameDifficulty = window.filter((p) => p.difficulty === candidate.difficulty).length;
  if (sameDifficulty >= settings.difficultyRunThreshold) {
    warnings.push({
      code: "difficulty_run",
      message: `That would be the ${ordinal(sameDifficulty + 1)} ${candidate.difficulty} problem in the last ${plural(roundsInWindow, "round")}.`,
    });
  }

  // --- Per-curator patterns ----------------------------------------------
  // Catches one person repeatedly defaulting to their comfort zone, which the
  // room-wide checks miss when curators rotate.
  if (curatorId) {
    const mine = recentWindow(
      pastPicks.filter((r) => r.curatorId === curatorId),
      Math.max(1, settings.topicWarnWindow),
    );

    const myDifficulty = mine.filter((p) => p.difficulty === candidate.difficulty).length;
    if (myDifficulty >= settings.difficultyRunThreshold) {
      warnings.push({
        code: "curator_difficulty_pattern",
        message: `${plural(myDifficulty, "of your recent pick")} ${myDifficulty === 1 ? "was" : "were"} ${candidate.difficulty}.`,
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

/** The candidate tag most over-represented in `picks`, if it hits `threshold`. */
function concentratedTag(
  picks: PastPick[],
  candidate: Problem,
  threshold: number,
): { tag: string; count: number } | null {
  let best: { tag: string; count: number } | null = null;

  for (const tag of candidate.topicTags) {
    const count = picks.filter((r) => r.topicTags.includes(tag)).length;
    if (count >= threshold && (!best || count > best.count)) {
      best = { tag, count };
    }
  }
  return best;
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
