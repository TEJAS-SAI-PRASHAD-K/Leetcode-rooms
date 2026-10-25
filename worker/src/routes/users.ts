import { Hono } from "hono";
import type {
  RegisterRequest,
  RegisterResponse,
  VerifyHandleRequest,
  VerifyHandleResponse,
} from "@lcr/shared";
import type { AuthedUser } from "../auth.js";
import { hashToken, randomId, randomToken } from "../auth.js";
import type { Env } from "../db.js";
import { fetchProfile, LeetCodeError } from "../leetcode.js";

type Ctx = { Bindings: Env; Variables: { user: AuthedUser } };

export const users = new Hono<Ctx>();

/** Unauthenticated: issues the install's identity. */
export const register = new Hono<{ Bindings: Env }>();

register.post("/register", async (c) => {
  const body = await c.req.json<RegisterRequest>().catch(() => null);
  const userId = randomId();
  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.prepare(
    `INSERT INTO users (id, display_name, token_hash, created_at) VALUES (?,?,?,?)`,
  )
    .bind(userId, body?.displayName?.trim() || "New member", await hashToken(token), now)
    .run();

  return c.json({ userId, token } satisfies RegisterResponse, 201);
});

users.get("/me", async (c) => {
  const user = c.get("user");
  return c.json({ user });
});

/**
 * Link a verified LeetCode handle.
 *
 * The handle must come from LeetCode's own `userStatus` query, read by the
 * content script as a same-origin request on leetcode.com — which only returns
 * a username when the browser is actually signed in as them. That is the
 * ownership proof; this endpoint additionally confirms the profile exists.
 *
 * Honest limitation: it proves the browser is signed in as that handle. Strong
 * enough for a friends group, not bank-grade.
 */
users.post("/me/leetcode", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<VerifyHandleRequest>().catch(() => null);
  const username = body?.leetcodeUsername?.trim();
  if (!username) return c.json({ error: "leetcodeUsername is required" }, 400);

  let profileExists = false;
  try {
    profileExists = (await fetchProfile(username)) !== null;
  } catch (err) {
    if (!(err instanceof LeetCodeError)) throw err;
    // LeetCode being down should not block linking; the cron will verify solves
    // later regardless.
    profileExists = true;
  }

  if (!profileExists) {
    return c.json(
      { error: `No LeetCode profile named "${username}"`, code: "no_profile" },
      404,
    );
  }

  const now = Math.floor(Date.now() / 1000);

  // A handle belongs to one install: claiming someone else's would let you
  // inherit their solves.
  const taken = await c.env.DB.prepare(
    `SELECT id FROM users WHERE leetcode_username = ? AND id != ?`,
  )
    .bind(username, user.id)
    .first<{ id: string }>();
  if (taken) {
    return c.json(
      { error: `"${username}" is already linked to another member`, code: "handle_taken" },
      409,
    );
  }

  await c.env.DB.prepare(
    `UPDATE users SET leetcode_username = ?, verified_at = ?,
            display_name = CASE WHEN display_name = 'New member' THEN ? ELSE display_name END
      WHERE id = ?`,
  )
    .bind(username, now, username, user.id)
    .run();

  return c.json({
    leetcodeUsername: username,
    verifiedAt: now,
    profileExists: true,
  } satisfies VerifyHandleResponse);
});

users.patch("/me", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ displayName?: string }>().catch(() => null);
  const name = body?.displayName?.trim();
  if (!name) return c.json({ error: "displayName is required" }, 400);

  await c.env.DB.prepare(`UPDATE users SET display_name = ? WHERE id = ?`)
    .bind(name.slice(0, 40), user.id)
    .run();
  return c.json({ ok: true });
});
