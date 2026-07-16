import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export type AuthMode = "mock" | "password";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5273",
  databaseUrl: required(
    "DATABASE_URL",
    "postgres://reddit_scanner:reddit_scanner@localhost:5434/reddit_scanner",
  ),
  authMode: (process.env.AUTH_MODE ?? "mock") as AuthMode,

  /**
   * Password mode super-admin bootstrap. If both env vars are set at
   * boot AND the user does not already exist, an admin row is created.
   * If the user exists with no password on file, the password is
   * applied; a user with an existing password is never clobbered so
   * rotated credentials survive redeploys. Idempotent either way —
   * safe to leave the secrets in Fly config forever.
   */
  superAdmin: {
    email: process.env.SUPER_ADMIN_EMAIL ?? "",
    password: process.env.SUPER_ADMIN_PASSWORD ?? "",
    name: process.env.SUPER_ADMIN_NAME ?? "Super Admin",
  },

  /** Static path served at "/" when set — used by the Docker image to
   *  serve the compiled frontend from the same origin as the API. */
  staticDir: process.env.STATIC_DIR ?? "",

  /**
   * Reddit OAuth client-credentials config. Token is refreshed per
   * scan (Reddit tokens are ~1h) rather than cached long-term —
   * simpler and avoids the "cached expired token" class of bug.
   */
  reddit: {
    clientId: process.env.REDDIT_CLIENT_ID ?? "",
    clientSecret: process.env.REDDIT_CLIENT_SECRET ?? "",
    userAgent:
      process.env.REDDIT_USER_AGENT ||
      "reddit-scanner (unconfigured UA — set REDDIT_USER_AGENT)",
  },

  /**
   * Resend transactional email config. When apiKey is unset the digest
   * code short-circuits and logs its payload instead of sending — so
   * the app boots cleanly on local dev without a real key.
   */
  email: {
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    fromAddress:
      process.env.EMAIL_FROM_ADDRESS ??
      "Reddit Scanner <onboarding@resend.dev>",
  },

  /**
   * Bearer token accepted at POST /api/scan/run. When unset the endpoint
   * still works for logged-in admins (session cookie) but rejects
   * anonymous calls — this token exists specifically to let an
   * external cron caller trigger scans without impersonating a user.
   */
  scanTriggerToken: process.env.SCAN_TRIGGER_TOKEN ?? "",

  /** Wall-clock cap on a single scan run so a wedged Reddit request can't
   *  hold a machine forever. Applies both to cron-triggered and manual
   *  runs. Default 5 minutes. */
  scanTimeoutMs: Number(process.env.SCAN_TIMEOUT_MS ?? 5 * 60 * 1000),

  /** In-process scheduler on/off. Disable when running scans from an
   *  external cron (GitHub Actions, Fly scheduled machine, etc.) so
   *  two schedulers don't race. */
  schedulerEnabled: (process.env.SCHEDULER_ENABLED ?? "true").toLowerCase() !== "false",

  /**
   * Outbound URL the app is reachable at from the recipient's inbox —
   * used to build "Open dashboard" links in digest emails. Falls back
   * to the local dev URL so emails don't accidentally leak internal
   * Fly hostnames when the env var is missing.
   */
  publicAppUrl: process.env.PUBLIC_APP_URL ?? "http://localhost:5273",
};
