import React from "react";
import type { Difficulty, LeaderboardEntry, PickWarning } from "@lcr/shared";

export function DifficultyTag({ difficulty }: { difficulty: Difficulty }) {
  const tone =
    difficulty === "Easy"
      ? "bg-easy/15 text-easy"
      : difficulty === "Medium"
        ? "bg-medium/15 text-medium"
        : "bg-hard/15 text-hard";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {difficulty}
    </span>
  );
}

/** Small toggle used for difficulty and topic filters. */
export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[11px] ring-1 transition ${
        active
          ? "bg-brand/20 text-brand ring-brand/40"
          : "bg-neutral-900 text-neutral-400 ring-neutral-800 hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

/** A real gear glyph; the "⚙" character renders inconsistently across fonts. */
export function GearIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Room-local date as people actually read it ("Sat 25 Oct"), with "Today" and
 * "Yesterday" for the common cases. A bare ISO string in the header is precise
 * but takes a beat to parse, and the header is glanced at, not studied.
 */
export function formatRoundDate(roundDate: string, todayDate: string): string {
  if (roundDate === todayDate) return "Today";

  const d = new Date(`${roundDate}T00:00:00Z`);
  const today = new Date(`${todayDate}T00:00:00Z`);
  const diffDays = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diffDays === 1) return "Yesterday";

  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC", // the date string is already room-local
  });
}

/** mm:ss or h:mm:ss, for the time-trial countdown. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 justify-center text-neutral-400">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-600 border-t-brand" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "error" | "good";
  children: React.ReactNode;
}) {
  const tones = {
    info: "bg-neutral-800 text-neutral-200 border-neutral-700",
    warn: "bg-medium/10 text-medium border-medium/30",
    error: "bg-hard/10 text-hard border-hard/30",
    good: "bg-easy/10 text-easy border-easy/30",
  } as const;
  return (
    <div className={`rounded border px-2.5 py-2 text-[12px] leading-snug ${tones[tone]}`}>
      {children}
    </div>
  );
}

/**
 * Warnings are advisory nudges, except the exact-repeat one, which the curator
 * must confirm. Rendering them with distinct weight keeps that clear.
 */
export function WarningList({
  warnings,
  needsAck,
  acked,
  onToggleAck,
}: {
  warnings: PickWarning[];
  needsAck: boolean;
  acked: boolean;
  onToggleAck: (v: boolean) => void;
}) {
  if (warnings.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {warnings.map((w) => (
        <Banner key={w.code} tone={w.code === "repeat_old" ? "warn" : "info"}>
          {w.message}
        </Banner>
      ))}
      {needsAck && (
        <label className="flex items-start gap-2 text-[12px] text-neutral-300">
          <input
            type="checkbox"
            checked={acked}
            onChange={(e) => onToggleAck(e.target.checked)}
            className="mt-0.5 accent-brand"
          />
          <span>Yes, set this as a deliberate revisit.</span>
        </label>
      )}
    </div>
  );
}

export function Leaderboard({
  entries,
  meId,
  timeTrial = false,
}: {
  entries: LeaderboardEntry[];
  meId?: string;
  timeTrial?: boolean;
}) {
  if (entries.length === 0) return null;
  const cols = "grid-cols-[1.1rem_1fr_2.4rem_2.6rem_2.4rem]";

  return (
    <div className="space-y-1">
      <div className={`grid ${cols} gap-1 px-1 text-[10px] uppercase tracking-wide text-neutral-500`}>
        <span />
        <span>Member</span>
        <span className="text-right">Today</span>
        <span className="text-right">{timeTrial ? "Done" : "Streak"}</span>
        <span className="text-right">{timeTrial ? "Pts" : "7d"}</span>
      </div>

      {entries.map((e, i) => (
        <div
          key={e.userId}
          className={`grid ${cols} items-center gap-1 rounded px-1 py-1 ${
            e.userId === meId ? "bg-brand/10" : ""
          }`}
        >
          <span className="text-neutral-500">{i + 1}</span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              title={
                e.completedToday
                  ? "Finished today's set"
                  : `${e.solvedToday} of ${e.problemsToday} solved`
              }
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                e.completedToday
                  ? "bg-easy"
                  : e.solvedToday > 0
                    ? "bg-medium"
                    : "bg-neutral-600"
              }`}
            />
            <span className="truncate">{e.displayName}</span>
          </span>
          {/* Progress through today's set is the number people actually want. */}
          <span className="text-right tabular-nums">
            {e.solvedToday}/{e.problemsToday || "–"}
          </span>
          <span className="text-right tabular-nums">
            {timeTrial
              ? e.finishedAt
                ? new Date(e.finishedAt * 1000).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "–"
              : e.currentStreak > 0
                ? `${e.currentStreak}d`
                : "–"}
          </span>
          <span className="text-right tabular-nums text-neutral-400">
            {timeTrial ? e.weeklyPoints : `${e.solvedOfLast7}/7`}
          </span>
        </div>
      ))}

      <p className="px-1 pt-1 text-[10px] leading-relaxed text-neutral-500">
        {timeTrial
          ? "Ranked by problems solved, then who finished first."
          : "Week resets Monday. A day counts once the whole set is solved."}{" "}
        Points: Easy 1, Medium 3, Hard 5, +1 first solve.
      </p>
    </div>
  );
}
