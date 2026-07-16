import { Router } from "express";
import cron from "node-cron";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireAdmin } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import { reloadScheduler } from "../jobs/scanCron.js";
import type { ConfigRow } from "../types.js";

export const configRouter = Router();

/**
 * Single-row config. GET returns the row (created by the initial
 * migration so this always returns something). PUT replaces the
 * mutable fields wholesale — no per-field patch since the settings
 * form always sends the full object.
 */

configRouter.get("/", async (_req, res) => {
  const { rows } = await query<ConfigRow>(`SELECT * FROM config WHERE id = 1`);
  if (!rows[0]) throw new HttpError(500, "config row missing");
  res.json({ config: rows[0] });
});

const putSchema = z.object({
  lookback_days: z.number().int().positive().max(365),
  search_scope: z.enum(["all", "subreddits"]),
  subreddits: z.array(z.string().min(1).max(64)).max(100),
  schedule_cron: z
    .string()
    .min(1)
    .max(120)
    .refine((s) => cron.validate(s), {
      message: "invalid cron expression (expected 5-field syntax)",
    }),
  schedule_timezone: z.string().min(1).max(60),
  recipient_emails: z.array(z.string().email()).max(50),
  send_email_when_no_new_items: z.boolean(),
});

configRouter.put("/", requireAdmin, async (req, res) => {
  const body = putSchema.parse(req.body);

  // Belt-and-suspenders: only persist the subreddits list when the
  // scope actually uses it. Prevents a stale list from silently
  // becoming active later if the admin toggles scope back to
  // 'subreddits' without re-typing.
  const subs = body.search_scope === "subreddits" ? body.subreddits : [];

  const { rows } = await query<ConfigRow>(
    `UPDATE config
        SET lookback_days = $1,
            search_scope = $2,
            subreddits = $3,
            schedule_cron = $4,
            schedule_timezone = $5,
            recipient_emails = $6,
            send_email_when_no_new_items = $7,
            updated_at = NOW()
      WHERE id = 1
      RETURNING *`,
    [
      body.lookback_days,
      body.search_scope,
      subs,
      body.schedule_cron,
      body.schedule_timezone,
      body.recipient_emails,
      body.send_email_when_no_new_items,
    ],
  );
  const cfg = rows[0]!;

  // Cron / timezone may have changed — reregister the in-process
  // scheduler so the next tick lands at the new cadence. No-op when
  // the scheduler is disabled via env.
  reloadScheduler().catch((err) => console.error("[cron] reload after config save failed", err));

  res.json({ config: cfg });
});
