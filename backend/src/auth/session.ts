import type { Request, Response } from "express";
import { query } from "../db/pool.js";
import type { UserRow } from "../types.js";

/**
 * Server-side session store. One row in `user_sessions` per active
 * login; the session id lives in an HttpOnly cookie. This gives us
 * three things a JWT wouldn't:
 *
 *   * instant revocation (admin resets a password → delete all rows
 *     for that user_id → all their devices sign out on next request)
 *   * no signing-key rotation drama
 *   * server-side visibility ("who is logged in right now?")
 *
 * Costs a DB round-trip per authenticated request, which is fine at
 * our scale.
 */

export const SESSION_COOKIE = "reddit_scanner.session";

/** DEFAULT — 7 days sliding; REMEMBER — 30 days sliding. Both slide
 *  on every authenticated request via touchSession. */
export const SESSION_TTL_DEFAULT_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

export function ttlFor(rememberMe: boolean): number {
  return rememberMe ? SESSION_TTL_REMEMBER_MS : SESSION_TTL_DEFAULT_MS;
}

export type SessionRow = {
  id: string;
  user_id: string;
  expires_at: Date;
  created_at: Date;
  last_seen_at: Date;
  user_agent: string | null;
  remember_me: boolean;
};

export async function createSession(
  userId: string,
  userAgent: string | null,
  rememberMe = false,
): Promise<SessionRow> {
  const ttl = ttlFor(rememberMe);
  const { rows } = await query<SessionRow>(
    `INSERT INTO user_sessions (user_id, expires_at, user_agent, remember_me)
     VALUES ($1, NOW() + ($2 || ' milliseconds')::interval, $3, $4)
     RETURNING *`,
    [userId, String(ttl), userAgent, rememberMe],
  );
  return rows[0]!;
}

export async function findSessionUser(
  sessionId: string,
): Promise<{ user: UserRow; session: SessionRow } | null> {
  const { rows } = await query<UserRow & {
    session_id: string;
    session_expires_at: Date;
    session_created_at: Date;
    session_last_seen_at: Date;
    session_user_agent: string | null;
    session_remember_me: boolean;
  }>(
    `SELECT u.*,
            s.id           AS session_id,
            s.expires_at   AS session_expires_at,
            s.created_at   AS session_created_at,
            s.last_seen_at AS session_last_seen_at,
            s.user_agent   AS session_user_agent,
            s.remember_me  AS session_remember_me
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > NOW()`,
    [sessionId],
  );
  const row = rows[0];
  if (!row) return null;
  const {
    session_id, session_expires_at, session_created_at,
    session_last_seen_at, session_user_agent, session_remember_me,
    ...userCols
  } = row;
  return {
    user: userCols as UserRow,
    session: {
      id: session_id,
      user_id: userCols.id,
      expires_at: session_expires_at,
      created_at: session_created_at,
      last_seen_at: session_last_seen_at,
      user_agent: session_user_agent,
      remember_me: session_remember_me,
    },
  };
}

export async function touchSession(sessionId: string, rememberMe = false): Promise<void> {
  const ttl = ttlFor(rememberMe);
  await query(
    `UPDATE user_sessions
        SET last_seen_at = NOW(),
            expires_at   = NOW() + ($2 || ' milliseconds')::interval
      WHERE id = $1`,
    [sessionId, String(ttl)],
  );
}

export async function deleteSession(sessionId: string): Promise<void> {
  await query(`DELETE FROM user_sessions WHERE id = $1`, [sessionId]);
}

export async function deleteSessionsForUser(userId: string): Promise<void> {
  await query(`DELETE FROM user_sessions WHERE user_id = $1`, [userId]);
}

/** Revoke every session for this user EXCEPT the one whose id is
 *  `keepSessionId`. Used by self-serve password change so the caller
 *  stays signed in on the device they made the change from. */
export async function deleteOtherSessionsForUser(
  userId: string,
  keepSessionId: string,
): Promise<void> {
  await query(
    `DELETE FROM user_sessions WHERE user_id = $1 AND id <> $2`,
    [userId, keepSessionId],
  );
}

// -----------------------------------------------------------------
// Cookie helpers
// -----------------------------------------------------------------

export function readSessionCookie(req: Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function setSessionCookie(res: Response, sessionId: string, rememberMe = false): void {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${Math.floor(ttlFor(rememberMe) / 1000)}`,
  ];
  if (isSecureContext()) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res: Response): void {
  const parts = [
    `${SESSION_COOKIE}=`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=0`,
  ];
  if (isSecureContext()) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function isSecureContext(): boolean {
  return process.env.NODE_ENV === "production";
}
