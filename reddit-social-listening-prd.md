# PRD: RetailMeNot Reddit Social Listening Tool (Web App Prototype)

**Owner:** [Your name], VP Product
**Stakeholder:** Kathryn, VP Marketing
**Status:** Draft for prototype build
**Target environment:** Cursor (build) → Fly.io (deploy)

---

## 1. Problem & Goal

Paid marketing and CS need visibility into Reddit posts/comments that mention RetailMeNot, so they can respond to negative sentiment and spot recurring complaint themes. Today this is manual/ad hoc.

This prototype automates discovery: it periodically scans Reddit for brand mentions, applies a lightweight keyword-based negative-sentiment filter, and produces a report a human reviews and acts on. It is explicitly a **triage tool**, not an automated sentiment engine — humans confirm topic and negativity before anything is "worked."

## 2. Goals

- Automatically discover new Reddit posts (and follow-up comments on already-flagged threads) mentioning RetailMeNot
- Pre-filter to likely-negative items using an editable keyword list, to keep the report reviewable rather than a firehose
- Suggest a topic per item using an editable keyword-to-topic map
- Produce a CSV report with the fields below, plus a persistent working record of what's already been surfaced and what's been actioned
- Let a non-engineer maintain scan configuration (search terms, negative keywords, topic keywords, schedule, recipients) without code changes
- Email a digest to stakeholders when new items are found

## 3. Non-Goals (explicitly out of scope for this prototype)

