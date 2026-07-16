/**
 * Scan orchestrator.
 *
 * Called from three places: cron, the "Run now" button on the
 * dashboard, and the bearer-token webhook `POST /api/scan/run` for
 * external triggers. All three call `runScan()`.
 *
 * Steps (PRD §5.2):
 *   1. Load config + all active search terms / negative keywords /
 *      topic keywords in one snapshot.
 *   2. Refresh Reddit OAuth token (per-run — Reddit tokens are ~1h).
 *   3. For each search term, query search.json filtered to
 *      lookback_days + search_scope.
 *   4. Filter results against negative_keywords (case-insensitive
 *      substring on title + selftext).
 *   5. For each surviving hit, guess a topic via topic_keywords map.
 *   6. Skip anything already in flagged_mentions (dedupe by reddit_id).
 *   7. Insert new rows.
 *   8. Resurfacing check: for every mention where status='worked',
 *      look up current num_comments; if it grew since last check,
 *      set status='resurfaced' and update last_comment_count.
 *   9. Send digest email if new or resurfaced items > 0, or if
 *      send_email_when_no_new_items is on.
 *
 * The scan_runs row is created up front (status=running) so a hung
 * network call is visible in the UI, and updated to success/error at
 * the end regardless of what threw.
 */
import { config as appConfig } from "../config.js";
import { query, withTransaction } from "../db/pool.js";
import { sendDigest } from "../email/digest.js";
import { buildExcerpt, guessTopic, matchKeywords } from "../lib/text.js";
import {
  fetchPostInfo,
  fetchRedditToken,
  searchReddit,
  type RedditPostSummary,
  type RedditSearchScope,
} from "../reddit/client.js";
import type {
  ConfigRow,
  FlaggedMentionRow,
  NegativeKeywordRow,
  ScanRunRow,
  ScanRunTrigger,
  SearchTermRow,
  TopicKeywordRow,
} from "../types.js";

export type RunScanOptions = {
  triggeredBy: ScanRunTrigger;
  triggeredByUserId?: string | null;
  /**
   * Test-mode: skips outbound HTTP to Reddit + email. Used by the
   * smoke test to exercise the DB path (insert, dedupe, scan_runs
   * bookkeeping) without needing real Reddit credentials in CI.
   * Writes one synthetic flagged_mention with a rotating reddit_id so
   * dedupe still triggers on the second synthetic run.
   */
  testMode?: boolean;
};

export type RunScanResult = {
  scan_run: ScanRunRow;
  new_items: number;
  resurfaced_items: number;
  items_found: number;
};

