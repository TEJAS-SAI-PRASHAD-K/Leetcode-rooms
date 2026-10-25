/**
 * chrome.storage.local wrapper.
 *
 * Holds this install's identity and which room is active. Every read is
 * defensive because storage can come back empty in a fresh profile, and a
 * throw here would break the popup's first render.
 */

export interface Identity {
  userId: string;
  token: string;
}

export interface Stored {
  identity?: Identity;
  activeRoomId?: string;
  leetcodeUsername?: string;
  /** Last time the content script confirmed the signed-in handle. */
  handleCheckedAt?: number;
  /** Outcome of the most recent detection attempt, shown in the options page. */
  lastDetect?: { at: number; ok: boolean; reason: string; username: string | null };
}

const KEY = "lcr";

export async function readStore(): Promise<Stored> {
  try {
    const raw = await chrome.storage.local.get(KEY);
    return (raw[KEY] as Stored | undefined) ?? {};
  } catch {
    return {};
  }
}

export async function writeStore(patch: Partial<Stored>): Promise<Stored> {
  const current = await readStore();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export async function clearStore(): Promise<void> {
  await chrome.storage.local.remove(KEY);
}
