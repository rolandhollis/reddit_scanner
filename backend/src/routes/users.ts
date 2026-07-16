import { Router } from "express";
import { z } from "zod";
import {
  formatPasswordErrors,
  generatePassword,
  hashPassword,
  validatePassword,
} from "../auth/password.js";
import { deleteSessionsForUser } from "../auth/session.js";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { requireAdmin } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import type { UserRow } from "../types.js";

export const usersRouter = Router();

/**
 * Users API surface:
 *   GET  /                   → list users (any auth'd user)
 *   POST /                   → create user (admin only)
 *   PUT  /:id                → edit user (admin only) — name / role
 *   POST /:id/reset-password → admin-triggered password reset;
 *                              generates a new password, returns it
 *                              once (caller pastes to the user), and
 *                              kills all their sessions.
 *   DELETE /:id              → delete user (admin only). Self-delete
 *                              blocked to avoid an admin locking
 *                              themselves out.
 *
 *   GET  /mock-roster        → mock-mode only; unauthenticated. Powers
 *                              the login dropdown when AUTH_MODE=mock.
 */

const roleSchema = z.enum(["admin", "user", "viewer"]);

// -----------------------------------------------------------------
// Mock roster (only meaningful when AUTH_MODE=mock)
// -----------------------------------------------------------------
usersRouter.get("/mock-roster", async (_req, res) => {
  if (config.authMode !== "mock") {
    res.status(404).end();
    return;
  }
  const { rows } = await query<Pick<UserRow, "id" | "name" | "email" | "role">>(
    `SELECT id, name, email, role FROM users ORDER BY role, name`,
  );
  res.json({ users: rows });
});

// -----------------------------------------------------------------
// List / read
// -----------------------------------------------------------------
usersRouter.get("/", async (_req, res) => {
  const { rows } = await query<Omit<UserRow, "password_hash">>(
    `SELECT id, email, name, role, password_updated_at, is_super_user, created_at, updated_at
       FROM users
       ORDER BY role, name`,
  );
  res.json({ users: rows });
});

// -----------------------------------------------------------------
// Create (admin only)
// -----------------------------------------------------------------
const createSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().min(1).max(200),
  role: roleSchema,
});

usersRouter.post("/", requireAdmin, async (req, res) => {
  const body = createSchema.parse(req.body);

  // In password mode, generate an initial password and return it
  // once. The admin pastes it to the new user out-of-band. In mock
  // mode we skip password provisioning since the switcher doesn't
  // ask for one.
  let generated: string | null = null;
  let hash: string | null = null;
  if (config.authMode === "password") {
    generated = generatePassword();
    hash = await hashPassword(generated);
  }

  const { rows } = await query<UserRow>(
    `INSERT INTO users (email, name, role, password_hash, password_updated_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 IS NULL THEN NULL ELSE NOW() END)
     RETURNING id, email, name, role, password_updated_at, is_super_user, created_at, updated_at`,
    [body.email, body.name, body.role, hash],
  );

  res.status(201).json({ user: rows[0], initial_password: generated });
});

// -----------------------------------------------------------------
// Update (admin only)
// -----------------------------------------------------------------
const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  role: roleSchema.optional(),
});

usersRouter.put("/:id", requireAdmin, async (req, res) => {
  const body = updateSchema.parse(req.body);

  // Guard: can't demote the last remaining admin. Otherwise a single
  // admin could accidentally lock the whole team out of Settings.
  if (body.role && body.role !== "admin") {
    const target = await getUserOrThrow(req.params.id!);
    if (target.role === "admin") {
      const { rows: counts } = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin'`,
      );
      const adminCount = Number(counts[0]?.count ?? "0");
      if (adminCount <= 1) {
        throw new HttpError(400, "cannot demote the last remaining admin");
      }
    }
  }

  const { rows } = await query<UserRow>(
    `UPDATE users
        SET name = COALESCE($1, name),
            role = COALESCE($2, role),
            updated_at = NOW()
      WHERE id = $3
      RETURNING id, email, name, role, password_updated_at, is_super_user, created_at, updated_at`,
    [body.name ?? null, body.role ?? null, req.params.id],
  );
  if (!rows[0]) throw new HttpError(404, "user not found");
  res.json({ user: rows[0] });
});

// -----------------------------------------------------------------
// Admin-triggered password reset
// -----------------------------------------------------------------
usersRouter.post("/:id/reset-password", requireAdmin, async (req, res) => {
  if (config.authMode !== "password") {
    throw new HttpError(400, "auth mode does not use passwords");
  }
  const target = await getUserOrThrow(req.params.id!);

  const generated = generatePassword();
  // Sanity: generated passwords should always pass our own policy,
  // but check anyway so a botched generator can't silently ship a
  // weak reset.
  const errs = validatePassword(generated, target.email);
  if (errs.length) {
    throw new HttpError(500, `generated password failed policy: ${formatPasswordErrors(errs).join("; ")}`);
  }

  const hash = await hashPassword(generated);
  await query(
    `UPDATE users
        SET password_hash = $1, password_updated_at = NOW(), updated_at = NOW()
      WHERE id = $2`,
    [hash, target.id],
  );
  // Kill every active session for this user — a reset is a security
  // event, they should re-log everywhere.
  await deleteSessionsForUser(target.id);

  res.json({ new_password: generated });
});

// -----------------------------------------------------------------
// Delete (admin only)
// -----------------------------------------------------------------
usersRouter.delete("/:id", requireAdmin, async (req, res) => {
  if (req.user!.id === req.params.id) {
    throw new HttpError(400, "cannot delete yourself");
  }
  const { rowCount } = await query(`DELETE FROM users WHERE id = $1`, [req.params.id]);
  if (rowCount === 0) throw new HttpError(404, "user not found");
  res.status(204).end();
});

// -----------------------------------------------------------------
// helpers
// -----------------------------------------------------------------
async function getUserOrThrow(id: string): Promise<UserRow> {
  const { rows } = await query<UserRow>(`SELECT * FROM users WHERE id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, "user not found");
  return rows[0];
}

