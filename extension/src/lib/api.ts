import type {
  BrowseProblemsResponse,
  Difficulty,
  PickRequest,
  PickResponse,
  RegisterResponse,
  Room,
  RoomSettings,
  RoomStateResponse,
  VerifyHandleResponse,
  VerifyNowResponse,
} from "@lcr/shared";
import { readStore, writeStore } from "./storage.js";

/**
 * Worker base URL. Set VITE_API_BASE at build time for a deployed Worker;
 * defaults to the local wrangler dev server.
 */
export const API_BASE =
  (import.meta.env?.["VITE_API_BASE"] as string | undefined) ??
  "http://127.0.0.1:8787";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

/**
 * Ensure this install has an identity, registering on first use.
 *
 * Identifies a browser install, not a person: trust in the leaderboard comes
 * from LeetCode handle verification plus server-side solve checking.
 */
export async function ensureIdentity(): Promise<string> {
  const store = await readStore();
  if (store.identity?.token) return store.identity.token;

  const res = await fetch(`${API_BASE}/api/users/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new ApiError("Could not reach the server", res.status);

  const identity = (await res.json()) as RegisterResponse;
  await writeStore({ identity: { userId: identity.userId, token: identity.token } });
  return identity.token;
}

/**
 * Authenticated request, with one automatic recovery attempt.
 *
 * A stored token can stop being valid — the database was recreated, or the
 * build was repointed at a different Worker. Without recovery the extension
 * dead-ends on "Unauthorized" forever with no way back short of clearing
 * browser storage by hand, so a 401 discards the identity and registers again.
 */
async function request<T>(
  path: string,
  init: RequestInit = {},
  retryOn401 = true,
): Promise<T> {
  const token = await ensureIdentity();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401 && retryOn401 && path !== "/api/users/register") {
    await writeStore({ identity: undefined, activeRoomId: undefined });
    return request<T>(path, init, false);
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (!res.ok) {
    // 428 carries a usable verdict, so the caller inspects the body rather
    // than treating it as a plain failure.
    throw new ApiError(
      (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`,
      res.status,
      (body as { code?: string } | null)?.code,
      body,
    );
  }
  return body as T;
}

export const api = {
  me: () => request<{ user: { id: string; displayName: string; leetcodeUsername: string | null; verifiedAt: number | null } }>("/api/users/me"),

  setDisplayName: (displayName: string) =>
    request<{ ok: true }>("/api/users/me", {
      method: "PATCH",
      body: JSON.stringify({ displayName }),
    }),

  linkHandle: (leetcodeUsername: string) =>
    request<VerifyHandleResponse>("/api/users/me/leetcode", {
      method: "POST",
      body: JSON.stringify({ leetcodeUsername }),
    }),

  listRooms: () => request<{ rooms: Array<{ id: string; code: string; name: string }> }>("/api/rooms"),

  createRoom: (name: string, timezone: string) =>
    request<{ room: Room }>("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ name, timezone }),
    }),

  joinRoom: (code: string) =>
    request<{ room: Room }>("/api/rooms/join", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  state: (roomId: string) =>
    request<RoomStateResponse>(`/api/rooms/${roomId}/state`),

  browse: (
    roomId: string,
    opts: {
      query?: string;
      difficulty?: Difficulty[];
      tags?: string[];
      /** Already chosen for this set, so the server can block duplicates. */
      selected?: string[];
      cursor?: number;
    } = {},
  ) => {
    const p = new URLSearchParams();
    if (opts.query) p.set("query", opts.query);
    if (opts.difficulty?.length) p.set("difficulty", opts.difficulty.join(","));
    if (opts.tags?.length) p.set("tags", opts.tags.join(","));
    if (opts.selected?.length) p.set("selected", opts.selected.join(","));
    if (opts.cursor) p.set("cursor", String(opts.cursor));
    p.set("limit", "40");
    return request<BrowseProblemsResponse>(`/api/rooms/${roomId}/problems?${p}`);
  },

  updateSettings: (roomId: string, settings: Partial<RoomSettings>) =>
    request<{ room: Room }>(`/api/rooms/${roomId}/settings`, {
      method: "PATCH",
      body: JSON.stringify(settings),
    }),

  pick: (roomId: string, body: PickRequest) =>
    request<PickResponse>(`/api/rooms/${roomId}/pick`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  verifyNow: (roomId: string) =>
    request<VerifyNowResponse>(`/api/rooms/${roomId}/verify-now`, {
      method: "POST",
    }),
};
