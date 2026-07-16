import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { hashPassword, validatePassword, formatPasswordErrors, verifyPassword } from "../auth/password.js";
import {
  clearSessionCookie,
  createSession,
  deleteOtherSessionsForUser,
  deleteSession,
  readSessionCookie,
  setSessionCookie,
  ttlFor,
} from "../auth/session.js";
import { authenticate } from "../middleware/auth.js";
import type { UserRow } from "../types.js";

export const authRouter = Router();

/**
 * Per-email fixed-window failed-login counter. Same lightweight
 * in-memory implementation Waypoint uses — deliberately per-machine
 * for MVP; swap for a shared store if we care about horizontal
 * scaling. Fly's 2-machine default gives an attacker 2N attempts,
 * still fine for a 12+ char password policy.
 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
type FailBucket = { count: number; resetAt: number };
const failures = new Map<string, FailBucket>();

function recordFailure(key: string): void {
  const now = Date.now();
  const cur = failures.get(key);
  if (!cur || cur.resetAt <= now) {
    failures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  cur.count++;
}

function isLocked(key: string): boolean {
  const cur = failures.get(key);
  if (!cur) return false;
  if (cur.resetAt <= Date.now()) {
    failures.delete(key);
    return false;
  }
  return cur.count >= LOGIN_MAX_FAILURES;
}

function clearFailures(key: string): void {
  failures.delete(key);
}

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
  remember_me: z.boolean().optional().default(false),
});

/**
 * POST /api/auth/login
 *
 * Constant-time-ish: we always run the bcrypt comparison, even for
 * unknown users, so timing doesn't leak whether an email exists.
 */
authRouter.post("/login", async (req, res) => {
  if (config.authMode !== "password") {
    res.status(400).json({ error: "auth mode does not use password login" });
    return;
  }

  const { email, password, remember_me: rememberMe } = loginSchema.parse(req.body);
  const key = email.toLowerCase();

  if (isLocked(key)) {
    res.status(429).json({ error: "too many failed attempts; try again later" });
    return;
  }

  const { rows } = await query<UserRow>(
    "SELECT * FROM users WHERE lower(email) = lower($1)",
    [email],
  );
  const user = rows[0];

  // Always compare — dummy hash for unknown users keeps timing flat.
  const hashToTest =
    user?.password_hash ?? "$2a$12$C6UzMDM.H6dfI/f/IKcEeO0uY7SZC9RGvT6E1n2vjP6xoV.9zTgku";
  const ok = await verifyPassword(password, hashToTest);

  if (!user || !ok) {
    recordFailure(key);
    res.status(401).json({ error: "invalid email or password" });
    return;
  }

  clearFailures(key);
  const ua = req.header("user-agent") ?? null;
  const session = await createSession(user.id, ua, rememberMe);
  setSessionCookie(res, session.id, rememberMe);

  const { password_hash: _ph, ...safe } = user;
  res.json({ user: safe, expiresInMs: ttlFor(rememberMe) });
});

/**
 * POST /api/auth/logout — best-effort cookie clear + session delete.
 * Idempotent: hitting it with no cookie or a stale one returns 204.
 */
authRouter.post("/logout", async (req, res) => {
  const sessionId = readSessionCookie(req);
  if (sessionId) {
    await deleteSession(sessionId).catch((err) => console.error("logout deleteSession", err));
  }
  clearSessionCookie(res);
  res.status(204).end();
});

/**
 * GET /api/auth/me — whoami. Also serves the mock roster when
 * unauthenticated in mock mode so the login screen can populate a
 * dropdown.
 */
authRouter.get("/me", authenticate, async (req, res) => {
  const { password_hash: _ph, ...safe } = req.user!;
  res.json({ user: safe });
});

/**
 * POST /api/auth/change-password — self-serve.
 * Requires the current password (so a stolen session cookie alone
 * can't lock you out of your own account). On success, revokes every
 * OTHER active session for this user so a compromised device is
 * automatically kicked.
 */
const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(1),
});
authRouter.post("/change-password", authenticate, async (req, res) => {
  if (config.authMode !== "password") {
    res.status(400).json({ error: "auth mode does not use passwords" });
    return;
  }
  const { current_password, new_password } = changePasswordSchema.parse(req.body);
  const user = req.user!;

  const ok = await verifyPassword(current_password, user.password_hash);
  if (!ok) {
    res.status(401).json({ error: "current password is incorrect" });
    return;
  }
  const errs = validatePassword(new_password, user.email);
  if (errs.length) {
    res.status(400).json({ error: "password policy", issues: formatPasswordErrors(errs) });
    return;
  }

  const hash = await hashPassword(new_password);
  await query(
    `UPDATE users SET password_hash = $1, password_updated_at = NOW(), updated_at = NOW() WHERE id = $2`,
    [hash, user.id],
  );
  if (req.sessionId) {
    await deleteOtherSessionsForUser(user.id, req.sessionId);
  }
  res.status(204).end();
});
