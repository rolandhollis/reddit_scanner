/**
 * In-process cron scheduler for periodic scans.
 *
 * The scheduled expression + timezone live in the `config` row so an
 * admin can retune the cadence without redeploying. On boot we read
 * the row and register the task; the config PUT handler calls
 * `reloadScheduler()` after each save so a change takes effect
 * immediately.
 *
 * When SCHEDULER_ENABLED=false the module still exports the same API
 * but no task is registered — useful when the app is fronted by an
 * external cron (GitHub Actions, Fly scheduled machine) that hits
 * `/api/scan/run` with the bearer token instead.
 */
import cron, { type ScheduledTask } from "node-cron";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { runScan } from "../scan/engine.js";
import type { ConfigRow } from "../types.js";

let current: {
  task: ScheduledTask;
  cronExpr: string;
  timezone: string;
} | null = null;

/** Called once from index.ts at boot. Safe to call multiple times —
 *  a running task is stopped before a replacement is registered. */
export async function startScheduler(): Promise<void> {
  if (!config.schedulerEnabled) {
    console.log("[cron] SCHEDULER_ENABLED=false — in-process scheduler disabled");
    return;
  }
  await reloadScheduler();
}

/** Re-register the task with the current config-row schedule. Called
 *  by the config PUT handler after each save so a cron change lands
 *  right away, and by startScheduler at boot. */
export async function reloadScheduler(): Promise<void> {
  if (!config.schedulerEnabled) return;

  const { rows } = await query<Pick<ConfigRow, "schedule_cron" | "schedule_timezone">>(
    `SELECT schedule_cron, schedule_timezone FROM config WHERE id = 1`,
  );
  const cfg = rows[0];
  if (!cfg) {
    console.warn("[cron] config row missing — skipping scheduler registration");
    return;
  }

  if (!cron.validate(cfg.schedule_cron)) {
    console.error(
      `[cron] invalid schedule_cron '${cfg.schedule_cron}' — leaving prior schedule in place`,
    );
    return;
  }

  // No change → no work.
  if (
    current &&
    current.cronExpr === cfg.schedule_cron &&
    current.timezone === cfg.schedule_timezone
  ) {
    return;
  }

  if (current) {
    try {
      current.task.stop();
    } catch (err) {
      console.error("[cron] failed to stop previous task", err);
    }
    current = null;
  }

  const task = cron.schedule(
    cfg.schedule_cron,
    async () => {
      try {
        await runScan({ triggeredBy: "cron" });
      } catch (err) {
        console.error("[cron] scheduled scan failed", err);
      }
    },
    { scheduled: true, timezone: cfg.schedule_timezone },
  );
  current = { task, cronExpr: cfg.schedule_cron, timezone: cfg.schedule_timezone };
  console.log(
    `[cron] scheduled scan at "${cfg.schedule_cron}" (${cfg.schedule_timezone})`,
  );
}

/** Exposed for tests / graceful shutdown. */
export function stopScheduler(): void {
  if (current) {
    current.task.stop();
    current = null;
  }
}