export async function runScan(opts: RunScanOptions): Promise<RunScanResult> {
  const scanRun = await startScanRun(opts.triggeredBy, opts.triggeredByUserId ?? null);
  const startedAt = Date.now();

  try {
    const cfg = await loadConfig();
    const searchTerms = await loadActiveSearchTerms();
    const negativeKeywords = await loadActiveNegativeKeywords();
    const topicKeywords = await loadActiveTopicKeywords();

    let posts: RedditPostSummary[] = [];
    let resurfacedIds: string[] = [];

    if (opts.testMode) {
      // Synthetic post so the insert / dedupe / update path runs
      // without needing real Reddit credentials.
      posts = syntheticPosts();
    } else {
      if (searchTerms.length === 0) {
        throw new Error("no active search terms — add at least one in Settings");
      }
      const bearer = await fetchRedditToken();
      const scope = scopeFromConfig(cfg);
      const timeoutAt = startedAt + appConfig.scanTimeoutMs;
      for (const term of searchTerms) {
        if (Date.now() > timeoutAt) {
          throw new Error(`scan exceeded ${appConfig.scanTimeoutMs}ms wall-clock budget`);
        }
        const batch = await searchReddit(bearer, term.term, cfg.lookback_days, scope);
        posts.push(...batch);
      }

      // Resurfacing check runs before we return — the fresh bearer is
      // still valid and we already have the fetch machinery loaded.
      resurfacedIds = await resurfacingCheck(bearer);
    }

    const itemsFound = posts.length;

    // Filter to hits that touch a negative keyword. Keep only those.
    const negatives = negativeKeywords.map((k) => k.keyword);
    // Sort topic keywords longer-first so "customer service" beats "service".
    const topicsForMatching = [...topicKeywords].sort(
      (a, b) => b.keyword.length - a.keyword.length,
    );

    const candidates: {
      post: RedditPostSummary;
      matched: string[];
      topic: { label: string; source_keyword: string | null };
    }[] = [];

    for (const post of posts) {
      const haystack = `${post.title}\n${post.selftext}`;
      const matched = matchKeywords(haystack, negatives);
      if (matched.length === 0) continue;
      const topic = guessTopic(haystack, topicsForMatching);
      candidates.push({ post, matched, topic });
    }

    // Insert-if-new. We rely on the reddit_id UNIQUE constraint +
    // ON CONFLICT DO NOTHING for atomic dedupe — no separate
    // "have I seen this?" round-trip.
    let newItems = 0;
    for (const { post, matched, topic } of candidates) {
      const excerpt = buildExcerpt(`${post.title}\n${post.selftext}`, matched);
      const inserted = await query(
        `INSERT INTO flagged_mentions
           (reddit_id, type, permalink, subreddit, author, title, excerpt,
            matched_keywords, suggested_topic, suggested_topic_source_keyword,
            post_date, last_comment_count, raw_json)
         VALUES
           ($1, 'post', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (reddit_id) DO NOTHING`,
        [
          post.reddit_id,
          post.permalink,
          post.subreddit,
          post.author,
          post.title,
          excerpt,
          matched,
          topic.label,
          topic.source_keyword,
          post.created_utc.toISOString(),
          post.num_comments,
          JSON.stringify(post.raw),
        ],
      );
      if (inserted.rowCount === 1) newItems++;
    }

    const resurfacedCount = resurfacedIds.length;

    // Email digest gate (PRD §5.2 step 8).
    const shouldEmail =
      !opts.testMode &&
      cfg.recipient_emails.length > 0 &&
      (newItems > 0 || resurfacedCount > 0 || cfg.send_email_when_no_new_items);
    if (shouldEmail) {
      // Fire-and-forget — the digest send should never fail the scan;
      // record failure to logs and continue.
      sendDigest({
        recipients: cfg.recipient_emails,
        newItemIds: [], // filled by digest.ts via a fresh DB query
        newItemsCount: newItems,
        resurfacedCount,
      }).catch((err) => console.error("[scan] digest send failed", err));
    }

    const finished = await finishScanRun(scanRun.id, {
      status: "success",
      items_found: itemsFound,
      new_items: newItems,
      resurfaced_items: resurfacedCount,
    });

    console.log(
      `[scan] ${opts.triggeredBy} → ${newItems} new, ${resurfacedCount} resurfaced, ${itemsFound} total items in ${
        Date.now() - startedAt
      }ms`,
    );

    return {
      scan_run: finished,
      new_items: newItems,
      resurfaced_items: resurfacedCount,
      items_found: itemsFound,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[scan] error", err);
    const finished = await finishScanRun(scanRun.id, {
      status: "error",
      error_message: msg,
    });
    return {
      scan_run: finished,
      new_items: 0,
      resurfaced_items: 0,
      items_found: 0,
    };
  }
}

/**
 * Resurfacing check (PRD §5.2 step 6). For every mention where
 * status='worked' (or 'resurfaced' — re-check those so a second bump
 * still counts), look up current num_comments and compare against the
 * stored value. Increased? Mark resurfaced + update the counter.
 *
 * Returns the list of reddit_ids that got resurfaced this pass — the
 * digest email uses these counts.
 */
async function resurfacingCheck(bearer: string): Promise<string[]> {
  const { rows } = await query<Pick<FlaggedMentionRow, "id" | "reddit_id" | "last_comment_count">>(
    `SELECT id, reddit_id, last_comment_count
       FROM flagged_mentions
      WHERE status IN ('worked', 'resurfaced')
        AND type = 'post'`,
  );
  if (rows.length === 0) return [];

  const info = await fetchPostInfo(
    bearer,
    rows.map((r) => r.reddit_id),
  );

  const resurfaced: string[] = [];
  for (const r of rows) {
    const now = info.get(r.reddit_id);
    if (!now) continue; // post deleted or hidden — leave the record alone
    if (now.num_comments > r.last_comment_count) {
      await query(
        `UPDATE flagged_mentions
            SET status = 'resurfaced',
                last_comment_count = $1,
                updated_at = NOW()
          WHERE id = $2`,
        [now.num_comments, r.id],
      );
      resurfaced.push(r.reddit_id);
    }
  }
  return resurfaced;
}

// -----------------------------------------------------------------
// Config + list loaders (kept private so the scan pipeline sees a
// consistent snapshot even if the admin edits mid-scan).
// -----------------------------------------------------------------

async function loadConfig(): Promise<ConfigRow> {
  const { rows } = await query<ConfigRow>(`SELECT * FROM config WHERE id = 1`);
  if (!rows[0]) throw new Error("config row missing (migrations not run?)");
  return rows[0];
}

async function loadActiveSearchTerms(): Promise<SearchTermRow[]> {
  const { rows } = await query<SearchTermRow>(
    `SELECT * FROM search_terms WHERE active = TRUE ORDER BY created_at ASC`,
  );
  return rows;
}

async function loadActiveNegativeKeywords(): Promise<NegativeKeywordRow[]> {
  const { rows } = await query<NegativeKeywordRow>(
    `SELECT * FROM negative_keywords WHERE active = TRUE ORDER BY created_at ASC`,
  );
  return rows;
}

async function loadActiveTopicKeywords(): Promise<TopicKeywordRow[]> {
  const { rows } = await query<TopicKeywordRow>(
    `SELECT * FROM topic_keywords WHERE active = TRUE ORDER BY created_at ASC`,
  );
  return rows;
}

function scopeFromConfig(cfg: ConfigRow): RedditSearchScope {
  if (cfg.search_scope === "subreddits" && cfg.subreddits.length > 0) {
    return { kind: "subreddits", subreddits: cfg.subreddits };
  }
  return { kind: "all" };
}

// -----------------------------------------------------------------
// scan_runs bookkeeping
// -----------------------------------------------------------------

async function startScanRun(
  triggeredBy: ScanRunTrigger,
  triggeredByUserId: string | null,
): Promise<ScanRunRow> {
  const { rows } = await query<ScanRunRow>(
    `INSERT INTO scan_runs (triggered_by, triggered_by_user_id)
     VALUES ($1, $2)
     RETURNING *`,
    [triggeredBy, triggeredByUserId],
  );
  return rows[0]!;
}

async function finishScanRun(
  id: string,
  patch: {
    status: "success" | "error";
    items_found?: number;
    new_items?: number;
    resurfaced_items?: number;
    error_message?: string;
  },
): Promise<ScanRunRow> {
  const { rows } = await query<ScanRunRow>(
    `UPDATE scan_runs
        SET status = $1,
            items_found = COALESCE($2, items_found),
            new_items = COALESCE($3, new_items),
            resurfaced_items = COALESCE($4, resurfaced_items),
            error_message = $5,
            finished_at = NOW()
      WHERE id = $6
      RETURNING *`,
    [
      patch.status,
      patch.items_found ?? null,
      patch.new_items ?? null,
      patch.resurfaced_items ?? null,
      patch.error_message ?? null,
      id,
    ],
  );
  return rows[0]!;
}

// -----------------------------------------------------------------
// Test-mode synthetic input.
//
// Stable `reddit_id` so re-runs of the smoke test locally hit the
// dedupe path (return `new_items: 0`) instead of accumulating a fresh
// row every time.
//
// Permalink deliberately points at Reddit's homepage (not a fabricated
// `r/…/comments/…/` URL that returns a 404) — earlier drafts had a
// URL-with-timestamp scheme that misled reviewers into thinking these
// were real hits. Title is explicitly prefixed with [TEST] for the
// same reason.
// -----------------------------------------------------------------
function syntheticPosts(): RedditPostSummary[] {
  return [
    {
      reddit_id: "t3_smoketest_v1",
      kind: "post",
      id: "smoketest_v1",
      title: "[TEST] Synthetic scan-engine mention — not a real Reddit post",
      // "scam" is one of the seeded negative keywords — it's embedded
      // here on purpose so the scan engine's negative-keyword filter
      // matches and the insert / dedupe path actually gets exercised.
      // If you rename or drop that seed keyword, tweak this too.
      selftext:
        "This row was inserted by POST /api/scan/run {test_mode: true} to exercise the DB insert + dedupe path without hitting Reddit. Contains the word scam so the negative-keyword filter matches. Safe to delete.",
      author: "smoketest",
      subreddit: "smoketest",
      permalink: "https://www.reddit.com/",
      url: "https://www.reddit.com/",
      num_comments: 0,
      created_utc: new Date(),
      raw: { synthetic: true },
    },
  ];
}

// Explicit export used by tests / not-yet-added scripts. Keeps
// `withTransaction` from being tree-shaken out of the type graph
// if we ever need to bulk-insert scan output.
export { withTransaction };
