import React, { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { detectAndLink } from "../lib/link.js";
import { RoomSettings } from "./RoomSettings.js";
import { readStore, writeStore } from "../lib/storage.js";
import type { Room } from "@lcr/shared";
import { Banner, Spinner } from "../popup/components.js";

interface RoomRow {
  id: string;
  code: string;
  name: string;
}

export function Options() {
  const [rooms, setRooms] = useState<RoomRow[] | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | undefined>();
  const [handle, setHandle] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [lastDetect, setLastDetect] = useState<
    { at: number; ok: boolean; reason: string; username: string | null } | undefined
  >();
  const [detecting, setDetecting] = useState(false);
  const [bgBuild, setBgBuild] = useState<string | null | undefined>();
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [meId, setMeId] = useState<string | undefined>();
  const [newRoom, setNewRoom] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [store, me, list] = await Promise.all([
        readStore(),
        api.me(),
        api.listRooms(),
      ]);
      setActiveRoomId(store.activeRoomId);
      setHandle(me.user.leetcodeUsername);
      setLastDetect(store.lastDetect);
      setRooms(list.rooms);
      setMeId(me.user.id);

      // Full settings for the active room, so the settings panel can render.
      const activeId = store.activeRoomId ?? list.rooms[0]?.id;
      if (activeId) {
        const state = await api.state(activeId).catch(() => null);
        setActiveRoom(state?.room ?? null);
      } else {
        setActiveRoom(null);
      }

      // Ask the service worker which build it is running. A mismatch is the
      // usual explanation for messages going unanswered after an update.
      void chrome.runtime
        .sendMessage({ type: "ping" })
        .then((r: { build?: string } | undefined) => setBgBuild(r?.build ?? null))
        .catch(() => setBgBuild(null));
      // "New member" is the server's placeholder, not a name the user chose.
      // Showing it as the input's value makes it look already set, which is
      // why people never press Save.
      const chosen = me.user.displayName === "New member" ? "" : me.user.displayName;
      setDisplayName(chosen);
      setSavedName(chosen);
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
      setRooms([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ tone: "good", text: await fn() });
      await load();
    } catch (e) {
      setMsg({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <header>
        <h1 className="text-lg font-semibold">LeetCode Rooms</h1>
        <p className="text-[13px] text-neutral-400">
          Daily practice with friends. A rotating curator picks the problem;
          solves are verified automatically from your public LeetCode activity.
        </p>
      </header>

      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}

      {/* ---------------- LeetCode handle ---------------- */}
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-neutral-400">
          Your LeetCode account
        </h2>

        {handle ? (
          <Banner tone="good">
            Linked as <strong>{handle}</strong>. Solves are verified automatically.
          </Banner>
        ) : (
          <Banner tone="warn">
            Not linked yet. Sign in at{" "}
            <a
              href="https://leetcode.com/"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-brand"
            >
              leetcode.com
            </a>{" "}
            and the extension links your username automatically. You never type
            it in, so nobody can claim your handle.
          </Banner>
        )}

        {/* Detection is otherwise invisible; when it fails, say why. */}
        {lastDetect && !lastDetect.ok && (
          <Banner tone="error">
            Last check ({new Date(lastDetect.at).toLocaleTimeString()}):{" "}
            {lastDetect.reason}
          </Banner>
        )}

        <button
          disabled={detecting}
          onClick={() =>
            run(async () => {
              setDetecting(true);
              try {
                // Called directly rather than messaged to the service worker:
                // an options page already has the scripting permission, and a
                // suspended or stale worker can otherwise swallow the request.
                const res = await detectAndLink();
                if (!res.ok) throw new Error(res.error ?? "Detection failed.");
                // Best-effort badge refresh; failure here must not fail linking.
                void chrome.runtime.sendMessage({ type: "badge:refresh" }).catch(() => {});
                return `Linked as ${res.linked}.`;
              } finally {
                setDetecting(false);
              }
            })
          }
          className="w-full rounded bg-neutral-800 py-1.5 text-[13px] hover:bg-neutral-700 disabled:opacity-40"
        >
          {detecting ? "Checking leetcode.com…" : handle ? "Re-check my LeetCode account" : "Detect my LeetCode account"}
        </button>

        <div>
          <label className="mb-1 block text-[12px] text-neutral-400">
            Display name (how friends see you on the leaderboard)
          </label>
          <div className="flex gap-2">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={handle ?? "Your name"}
              className="flex-1 rounded bg-neutral-900 px-2.5 py-1.5 text-[13px] outline-none ring-1 ring-neutral-800 focus:ring-brand/60"
            />
            <button
              disabled={busy || !displayName.trim() || displayName.trim() === savedName}
              onClick={() =>
                run(async () => {
                  await api.setDisplayName(displayName.trim());
                  return "Display name saved.";
                })
              }
              className="rounded bg-brand px-3 py-1.5 text-[13px] font-medium text-neutral-950 hover:bg-brand-dim disabled:bg-neutral-800 disabled:text-neutral-100 disabled:opacity-40"
            >
              Save
            </button>
          </div>
          {displayName.trim() && displayName.trim() !== savedName && (
            <p className="mt-1 text-[11px] text-medium">Unsaved — press Save.</p>
          )}
          {!savedName && !displayName.trim() && (
            <p className="mt-1 text-[11px] text-neutral-500">
              Not set yet, so you appear as "New member". Linking your LeetCode
              account also fills this in.
            </p>
          )}
        </div>
      </section>

      {/* ---------------- Rooms ---------------- */}
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-neutral-400">
          Your rooms
        </h2>

        {rooms === null ? (
          <Spinner />
        ) : rooms.length === 0 ? (
          <p className="text-[13px] text-neutral-500">No rooms yet.</p>
        ) : (
          <ul className="space-y-1">
            {rooms.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded border border-neutral-800 bg-neutral-900/50 px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{r.name}</span>
                  <span className="font-mono text-[11px] text-neutral-500">
                    {r.code}
                  </span>
                </span>
                {r.id === activeRoomId ? (
                  <span className="rounded bg-easy/15 px-2 py-0.5 text-[11px] text-easy">
                    Active
                  </span>
                ) : (
                  <button
                    onClick={() =>
                      run(async () => {
                        await writeStore({ activeRoomId: r.id });
                        return `Switched to ${r.name}.`;
                      })
                    }
                    className="rounded bg-neutral-800 px-2 py-1 text-[11px] hover:bg-neutral-700"
                  >
                    Make active
                  </button>
                )}
                <button
                  onClick={() => void navigator.clipboard.writeText(r.code)}
                  className="rounded bg-neutral-800 px-2 py-1 text-[11px] hover:bg-neutral-700"
                  title="Copy the room code to share with friends"
                >
                  Copy code
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------- Room settings ---------------- */}
      {activeRoom && (
        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-neutral-400">
            Settings for "{activeRoom.name}"
          </h2>
          <RoomSettings
            room={activeRoom}
            isOwner={activeRoom.ownerId === meId}
            onSaved={(m) => {
              setMsg({ tone: "good", text: m });
              void load();
            }}
          />
        </section>
      )}

      {/* ---------------- Create / join ---------------- */}
      {/*
        items-stretch + a column flex with mt-auto on the button keeps the two
        calls to action on the same baseline. Previously each column was its own
        height, so the differing helper-text length pushed the buttons out of
        line with each other.
      */}
      <section className="grid items-stretch gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold">Create a room</h3>
          <input
            value={newRoom}
            onChange={(e) => setNewRoom(e.target.value)}
            placeholder="Room name"
            className="w-full rounded bg-neutral-900 px-2.5 py-1.5 text-[13px] outline-none ring-1 ring-neutral-800 focus:ring-brand/60"
          />
          <p className="text-[11px] leading-relaxed text-neutral-500">
            Day boundaries and the weekly reset will use your timezone ({tz}).
          </p>
          <button
            disabled={busy || !newRoom.trim()}
            onClick={() =>
              run(async () => {
                const { room } = await api.createRoom(newRoom.trim(), tz);
                await writeStore({ activeRoomId: room.id });
                setNewRoom("");
                return `Created "${room.name}". Share code ${room.code} with your friends.`;
              })
            }
            className="mt-auto w-full rounded bg-brand py-1.5 text-[13px] font-medium text-neutral-950 hover:bg-brand-dim disabled:bg-neutral-800 disabled:text-neutral-400"
          >
            Create room
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold">Join a room</h3>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="6-character code"
            maxLength={6}
            className="w-full rounded bg-neutral-900 px-2.5 py-1.5 font-mono text-[13px] tracking-widest outline-none ring-1 ring-neutral-800 focus:ring-brand/60"
          />
          <p className="text-[11px] leading-relaxed text-neutral-500">
            Ask whoever made the room for its code.
          </p>
          <button
            disabled={busy || joinCode.trim().length < 6}
            onClick={() =>
              run(async () => {
                const { room } = await api.joinRoom(joinCode.trim());
                await writeStore({ activeRoomId: room.id });
                setJoinCode("");
                return `Joined "${room.name}".`;
              })
            }
            className="mt-auto w-full rounded bg-brand py-1.5 text-[13px] font-medium text-neutral-950 hover:bg-brand-dim disabled:bg-neutral-800 disabled:text-neutral-400"
          >
            Join room
          </button>
        </div>
      </section>

      <footer className="border-t border-neutral-800 pt-3 text-[11px] text-neutral-600">
        Extension build {__BUILD_ID__}
        {bgBuild !== undefined && (
          <>
            {" · background "}
            {bgBuild ?? "not responding"}
            {bgBuild && bgBuild !== __BUILD_ID__ && (
              <span className="ml-1 text-medium">
                (stale — reload the extension at chrome://extensions)
              </span>
            )}
          </>
        )}
      </footer>
    </main>
  );
}
