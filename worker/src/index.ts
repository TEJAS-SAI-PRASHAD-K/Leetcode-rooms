import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AuthedUser } from "./auth.js";
import { authenticate } from "./auth.js";
import type { Env } from "./db.js";
import { runCron, seedCatalog } from "./cron.js";
import { rooms } from "./routes/rooms.js";
import { register, users } from "./routes/users.js";

type Ctx = { Bindings: Env; Variables: { user: AuthedUser } };

const app = new Hono<Ctx>();

// The extension calls from a chrome-extension:// origin, which is opaque, so
// the allowlist cannot be origin-based. Authorisation is the bearer token.
app.use("/*", cors({
  origin: "*",
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
}));

app.get("/health", (c) => c.json({ ok: true }));

app.route("/api/users", register);

// Everything below needs a bearer token.
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/users/register") return next();

  const user = await authenticate(c.env, c.req.raw);
  if (!user) {
    return c.json({ error: "Unauthorized", code: "unauthorized" }, 401);
  }
  c.set("user", user);
  await next();
});

app.route("/api/users", users);
app.route("/api/rooms", rooms);

// Dev-only helpers. Guarded so they cannot be hit in production.
app.post("/api/dev/cron", async (c) => {
  if (c.env.ENVIRONMENT !== "development") return c.json({ error: "not found" }, 404);
  return c.json(await runCron(c.env));
});

app.post("/api/dev/seed-catalog", async (c) => {
  if (c.env.ENVIRONMENT !== "development") return c.json({ error: "not found" }, 404);
  const pages = Number(c.req.query("pages") ?? 5);
  return c.json({ inserted: await seedCatalog(c.env, pages) });
});

app.onError((err, c) => {
  console.error("unhandled", err);
  return c.json({ error: "Internal error" }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCron(env));
  },
} satisfies ExportedHandler<Env>;
