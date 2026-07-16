import { config } from "../config.js";

/**
 * Minimal Reddit client for the scan pipeline. Two responsibilities:
 *
 *   1. Refresh an app-only bearer token (client-credentials grant).
 *      Tokens are ~1h; we re-fetch per scan rather than cache long-term
 *      so we never hit the "cached token expired mid-scan" bug and so
 *      the client stays stateless.
 *   2. Call the search endpoint and normalize the wrapped `Listing`
 *      response into a flat array of the fields the scan engine cares
 *      about.
 *
 * Everything else Reddit exposes (comments/details/subreddit meta)
 * happens directly against oauth.reddit.com from the caller, no need
 * for a generic wrapper right now.
 *
 * Note: Reddit's public search hits POST TITLE + SELFTEXT only. It
 * does NOT search comment bodies sitewide — that's the phase-2 gap
 * called out in the PRD.
 */

const OAUTH_HOST = "https://oauth.reddit.com";
const AUTH_HOST = "https://www.reddit.com";

// Small hard cap on results per query to keep any single scan bounded.
// Reddit's ?limit maxes at 100; we default lower and paginate if the
// caller needs more.
const DEFAULT_LIMIT = 100;

/** Reddit "fullname" prefixes we care about. */
export const REDDIT_KIND_POST = "t3";
export const REDDIT_KIND_COMMENT = "t1";

export type RedditSearchScope = { kind: "all" } | { kind: "subreddits"; subreddits: string[] };

export type RedditPostSummary = {
  /** Fullname, e.g. "t3_abc123". Doubles as the dedupe key. */
  reddit_id: string;
  kind: "post";
  id: string;
  title: string;
  selftext: string;
  author: string | null;
  subreddit: string;
  permalink: string;
  url: string;
  num_comments: number;
  created_utc: Date;
  raw: unknown;
};

/**
 * Refresh an app-only bearer token. Throws on non-200 or missing
 * access_token so the caller can mark the scan_run as errored with a
 * usable message.
 */
export async function fetchRedditToken(): Promise<string> {
  if (!config.reddit.clientId || !config.reddit.clientSecret) {
    throw new Error(
      "Reddit credentials not configured (REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET)",
    );
  }
  const basic = Buffer.from(
    `${config.reddit.clientId}:${config.reddit.clientSecret}`,
  ).toString("base64");

  const res = await fetch(`${AUTH_HOST}/api/v1/access_token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": config.reddit.userAgent,
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Reddit token fetch failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!json.access_token) {
    throw new Error(`Reddit token response missing access_token: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

/**
 * Search Reddit for a single query term, filtered to the given lookback
 * window and search scope. Results are already deduped BY REDDIT ID
 * against each other in this batch (the API can return the same post
 * under different searches; we dedupe here so the caller doesn't have
 * to).
 *
 * `restrict_sr` toggling:
 *   - scope.kind = 'all' → search all of Reddit, ordered new.
 *   - scope.kind = 'subreddits' → one query per subreddit in the list,
 *     restricted to that sub. Results are merged.
 */
export async function searchReddit(
  bearer: string,
  query: string,
  lookbackDays: number,
  scope: RedditSearchScope,
  limit = DEFAULT_LIMIT,
): Promise<RedditPostSummary[]> {
  const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  const seen = new Set<string>();
  const out: RedditPostSummary[] = [];

  const targets =
    scope.kind === "all"
      ? [{ sr: null as string | null }]
      : scope.subreddits.map((sr) => ({ sr }));

  for (const target of targets) {
    const url = new URL(
      target.sr
        ? `${OAUTH_HOST}/r/${encodeURIComponent(target.sr)}/search.json`
        : `${OAUTH_HOST}/search.json`,
    );
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("sort", "new");
    url.searchParams.set("t", "year"); // API-side coarse filter; we still time-filter below.
    if (target.sr) url.searchParams.set("restrict_sr", "on");

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${bearer}`,
        "User-Agent": config.reddit.userAgent,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Reddit search failed for q="${query}" sr=${target.sr ?? "*"}: ${res.status} ${body}`,
      );
    }

    const json = (await res.json()) as RedditListingResponse;
    const children = json?.data?.children ?? [];

    for (const child of children) {
      if (child.kind !== REDDIT_KIND_POST) continue; // ignore any non-post kinds in results
      const d = child.data;
      const fullname = `${child.kind}_${d.id}`;
      if (seen.has(fullname)) continue;
      const createdMs = d.created_utc * 1000;
      if (createdMs < cutoffMs) continue;

      seen.add(fullname);
      out.push({
        reddit_id: fullname,
        kind: "post",
        id: d.id,
        title: d.title ?? "",
        selftext: d.selftext ?? "",
        author: d.author ?? null,
        subreddit: d.subreddit ?? target.sr ?? "",
        permalink: d.permalink ? `https://www.reddit.com${d.permalink}` : d.url,
        url: d.url,
        num_comments: d.num_comments ?? 0,
        created_utc: new Date(createdMs),
        raw: child,
      });
    }
  }

  return out;
}

/**
 * Fetch current metadata for a set of already-known post fullnames.
 * Used by the resurfacing check: for each Worked mention, we look up
 * `num_comments` and compare against the stored last_comment_count.
 *
 * Reddit's /api/info takes a comma-separated `id` param, and one call
 * can return up to 100 items, so batch accordingly.
 */
export async function fetchPostInfo(
  bearer: string,
  fullnames: string[],
): Promise<Map<string, { num_comments: number; raw: unknown }>> {
  const out = new Map<string, { num_comments: number; raw: unknown }>();
  if (fullnames.length === 0) return out;

  const BATCH = 100;
  for (let i = 0; i < fullnames.length; i += BATCH) {
    const batch = fullnames.slice(i, i + BATCH);
    const url = new URL(`${OAUTH_HOST}/api/info.json`);
    url.searchParams.set("id", batch.join(","));

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${bearer}`,
        "User-Agent": config.reddit.userAgent,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Reddit info fetch failed: ${res.status} ${body}`);
    }

    const json = (await res.json()) as RedditListingResponse;
    for (const child of json?.data?.children ?? []) {
      const d = child.data;
      const fullname = `${child.kind}_${d.id}`;
      out.set(fullname, { num_comments: d.num_comments ?? 0, raw: child });
    }
  }
  return out;
}

// -----------------------------------------------------------------
// Minimal Reddit API JSON shape we depend on. Everything else we
// pass through as `raw` and store in flagged_mentions.raw_json.
// -----------------------------------------------------------------
type RedditListingResponse = {
  data?: {
    children?: RedditListingChild[];
  };
};

type RedditListingChild = {
  kind: string; // "t3" | "t1" | ...
  data: {
    id: string;
    title?: string;
    selftext?: string;
    author?: string;
    subreddit?: string;
    permalink?: string;
    url: string;
    num_comments?: number;
    created_utc: number; // seconds
  };
};
