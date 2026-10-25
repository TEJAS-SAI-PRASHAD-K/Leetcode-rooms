import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@lcr/shared";
import type { Env } from "./db.js";

/**
 * Identity is deliberately lightweight: the extension generates a user id and
 * a bearer token at install and keeps them in chrome.storage.local. We store
 * only a SHA-256 of the token.
 *
 * This is not an account system — it identifies a browser install. Trust in the
 * *leaderboard* comes from LeetCode handle verification plus server-side solve
 * checking, not from this token.
 */

export function randomId(): string {
  return crypto.randomUUID();
}

export function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Room code from an alphabet that survives being read aloud or screenshotted. */
export function generateRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes]
    .map((b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]!)
    .join("");
}

export interface AuthedUser {
  id: string;
  displayName: string;
  leetcodeUsername: string | null;
  verifiedAt: number | null;
}

/** Resolve `Authorization: Bearer <token>` to a user, or null. */
export async function authenticate(
  env: Env,
  request: Request,
): Promise<AuthedUser | null> {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;

  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const row = await env.DB.prepare(
    `SELECT id, display_name, leetcode_username, verified_at
       FROM users WHERE token_hash = ?`,
  )
    .bind(await hashToken(token))
    .first<{
      id: string;
      display_name: string;
      leetcode_username: string | null;
      verified_at: number | null;
    }>();

  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    leetcodeUsername: row.leetcode_username,
    verifiedAt: row.verified_at,
  };
}
