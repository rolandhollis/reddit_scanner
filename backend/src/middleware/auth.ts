import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { findSessionUser, readSessionCookie, touchSession } from "../auth/session.js";
import type { Role, UserRow } from "../types.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
      /**
       * Session id backing the current request in password mode. Only
       * handlers that need to preserve or revoke *this* session
       * specifically (e.g. self-serve password change) read it.
       * Undefined in mock mode.
       */
      sessionId?: string;
    }
  }
}

async function loadUserById(id: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] ?? null;
}

/**
 * Attach `req.user` based on the configured AUTH_MODE:
 *   - mock     → dev-only "x-mock-user-id" header (Waypoint pattern; DO NOT ship to prod).
 *   - password → server-side session cookie set at POST /api/auth/login.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    if (config.authMode === "mock") {
      const id = req.header("x-mock-user-id");
      if (!id) {
        res.status(401).json({ error: "missing x-mock-user-id header" });
        return;
      }
      const user = await loadUserById(id);
      if (!user) {
        res.status(401).json({ error: "unknown mock user" });
        return;
      }
      req.user = user;
      next();
      return;
    }

    if (config.authMode === "password") {
      const sessionId = readSessionCookie(req);
      if (!sessionId) {
        res.status(401).json({ error: "not authenticated" });
        return;
      }
      const found = await findSessionUser(sessionId);
      if (!found) {
        res.status(401).json({ error: "session expired" });
        return;
      }
      // Fire-and-forget touch so the request path stays fast. Pass the
      // session's own remember_me through so the expiry slides forward
      // by the correct TTL — a 30-day session shouldn't get downgraded
      // to 7 days on every hit.
      touchSession(sessionId, found.session.remember_me).catch((err) =>
        console.error("touchSession failed", err),
      );
      req.user = found.user;
      req.sessionId = sessionId;
      next();
      return;
    }

    res.status(500).json({ error: `unknown AUTH_MODE: ${String(config.authMode)}` });
  } catch (err) {
    console.error("auth error", err);
    res.status(401).json({ error: "authentication failed" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: `requires role: ${roles.join(" or ")}` });
      return;
    }
    next();
  };
}

/** Any write to config / lists / users → admin only. */
export const requireAdmin = requireRole("admin");
/** Any write that a reviewer can perform (mention updates, trigger scan). */
export const requireWrite = requireRole("admin", "user");
