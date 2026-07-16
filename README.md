# Reddit Scanner

A social-listening triage tool for a single brand (initially RetailMeNot). It
periodically scans Reddit for brand mentions, applies an editable
keyword-based negative-sentiment filter, guesses a topic per item, and
produces a reviewable dashboard + CSV export + optional email digest.

**Explicitly a triage tool, not an automated sentiment engine** — humans
confirm topic and negativity before anything is "worked." See
[reddit-social-listening-prd.md](reddit-social-listening-prd.md) for the
full PRD, non-goals, and phase-2 items.

## What it does

1. **Scans** Reddit on a configurable cron (`Mon/Wed/Fri 9am` by default)
   using OAuth client-credentials against `search.json`.
2. **Pre-filters** hits against an editable negative-keyword list to keep the
   report reviewable rather than a firehose.
3. **Suggests a topic** per item using an editable keyword-to-topic map;
   items with no keyword hit are labeled `Uncategorized`.
4. **Dedupes** against previously-seen Reddit IDs so re-runs don't
   re-surface the same post.
5. **Flags resurfaced items** — when a `Worked` post gains new comments
   since we last checked, it's re-flagged for another look.
6. **Emails a digest** to the configured recipient list when new items are
   found (or every run if `send_email_when_no_new_items` is on).
7. Presents a **dashboard** where the marketing/CS reviewer confirms topic,
   marks items `Worked / Ignored / Resurfaced`, and adds notes.
8. Exports the full **13-column CSV** matching the PRD spec on demand.

Non-goals for this prototype (comment-body search sitewide, LLM sentiment,
multi-brand/tenant, positive-sentiment tracking) are listed in the PRD.

## Stack

- **Frontend:** React 18 + Vite + TypeScript, Tailwind CSS + Radix UI
  primitives, TanStack Query, React Router.
- **Backend:** Node.js 20 + Express + TypeScript, `pg`, `zod`, `node-cron`,
  `date-fns-tz`, `bcryptjs`, `resend`.
- **Database:** PostgreSQL 16 (Docker Compose locally, Fly Postgres in prod).
- **Deploy:** Single Docker image serves compiled SPA + API. GitHub Actions
  runs typecheck + smoke on every PR and auto-deploys `main` to
  [Fly.io](https://fly.io) — full runbook in [DEPLOY.md](DEPLOY.md).

## Local setup

Prerequisites: Node 20+, npm, Docker Desktop.

```bash
# 1. Start Postgres
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env    # then fill in Reddit + Resend credentials
npm install
npm run migrate
npm run seed
npm run dev             # http://localhost:4100

# 3. Frontend (in a second terminal)
cd frontend
cp .env.example .env
npm install
npm run dev             # http://localhost:5273
```

> Dev ports are 4100 / 5273 (not the Vite/Node defaults 4000 / 5173) so
> this app can run at the same time as sibling apps like Waypoint. The
> production Docker image still exposes 4000 — see [DEPLOY.md](DEPLOY.md).

Open `http://localhost:5273` and log in as the seeded admin
(`admin@example.com` / `ChangeMeNow!2026` — override via `SUPER_ADMIN_EMAIL`
/ `SUPER_ADMIN_PASSWORD` in `backend/.env`).

### Getting Reddit API credentials

1. Log in to Reddit and visit <https://www.reddit.com/prefs/apps>.
2. Click "create another app…", pick **script** (client-credentials works
   for this even though the label is confusing), leave `redirect uri` as
   `http://localhost`.
3. The **client id** is the string just under the app name; the **client
   secret** is the `secret` field.
4. Set both in `backend/.env` as `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`,
   and pick a `REDDIT_USER_AGENT` like `reddit-scanner (by /u/your_username)`
   — Reddit rate-limits opaque UAs harder.

## Repository layout

```
backend/                 Express API, migrations, cron jobs, Reddit + scan engine
frontend/                React SPA
scripts/smoke.sh         End-to-end API smoke test used by CI
.github/workflows/       ci (typecheck + smoke on PR) + deploy (Fly on main)
Dockerfile               single image serving compiled SPA + API
fly.toml                 Fly.io launch config
docker-compose.yml       dev Postgres only
```

## Roles

- **Admin** — everything, including editing config, search terms, keyword
  lists, and managing users.
- **User** — reviews mentions: confirm topic / negativity, mark
  `Worked`/`Ignored`, add notes. Can trigger `Run now`.
- **Viewer** — read-only dashboard + CSV export.

## Scan behavior

- **Trigger:** in-process `node-cron` on the schedule in the `config` row
  (default `0 9 * * 1,3,5` in `America/Chicago`), or `Run now` from the UI,
  or `POST /api/scan/run` with the `SCAN_TRIGGER_TOKEN` bearer for external
  cron.
- **Per search term** the scanner queries Reddit `search.json?q=…` filtered
  to the configured `lookback_days` and `search_scope`.
- **Negative filter** is case-insensitive substring match against
  title + selftext.
- **Topic** is best-guess from the first matching keyword in the topic map;
  unmatched items get `Uncategorized`.
- **Dedupe** is by Reddit fullname (`t3_xxx` / `t1_xxx`) — a `flagged_mentions`
  row already exists → skipped.
- **Resurfacing check:** for items whose `status = worked`, the next scan
  compares `num_comments` against `last_comment_count`; if it grew, status
  is set back to `resurfaced` and the row surfaces at the top of the
  dashboard.

## Verify with the smoke test

```bash
./scripts/smoke.sh   # exercises the full API round-trip against localhost:4100
```

CI runs this on every PR against a disposable Postgres. Reddit + email
calls are mocked out in test mode so the smoke test needs no external
credentials.

## Notes

- Reddit's public API does **not** search comment bodies sitewide, so this
  build catches original posts everywhere and new comments on threads it
  has already flagged (via the resurfacing check), but cannot discover a
  brand-new comment-only mention buried in an unrelated thread. Closing
  that fully needs a paid third-party comment-search — Phase 2.
- Sentiment/topic are keyword-based only in this phase. Expect false
  positives (sarcasm, negated statements) and false negatives — both the
  `Actually Negative?` and `Topic (Confirmed)` columns are the intended
  human correction path.
