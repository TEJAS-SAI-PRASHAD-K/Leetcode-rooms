import React, { useCallback, useEffect, useState } from "react";
import type { RoomStateResponse } from "@lcr/shared";
import { api } from "../lib/api.js";
import { readStore, writeStore } from "../lib/storage.js";
import { Banner, DifficultyTag, Leaderboard, Spinner } from "./components.js";
import { PickPanel } from "./PickPanel.js";

type View = { kind: "loading" } | { kind: "no-room" } | { kind: "error"; message: string } | { kind: "room"; state: RoomStateResponse };

export function Popup() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [meId, setMeId] = useState<string | undefined>();
  const [picking, setPicking] = useState(false);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const store = await readStore();
      setMeId(store.identity?.userId);

      let roomId = store.activeRoomId;
      if (!roomId) {
        // Fall back to any room this install belongs to, so a fresh popup on a
        // second device still finds the group.
        const { rooms } = await api.listRooms();
        if (rooms.length === 0) {
          setView({ kind: "no-room" });
          return;
        }
        roomId = rooms[0]!.id;
        await writeStore({ activeRoomId: roomId });
      }

      setView({ kind: "room", state: await api.state(roomId) });
      void chrome.runtime.sendMessage({ type: "badge:refresh" }).catch(() => {});
    } catch (e) {
      setView({ kind: "error", message: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function recheck(roomId: string) {
    setChecking(true);
    setNote(null);
    try {
      const r = await api.verifyNow(roomId);
      if (r.solved) setNote("Verified — counted for today.");
      else if (r.degraded)
        setNote("Could not reach LeetCode just now; try again in a moment.");
      else setNote("No accepted submission found for today's problem yet.");
      await load();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  if (view.kind === "loading") return <Shell><Spinner label="Loading room…" /></Shell>;

  if (view.kind === "error")
    return (
      <Shell>
        <Banner tone="error">{view.message}</Banner>
        <p className="mt-2 text-[12px] text-neutral-400">
          Check that the server is reachable, then reopen this popup.
        </p>
      </Shell>
    );

  if (view.kind === "no-room")
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

  const { state } = view;
  const round = state.today;
  const me = state.leaderboard.find((e) => e.userId === meId);
  const hasProblem = !!round?.problemSlug;

  return (
    <Shell
      title={state.room.name}
      subtitle={`${state.room.code} · ${round?.roundDate ?? ""}`}
      onSettings={() => chrome.runtime.openOptionsPage()}
    >
      {state.poolExhaustedNotice && (
        <Banner tone="warn">{state.poolExhaustedNotice}</Banner>
      )}

      {!hasProblem && state.isMyTurn && !picking && (
        <div className="space-y-2">
          <Banner tone="warn">
            It is your turn to pick today's problem.
          </Banner>
          <button
            onClick={() => setPicking(true)}
            className="w-full rounded bg-brand py-1.5 font-medium text-neutral-950 hover:bg-brand-dim"
          >
            Choose a problem
          </button>
        </div>
      )}

      {!hasProblem && state.isMyTurn && picking && (
        <PickPanel
          roomId={state.room.id}
          onPicked={() => {
            setPicking(false);
            void load();
          }}
        />
      )}

      {!hasProblem && !state.isMyTurn && (
        <Banner>
          Waiting on {state.curator?.displayName ?? "the curator"} to pick today's
          problem. It will be chosen automatically after{" "}
          {state.room.pickDeadlineLocal}.
        </Banner>
      )}

      {hasProblem && round && (
        <div className="space-y-2.5">
          <div className="rounded border border-neutral-800 bg-neutral-900/60 p-2.5">
            <div className="flex items-start gap-2">
              <a
                href={`https://leetcode.com/problems/${round.problemSlug}/`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 font-medium leading-snug text-neutral-50 hover:text-brand"
              >
                {round.problemTitle}
              </a>
              {round.difficulty && <DifficultyTag difficulty={round.difficulty} />}
            </div>
            <p className="mt-1.5 text-[11px] text-neutral-500">
              {round.selectionSource === "curator"
                ? `Picked by ${state.curator?.displayName ?? "the curator"}`
                : "Chosen automatically (nobody picked in time)"}
              {round.acknowledged.includes("repeat_old") && " · deliberate revisit"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`flex-1 rounded px-2 py-1.5 text-center text-[12px] ${
                me?.solvedToday
                  ? "bg-easy/10 text-easy"
                  : "bg-neutral-900 text-neutral-400"
              }`}
            >
              {me?.solvedToday
                ? `Solved · streak ${me.currentStreak}d`
                : `Not solved yet · streak ${me?.currentStreak ?? 0}d`}
            </span>
            {!me?.solvedToday && (
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

          <div>
            <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-neutral-500">
              Solved today · {state.solves.length}/{state.members.length}
            </p>
            <Leaderboard entries={state.leaderboard} meId={meId} />
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({
  children,
  title,
  subtitle,
  onSettings,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  onSettings?: () => void;
}) {
  return (
    <div className="min-h-[180px] space-y-2.5 p-3">
      <header className="flex items-baseline gap-2">
        <h1 className="min-w-0 flex-1 truncate text-[14px] font-semibold">
          {title ?? "LeetCode Rooms"}
        </h1>
        {subtitle && (
          <span className="shrink-0 text-[11px] text-neutral-500">{subtitle}</span>
        )}
        {onSettings && (
          <button
            onClick={onSettings}
            className="shrink-0 text-neutral-500 hover:text-neutral-300"
            title="Settings"
          >
            ⚙
          </button>
        )}
      </header>
      {children}
    </div>
  );
}
