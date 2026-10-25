import React, { useState } from "react";
import type { Room, RoomMode } from "@lcr/shared";
import { LIMITS } from "@lcr/shared";
import { api } from "../lib/api.js";
import { Banner } from "../popup/components.js";

/**
 * Per-room settings, owner only.
 *
 * The two that change how the room feels day to day are how many problems a
 * round holds and how the set is scored, so those lead. The repeat controls
 * sit behind a disclosure: useful to tune once, noise thereafter.
 */
export function RoomSettings({
  room,
  isOwner,
  onSaved,
}: {
  room: Room;
  isOwner: boolean;
  onSaved: (message: string) => void;
}) {
  const [mode, setMode] = useState<RoomMode>(room.mode);
  const [perRound, setPerRound] = useState(room.problemsPerRound);
  const [trialMinutes, setTrialMinutes] = useState(room.timeTrialMinutes);
  const [cooldown, setCooldown] = useState(room.repeatCooldownDays);
  const [deadline, setDeadline] = useState(room.pickDeadlineLocal);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    mode !== room.mode ||
    perRound !== room.problemsPerRound ||
    trialMinutes !== room.timeTrialMinutes ||
    cooldown !== room.repeatCooldownDays ||
    deadline !== room.pickDeadlineLocal;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.updateSettings(room.id, {
        mode,
        problemsPerRound: perRound,
        timeTrialMinutes: trialMinutes,
        repeatCooldownDays: cooldown,
        pickDeadlineLocal: deadline,
      });
      onSaved("Room settings saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!isOwner) {
    return (
      <Banner>
        Only the room owner can change these. This room runs{" "}
        <strong>
          {room.problemsPerRound} problem{room.problemsPerRound === 1 ? "" : "s"}
        </strong>{" "}
        per round in{" "}
        <strong>{room.mode === "time_trial" ? "time trial" : "daily"}</strong> mode.
      </Banner>
    );
  }

  return (
    <div className="space-y-3">
      {error && <Banner tone="error">{error}</Banner>}

      {/* --- Mode --- */}
      <fieldset>
        <legend className="mb-1.5 text-[12px] text-neutral-400">How the set is scored</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <ModeCard
            active={mode === "daily"}
            onClick={() => setMode("daily")}
            title="Daily completion"
            detail="Solve the set any time during the day. A day counts toward your streak once the whole set is done."
          />
          <ModeCard
            active={mode === "time_trial"}
            onClick={() => setMode("time_trial")}
            title="Time trial"
            detail="The clock starts when the set is picked. Ranked by how many you finish and how fast."
          />
        </div>
      </fieldset>

      {/* --- Problems per round --- */}
      <div>
        <label className="mb-1 block text-[12px] text-neutral-400">
          Problems per round
        </label>
        <div className="flex gap-1">
          {Array.from(
            { length: LIMITS.maxProblemsPerRound - LIMITS.minProblemsPerRound + 1 },
            (_, i) => i + LIMITS.minProblemsPerRound,
          ).map((n) => (
            <button
              key={n}
              onClick={() => setPerRound(n)}
              className={`h-8 w-8 rounded text-[13px] ring-1 transition ${
                perRound === n
                  ? "bg-brand/20 text-brand ring-brand/40"
                  : "bg-neutral-900 text-neutral-400 ring-neutral-800 hover:text-neutral-200"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-neutral-500">
          The curator picks this many each round. Changing it applies from the
          next round, not today's.
        </p>
      </div>

      {/* --- Time trial length, only when it does something --- */}
      {mode === "time_trial" && (
        <div>
          <label className="mb-1 block text-[12px] text-neutral-400">
            Trial length: <span className="text-neutral-200">{trialMinutes} minutes</span>
          </label>
          <input
            type="range"
            min={LIMITS.minTimeTrialMinutes}
            max={LIMITS.maxTimeTrialMinutes}
            step={15}
            value={trialMinutes}
            onChange={(e) => setTrialMinutes(Number(e.target.value))}
            className="w-full accent-brand"
          />
          <p className="mt-1 text-[11px] text-neutral-500">
            Solves outside the window do not count, so give the set enough room.
          </p>
        </div>
      )}

      <button
        onClick={() => setAdvanced((v) => !v)}
        className="text-[12px] text-neutral-400 hover:text-neutral-200"
      >
        {advanced ? "Hide" : "Show"} repeat and deadline settings
      </button>

      {advanced && (
        <div className="space-y-3 rounded border border-neutral-800 bg-neutral-900/40 p-3">
          <div>
            <label className="mb-1 block text-[12px] text-neutral-400">
              Block repeats for <span className="text-neutral-200">{cooldown} days</span>
            </label>
            <input
              type="range"
              min={0}
              max={180}
              step={5}
              value={cooldown}
              onChange={(e) => setCooldown(Number(e.target.value))}
              className="w-full accent-brand"
            />
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">
              A problem used inside this window cannot be picked again. Past it,
              it comes back as a "Revisit" the curator must confirm. Set to 0 to
              allow repeats freely.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-[12px] text-neutral-400">
              Pick deadline (room local time)
            </label>
            <input
              type="time"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="rounded bg-neutral-900 px-2.5 py-1.5 text-[13px] outline-none ring-1 ring-neutral-800 focus:ring-brand/60"
            />
            <p className="mt-1 text-[11px] text-neutral-500">
              If the curator has not picked by then, the set is chosen
              automatically so the room never loses a day.
            </p>
          </div>
        </div>
      )}

      <button
        onClick={save}
        disabled={busy || !dirty}
        className="w-full rounded bg-brand py-1.5 text-[13px] font-medium text-neutral-950 hover:bg-brand-dim disabled:bg-neutral-800 disabled:text-neutral-400"
      >
        {busy ? "Saving…" : dirty ? "Save room settings" : "Saved"}
      </button>
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  title,
  detail,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded border p-2.5 text-left transition ${
        active
          ? "border-brand/50 bg-brand/10"
          : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-700"
      }`}
    >
      <span
        className={`block text-[13px] font-medium ${active ? "text-brand" : "text-neutral-200"}`}
      >
        {title}
      </span>
      <span className="mt-0.5 block text-[11px] leading-relaxed text-neutral-500">
        {detail}
      </span>
    </button>
  );
}