- **Site-wide comment search.** Reddit's public API searches post titles/selftext, not comment bodies, sitewide. This build catches original posts sitewide, and catches *new comments on threads it has already flagged* (via the resurfacing check), but cannot discover a brand-new comment-only mention buried in an otherwise unrelated thread. Closing this fully requires a paid third-party comment-search service — Phase 2.
- **True repost detection.** Reddit's API has no field distinguishing a repost from an original submission. Reposts will show up as ordinary "Post" type items; a human flags duplicates via the Notes field.
- **AI/LLM-judged sentiment or topic classification.** Sentiment and topic are keyword-based only in this phase. Expect false positives (e.g. sarcasm, negated statements like "not disappointed") and false negatives (negative posts that don't use a listed keyword). Both `Suggested Topic` and the negative-keyword filter are starting points for human review, not final truth — hence the `Topic (Confirmed)` and `Actually Negative?` columns in the report.
- **Multi-platform monitoring** (X, Instagram, etc.) — Phase 2.
- **Positive-sentiment tracking** — Phase 2; likely needs its own topic taxonomy (great deals, good support experience, etc.) rather than reusing the negative-topic map.
- **Multi-tenant / multi-brand support.** This prototype is single-tenant, scoped to RetailMeNot only.

## 4. Users

- **Primary:** Paid marketing / social team (Kathryn's team) — reviews the report, confirms topic/negativity, works items, adds notes
- **Secondary:** CS — may also review/respond to flagged items
- **Admin:** Whoever maintains scan config (search terms, keyword lists, schedule) — should not require an engineer once set up

## 5. Functional Requirements

### 5.1 Scan Configuration (agent-managed)
An agent/admin interface lets a user manage, without touching code:

**Config variables (single record, editable):**
| Field | Type | Notes |
|---|---|---|
| Lookback Days | integer | How far back to search on each scan (default 90) |
| Search Scope | string/enum | e.g. "all subreddits" vs a defined subreddit list |
| Schedule | string/cron-like | When scans run (e.g. Mon/Wed/Fri) |
| Recipient Emails | list of strings | Who gets the digest email |
| Send Email When No New Items? | boolean | Default false — only email when there's something new, unless toggled on |

**Editable lists (CRUD via the app, not a redeploy):**
- **Search Terms** — brand name variants to query (e.g. RetailMeNot, RMN, common misspellings)
- **Negative Keywords** — substring list used for the negative-sentiment pre-filter
- **Topic Keywords** — maps a keyword/phrase → topic label (e.g. "app," "website," "code," "cashback," "customer service")

The app should let a user add/edit/remove entries in each list from the UI. This replaces the "Config sheet tabs" pattern from the original Sheets-based design — same data, now stored in the app's database instead of spreadsheet rows.

### 5.2 Scan Execution
On the configured schedule (and on-demand via a "Run now" action for testing):
1. Refresh a Reddit OAuth bearer token (client-credentials grant; token is short-lived, ~1 hour, so refresh per run rather than caching long-term)
2. For each Search Term, query Reddit's search endpoint, filtered to the configured Lookback Days and Search Scope
3. Filter results against Negative Keywords (case-insensitive substring match against title + selftext) — keep only matches
4. For each matched item, guess a topic via the Topic Keywords map; if no match, label "Uncategorized"
5. Dedupe against previously-seen Reddit post IDs (don't re-surface the same post)
6. For previously-flagged posts marked `Status = Worked`, check current comment count; if it's increased since last check, flag as resurfaced (new activity worth another look)
7. Write new rows to the report/working table
8. If new items were found (or `Send Email When No New Items?` is true), send an HTML digest email to Recipient Emails summarizing new items with links

### 5.3 Report Output
The primary deliverable is a **CSV export** with exactly these columns, in this order:

| Column | Populated by | Notes |
|---|---|---|
| Date Found | system | Date the scan surfaced this item |
| Post Date | system | Original Reddit post/comment timestamp |
| Type | system | "Post" or "Comment" |
| Permalink | system | Link to the Reddit item |
| Excerpt | system | Snippet of title/selftext or comment body |
| Matched Keyword(s) | system | Which Negative Keyword(s) triggered the match |
| Suggested Topic | system | Best guess from Topic Keywords map |
| Topic (Confirmed) | human | Reviewer overrides/confirms |
| Actually Negative? | human | Reviewer confirms true/false — corrects for false positives like sarcasm |
| Status | human | e.g. New / Worked / Resurfaced / Ignored |
| Worked By | human | Who actioned it |
| Worked Date | human | When it was actioned |
| Notes | human | Free text — e.g. flag suspected reposts here |

- The app should also persist this data in a database (not just generate a one-off CSV), so `Status`, `Worked By`, etc. can be edited in-app and the resurfacing-check logic in 5.2 has state to compare against.
- CSV export should be available on-demand from the UI, in addition to whatever's shown in the working dashboard view.

### 5.4 Working Dashboard (lightweight, in addition to CSV export)
A simple table view of current flagged items, sortable/filterable, where the human-owned columns (Topic Confirmed, Actually Negative?, Status, Worked By, Worked Date, Notes) can be edited inline — this is the in-app equivalent of the "Flagged Mentions" working sheet from the original design.

## 6. Data Model (suggested)

- **flagged_mentions** — one row per surfaced Reddit item; holds all CSV columns above plus internal fields (Reddit fullname/ID, raw JSON if useful for debugging)
- **already_flagged / dedupe_log** — one row per Reddit post ID ever seen, storing last-known comment count (for the resurfacing check); may be the same table as `flagged_mentions` with a status flag rather than a separate table
- **search_terms** — id, term, active flag
- **negative_keywords** — id, keyword, active flag
- **topic_keywords** — id, keyword, topic_label, active flag
- **config** — single row: lookback_days, search_scope, schedule, recipient_emails (array), send_email_when_no_new_items (bool)

## 7. Architecture / Tech Stack

- **Backend:** Node/Express or Python/FastAPI (dev's call) — hosts the scan logic and API routes for config CRUD
- **Database:** Postgres (Fly Postgres) for the prototype — durable, supports the dedupe/resurfacing checks properly
- **Frontend:** Simple dashboard (table + config forms) — no need for anything elaborate at prototype stage
- **Scheduling:** Fly.io scheduled machine, or an external cron (e.g. GitHub Actions) hitting a protected `/run-scan` endpoint
- **Email:** Resend, Postmark, or SendGrid for the digest (replaces Apps Script's `MailApp`)
- **Secrets:** Reddit client ID/secret and email API key stored via `fly secrets set`, never committed to the repo or exposed in the frontend

## 8. Security / Ops Notes

- Reddit credentials and email API keys live only in Fly secrets / environment variables
- The `/run-scan` endpoint (if triggered externally) should require an auth token, not be publicly callable
- No PII beyond Reddit usernames/public post content is being stored — but treat the recipient email list and any internal notes as internal-only data

## 9. Open Questions for Kathryn / stakeholders

- Search Scope: is "all of Reddit" the right default, or should specific subreddits be prioritized/excluded (e.g. r/personalfinance, r/frugal)?
- Who are the initial Recipient Emails, and does the digest need role-based recipients later (CS vs. marketing)?
- Who is the initial admin for search terms/keyword lists — Kathryn's team directly, or does that route through you?

## 10. Phase 2 (explicitly deferred)

- LLM-based sentiment/topic classification to replace keyword matching
- Paid comment-search integration to close the sitewide comment-detection gap
- Multi-platform expansion (X, Instagram, etc.)
- Positive-sentiment tracking with its own topic taxonomy
- Multi-brand/multi-tenant support if this proves valuable beyond RetailMeNot

## 11. Acceptance Criteria for Prototype

- [ ] Admin can add/edit/remove Search Terms, Negative Keywords, and Topic Keywords via the UI (no code changes required)
- [ ] Admin can edit all Config variables via the UI
- [ ] "Run now" triggers a scan and populates new rows in the dashboard
- [ ] Scheduled scans run automatically per the configured Schedule
- [ ] Dedupe works — re-running a scan does not duplicate already-seen items
- [ ] Resurfacing check correctly flags increased comment activity on `Worked` items
- [ ] CSV export produces all 13 columns in the specified order, matching current dashboard state
- [ ] Digest email sends on new items found, and respects the `Send Email When No New Items?` toggle
- [ ] Reddit credentials are not exposed in frontend code, logs, or the repo
