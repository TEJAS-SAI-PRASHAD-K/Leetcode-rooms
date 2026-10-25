import React, { useCallback, useEffect, useState } from "react";
import type { RoomStateResponse, RoundProblem } from "@lcr/shared";
import { api } from "../lib/api.js";
import { readStore, writeStore } from "../lib/storage.js";
import {
  Banner,
  DifficultyTag,
  formatCountdown,
  formatRoundDate,
  GearIcon,
  Leaderboard,
  Spinner,
} from "./components.js";
import { PickPanel } from "./PickPanel.js";

type View =
  | { kind: "loading" }
  | { kind: "no-room" }
  | { kind: "error"; message: string }
  | { kind: "room"; state: RoomStateResponse };

export function Popup() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [meId, setMeId] = useState<string | undefined>();
  const [picking, setPicking] = useState(false);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const store = await readStore();
      setMeId(store.identity?.userId);

      let roomId = store.activeRoomId;
      if (!roomId) {
        const { rooms } = await api.listRooms();
        if (rooms.length === 0) {
          setView({ kind: "no-room" });
          return;
        }
        roomId = rooms[0]!.id;
        await writeStore({ activeRoomId: roomId });
      }

      const state = await api.state(roomId);
      setView({ kind: "room", state });
      setSecondsLeft(state.timeTrialSecondsLeft);
      void chrome.runtime.sendMessage({ type: "badge:refresh" }).catch(() => {});
    } catch (e) {
      setView({ kind: "error", message: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Tick the time-trial countdown locally rather than re-fetching every second.
  useEffect(() => {
    if (secondsLeft === null) return;
    const id = setInterval(
      () => setSecondsLeft((s) => (s === null ? null : Math.max(0, s - 1))),
      1000,
    );
    return () => clearInterval(id);
  }, [secondsLeft === null]);

  async function recheck(roomId: string) {
    setChecking(true);
    setNote(null);
    try {
      const r = await api.verifyNow(roomId);
      if (r.newSolves.length > 0) {
        setNote(
          r.completed
            ? "Verified — today's set is complete."
            : `Verified ${r.newSolves.length} more. ${r.solves.length} done so far.`,
        );
      } else if (r.degraded) {
        setNote("Could not reach LeetCode just now; try again in a moment.");
      } else {
        setNote("No new accepted submissions found for today's set yet.");
      }
      await load();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  if (view.kind === "loading") {
    return (
      <Shell>
        <Spinner label="Loading room…" />
      </Shell>
    );
  }

  if (view.kind === "error") {
    return (
      <Shell>
        <Banner tone="error">{view.message}</Banner>
        <p className="mt-2 text-[12px] text-neutral-400">
          Check that the server is reachable, then reopen this popup.
        </p>
      </Shell>
    );
  }

  if (view.kind === "no-room") {
    return (
      <Shell>
        <Banner>You are not in a room yet.</Banner>
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          className="mt-2 w-full rounded bg-brand py-1.5 font-medium text-neutral-950 hover:bg-brand-dim"
        >
          Create or join a room
        </button>
      </Shell>
    );
  }

  const { state } = view;
  const round = state.today;
  const me = state.leaderboard.find((e) => e.userId === meId);
  const hasSet = (round?.problems.length ?? 0) > 0;
  const mySolved = new Set(state.solves.filter((s) => s.userId === meId).map((s) => s.slug));
  const isTimeTrial = state.room.mode === "time_trial";
  const trialOver = isTimeTrial && secondsLeft !== null && secondsLeft <= 0;

  return (
    <Shell
      title={state.room.name}
      code={state.room.code}
      date={round ? formatRoundDate(round.roundDate, round.roundDate) : undefined}
      onSettings={() => chrome.runtime.openOptionsPage()}
    >
      {state.poolExhaustedNotice && <Banner tone="warn">{state.poolExhaustedNotice}</Banner>}

      {isTimeTrial && hasSet && secondsLeft !== null && (
        <div
          className={`flex items-center justify-between rounded border px-2.5 py-1.5 ${
            trialOver
              ? "border-neutral-700 bg-neutral-900 text-neutral-400"
              : secondsLeft < 300
                ? "border-hard/40 bg-hard/10 text-hard"
                : "border-brand/30 bg-brand/10 text-brand"
          }`}
        >
          <span className="text-[11px] uppercase tracking-wide">
            {trialOver ? "Time trial closed" : "Time remaining"}
          </span>
          <span className="font-mono text-[15px] tabular-nums">
            {formatCountdown(secondsLeft)}
          </span>
        </div>
      )}

      {!hasSet && state.isMyTurn && !picking && (
        <div className="space-y-2">
          <Banner tone="warn">
            It is your turn to pick{" "}
            {state.room.problemsPerRound === 1
              ? "today's problem"
              : `today's ${state.room.problemsPerRound} problems`}
            .
          </Banner>
          <button
            onClick={() => setPicking(true)}
            className="w-full rounded bg-brand py-1.5 font-medium text-neutral-950 hover:bg-brand-dim"
          >
            Choose {state.room.problemsPerRound === 1 ? "a problem" : "problems"}
          </button>
        </div>
      )}

      {!hasSet && state.isMyTurn && picking && (
        <PickPanel
          roomId={state.room.id}
          problemsPerRound={state.room.problemsPerRound}
          onPicked={() => {
            setPicking(false);
            void load();
          }}
        />
      )}

      {!hasSet && !state.isMyTurn && (
        <Banner>
          Waiting on {state.curator?.displayName ?? "the curator"} to pick. The set
          is chosen automatically after {state.room.pickDeadlineLocal}.
        </Banner>
      )}

      {hasSet && round && (
        <div className="space-y-2.5">
          <div className="space-y-1">
            <div className="flex items-baseline justify-between px-0.5">
              <span className="text-[10px] uppercase tracking-wide text-neutral-500">
                {round.problems.length === 1 ? "Today's problem" : "Today's set"}
              </span>
              <span className="text-[11px] text-neutral-500">
                {mySolved.size}/{round.problems.length} solved
              </span>
            </div>
            {round.problems.map((p) => (
              <ProblemRow key={p.slug} problem={p} solved={mySolved.has(p.slug)} />
            ))}
            <p className="px-0.5 pt-0.5 text-[10px] text-neutral-500">
              {round.selectionSource === "curator"
                ? `Picked by ${state.curator?.displayName ?? "the curator"}`
                : "Chosen automatically (nobody picked in time)"}
              {round.acknowledged.includes("repeat_old") && " · includes a revisit"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`flex-1 rounded px-2 py-1.5 text-center text-[12px] ${
                me?.completedToday
                  ? "bg-easy/10 text-easy"
                  : "bg-neutral-900 text-neutral-400"
              }`}
            >
              {me?.completedToday
                ? isTimeTrial
                  ? "Set complete"
                  : `Complete · streak ${me.currentStreak}d`
                : `${mySolved.size} of ${round.problems.length} done${
                    isTimeTrial ? "" : ` · streak ${me?.currentStreak ?? 0}d`
                  }`}
            </span>
            {!me?.completedToday && (
              <button
                onClick={() => void recheck(state.room.id)}
                disabled={checking}
                className="rounded bg-neutral-800 px-2.5 py-1.5 text-[12px] hover:bg-neutral-700 disabled:opacity-50"
                title="Ask the server to re-check your LeetCode submissions"
              >
                {checking ? "Checking…" : "Re-check"}
              </button>
            )}
          </div>

          {note && <Banner tone="info">{note}</Banner>}

          <Leaderboard entries={state.leaderboard} meId={meId} timeTrial={isTimeTrial} />
        </div>
      )}
    </Shell>
  );
}

function ProblemRow({ problem, solved }: { problem: RoundProblem; solved: boolean }) {
  return (
    <a
      href={`https://leetcode.com/problems/${problem.slug}/`}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center gap-2 rounded border px-2.5 py-1.5 transition ${
        solved
          ? "border-easy/25 bg-easy/5"
          : "border-neutral-800 bg-neutral-900/60 hover:border-neutral-700"
      }`}
    >
      <span
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[9px] ${
          solved ? "bg-easy text-neutral-950" : "ring-1 ring-neutral-700"
        }`}
      >
        {solved ? "✓" : ""}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-[13px] leading-snug ${
          solved ? "text-neutral-400 line-through decoration-neutral-600" : "text-neutral-50"
        }`}
      >
        {problem.title}
      </span>
      <DifficultyTag difficulty={problem.difficulty} />
    </a>
  );
}

/**
 * Popup chrome.
 *
 * The header puts the room name on its own line with the code and date beneath,
 * so a long room name cannot squeeze the metadata into an unreadable sliver —
 * which is what happened when all three shared one row.
 */
function Shell({
  children,
  title,
  code,
  date,
  onSettings,
}: {
  children: React.ReactNode;
  title?: string;
  code?: string;
  date?: string;
  onSettings?: () => void;
}) {
  return (
    <div className="min-h-[180px] space-y-2.5 p-3">
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14px] font-semibold leading-tight">
            {title ?? "LeetCode Rooms"}
          </h1>
          {(code || date) && (
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-neutral-500">
              {code && <span className="font-mono tracking-wide">{code}</span>}
              {code && date && <span className="text-neutral-700">•</span>}
              {date && <span>{date}</span>}
            </p>
          )}
        </div>
        {onSettings && (
          <button
            onClick={onSettings}
            aria-label="Settings"
            title="Settings"
            className="-m-1 shrink-0 rounded p-1 text-neutral-500 transition hover:bg-neutral-800 hover:text-neutral-200"
          >
            <GearIcon className="h-4 w-4" />
          </button>
        )}
      </header>
      {children}
    </div>
  );
}
