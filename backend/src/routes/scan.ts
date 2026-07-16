import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { authenticate, requireWrite } from "../middleware/auth.js";
import { runScan } from "../scan/engine.js";
import type { ScanRunRow } from "../types.js";

export const scanRouter = Router();

/**
 * POST /api/scan/run
 *
 * Two ways to trigger:
 *   1. Logged-in admin/user via session cookie → triggered_by='manual'.
 *   2. External cron with bearer token → triggered_by='external'.
 *
 * The bearer path exists so a GitHub Actions cron (or any other
 * outside scheduler) can hit us without impersonating a user. We
 * DELIBERATELY do NOT accept session AND bearer at once — pick one.
 *
 * Body: `{ test_mode?: boolean }` — when true (and the caller is
 * authenticated), skips outbound HTTP and inserts a synthetic
 * mention. Powers the CI smoke test.
 */

const runSchema = z.object({
  test_mode: z.boolean().optional(),
});

scanRouter.post("/run", async (req, res, next) => {
  const body = runSchema.parse(req.body ?? {});

  // Bearer-token path (external cron). If SCAN_TRIGGER_TOKEN is
  // unset, fall through to the session-cookie path — external cron
  // is optional.
  const authz = req.header("authorization") ?? "";
  const bearer = authz.startsWith("Bearer ") ? authz.slice(7).trim() : null;
  if (bearer && config.scanTriggerToken && bearer === config.scanTriggerToken) {
    const result = await runScan({ triggeredBy: "external" });
    res.json(result);
    return;
  }
  if (bearer && (!config.scanTriggerToken || bearer !== config.scanTriggerToken)) {
    res.status(401).json({ error: "invalid scan trigger bearer" });
    return;
  }

  // No bearer → require an authenticated session with write role.
  authenticate(req, res, (err?: unknown) => {
    if (err) return next(err);
    requireWrite(req, res, async (err2?: unknown) => {
      if (err2) return next(err2);
      const result = await runScan({
        triggeredBy: body.test_mode ? "test" : "manual",
        triggeredByUserId: req.user!.id,
        testMode: body.test_mode,
      });
      res.json(result);
    });
  });
});

/**
 * GET /api/scan/runs — recent run history for the "Last scan" strip
 * at the top of the dashboard. Auth'd users only.
 */
scanRouter.get("/runs", authenticate, async (_req, res) => {
  const { rows } = await query<ScanRunRow>(
    `SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 50`,
  );
  res.json({ runs: rows });
});
