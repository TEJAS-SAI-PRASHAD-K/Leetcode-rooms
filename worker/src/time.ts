/**
 * Room-local calendar maths.
 *
 * A room's day boundary is local to its timezone, not UTC: that is what makes
 * "did you solve today" and streaks feel right to the people in it. Workers
 * ship full ICU, so Intl with a timeZone is available and is what we lean on
 * rather than hand-rolling offset tables.
 */

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = FORMATTER_CACHE.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    FORMATTER_CACHE.set(timeZone, f);
  }
  return f;
}

/** Wall-clock reading in `timeZone` at the given instant. */
function wallClockAt(epochSeconds: number, timeZone: string): WallClock {
  const parts = formatter(timeZone).formatToParts(new Date(epochSeconds * 1000));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function wallClockAsUtcSeconds(w: WallClock): number {
  return Math.floor(
    Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) / 1000,
  );
}

/** Zone offset in seconds (east positive) at a given instant. */
function offsetAt(epochSeconds: number, timeZone: string): number {
  return wallClockAsUtcSeconds(wallClockAt(epochSeconds, timeZone)) - epochSeconds;
}

/** Validates an IANA zone name, so a bad room setting fails at creation. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The room-local calendar date (YYYY-MM-DD) at an instant. */
export function localDate(epochSeconds: number, timeZone: string): string {
  const w = wallClockAt(epochSeconds, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/**
 * The instant at which a local wall-clock time occurs.
 *
 * Resolved by iteration because the offset itself depends on the instant we are
 * solving for. Two passes settle every real zone, including DST transitions;
 * for a wall time that a spring-forward skips entirely, this lands just after
 * the jump, which is the sane reading for a deadline.
 */
export function epochForLocalTime(
  date: string,
  timeOfDay: string,
  timeZone: string,
): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = timeOfDay.split(":").map(Number) as [number, number];
  const target: WallClock = {
    year: y, month: m, day: d, hour: hh, minute: mm ?? 0, second: 0,
  };
  const naive = wallClockAsUtcSeconds(target);

  let guess = naive - offsetAt(naive, timeZone);
  guess = naive - offsetAt(guess, timeZone);
  return guess;
}

/** Local midnight-to-midnight window for a room-local date. */
export function dayWindow(
  date: string,
  timeZone: string,
): { start: number; end: number } {
  const start = epochForLocalTime(date, "00:00", timeZone);
  const end = epochForLocalTime(addDays(date, 1), "00:00", timeZone) - 1;
  return { start, end };
}

/** Calendar arithmetic on a YYYY-MM-DD string, DST-free by construction. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Has the room's pick deadline for `date` passed as of `now`? */
export function isPastPickDeadline(args: {
  now: number;
  date: string;
  pickDeadlineLocal: string;
  timeZone: string;
}): boolean {
  return (
    args.now >=
    epochForLocalTime(args.date, args.pickDeadlineLocal, args.timeZone)
  );
}
