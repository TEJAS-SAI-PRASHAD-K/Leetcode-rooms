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
}: {
  entries: LeaderboardEntry[];
  meId?: string;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1.2rem_1fr_2.6rem_2.6rem_2rem] gap-1 px-1 text-[10px] uppercase tracking-wide text-neutral-500">
        <span />
        <span>Member</span>
        <span className="text-right">Week</span>
        <span className="text-right">Streak</span>
        <span className="text-right">7d</span>
      </div>
      {entries.map((e, i) => (
        <div
          key={e.userId}
          className={`grid grid-cols-[1.2rem_1fr_2.6rem_2.6rem_2rem] items-center gap-1 rounded px-1 py-1 ${
            e.userId === meId ? "bg-brand/10" : ""
          }`}
        >
          <span className="text-neutral-500">{i + 1}</span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              title={e.solvedToday ? "Solved today" : "Not solved yet today"}
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                e.solvedToday ? "bg-easy" : "bg-neutral-600"
              }`}
            />
            <span className="truncate">{e.displayName}</span>
          </span>
          <span className="text-right font-medium">{e.weeklyPoints}</span>
          <span className="text-right">
            {e.currentStreak > 0 ? `${e.currentStreak}d` : "–"}
          </span>
          <span className="text-right text-neutral-400">{e.solvedOfLast7}/7</span>
        </div>
      ))}
      <p className="px-1 pt-1 text-[10px] text-neutral-500">
        Week resets Monday. Points: Easy 1, Medium 3, Hard 5, +1 first solve.
      </p>
    </div>
  );
}
