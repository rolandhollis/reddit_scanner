# Deploying the Reddit Scanner

Single Docker image → Fly.io. Postgres is a separate Fly Postgres app that
the main app connects to via `DATABASE_URL` (written into secrets by
`fly postgres attach`).

## Prerequisites

- [flyctl](https://fly.io/docs/hands-on/install-flyctl/) installed and
  `fly auth login` completed.
- A Reddit script app (see [README.md](README.md#getting-reddit-api-credentials)).
- A [Resend](https://resend.com) API key + verified sender domain (or use
  Resend's `onboarding@resend.dev` sandbox for testing).
- (Optional) An external cron caller — if you'd rather not rely on
  `min_machines_running=1` + in-process `node-cron`.

## First-time setup

```bash
# 1. Reserve the Fly app name. Adds fly.toml suffix if reddit-scanner is taken.
fly launch --no-deploy --copy-config

# 2. Create + attach Postgres.
fly postgres create --name reddit-scanner-db --region iad --initial-cluster-size 1
fly postgres attach reddit-scanner-db   # writes DATABASE_URL into app secrets

# 3. Bootstrap the first admin user + Reddit + email credentials.
fly secrets set \
  SUPER_ADMIN_EMAIL="you@example.com" \
  SUPER_ADMIN_PASSWORD="a-strong-passphrase-of-your-choosing" \
  SUPER_ADMIN_NAME="Your Name" \
  REDDIT_CLIENT_ID="…" \
  REDDIT_CLIENT_SECRET="…" \
  REDDIT_USER_AGENT="reddit-scanner (by /u/your_reddit_username)" \
  RESEND_API_KEY="re_…" \
  EMAIL_FROM_ADDRESS="Reddit Scanner <no-reply@your-domain>" \
  PUBLIC_APP_URL="https://reddit-scanner.fly.dev" \
  SCAN_TRIGGER_TOKEN="$(openssl rand -hex 32)"

# 4. First deploy.
fly deploy
```

Migrations run at container start (`CMD` in the Dockerfile), so the first
boot creates all tables and seeds the initial `config` row.

## Env vars

| Var | Where | What it does |
|---|---|---|
| `DATABASE_URL` | secret (auto from `fly postgres attach`) | Postgres DSN |
| `AUTH_MODE` | `[env]` in fly.toml | `password` in prod; `mock` skips the login screen (dev only) |
| `SUPER_ADMIN_EMAIL` | secret | Bootstraps the first admin on boot (idempotent — never clobbers a rotated password) |
| `SUPER_ADMIN_PASSWORD` | secret | Initial password for the bootstrap admin |
| `SUPER_ADMIN_NAME` | secret | Display name (defaults to "Super Admin") |
| `REDDIT_CLIENT_ID` | secret | Reddit OAuth client ID |
| `REDDIT_CLIENT_SECRET` | secret | Reddit OAuth client secret |
| `REDDIT_USER_AGENT` | secret | UA string; Reddit rate-limits opaque UAs harder |
| `RESEND_API_KEY` | secret | Resend transactional email key |
| `EMAIL_FROM_ADDRESS` | secret | Digest `From:` header (`"Name <addr>"` form) |
| `PUBLIC_APP_URL` | secret | Base URL used to build links in digest emails |
| `SCAN_TRIGGER_TOKEN` | secret (optional) | Bearer token accepted at `POST /api/scan/run` for external cron |
| `SCHEDULER_ENABLED` | `[env]` in fly.toml | Set to `false` to disable the in-process scheduler (e.g. when using external cron) |
| `SCAN_TIMEOUT_MS` | optional | Per-scan wall-clock cap (default 5 min) |

## Scheduled scans

**Default:** in-process `node-cron`. The `config` row's `schedule_cron` +
`schedule_timezone` are read on boot and after each save; the scheduler
re-registers when they change. This requires `min_machines_running = 1`
(already set in `fly.toml`) so the machine stays hot enough to fire the
next tick.

**Alternative — external cron:** disable the in-process scheduler and hit
the app from GitHub Actions (or any other scheduler):

```bash
fly secrets set SCHEDULER_ENABLED=false
```

Then in `.github/workflows/scan.yml`:

```yaml
name: scan
on:
  schedule:
    - cron: "0 14 * * 1,3,5"   # 9am America/Chicago (winter); 8am (summer)
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger scan
        run: |
          curl -fsS -X POST https://reddit-scanner.fly.dev/api/scan/run \
            -H "Authorization: Bearer ${{ secrets.SCAN_TRIGGER_TOKEN }}"
```

## Rotating credentials

- **Admin password (self):** log in, `Settings → Account`, change password.
  Every other active session for you is invalidated; the current one
  survives.
- **Admin password (someone else's, when they're locked out):** any admin
  can reset another user's password in `Settings → Users`. All that user's
  sessions are killed on save.
- **Reddit / Resend keys:** `fly secrets set` + Fly automatically restarts.
- **`SCAN_TRIGGER_TOKEN`:** `fly secrets set SCAN_TRIGGER_TOKEN=$(openssl rand -hex 32)`
  and update the caller.

## Observability

- `fly logs -a reddit-scanner` — application logs. Each scan run prints a
  compact summary (search terms queried, hits, new items, resurfaced items).
- `fly ssh console -a reddit-scanner` — shell into a running machine; useful
  for inspecting `scan_runs` history: `psql $DATABASE_URL -c 'SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 20;'`.
- `/api/health` — cheap liveness probe (also wired into the fly health
  check).

## Rolling back a bad deploy

```bash
fly releases                         # find the good release version
fly releases rollback <version>      # switches active image immediately
```

## Backup / restore

`fly postgres backup list -a reddit-scanner-db` shows the automatic daily
snapshots Fly keeps. Restore into a new cluster with
`fly postgres backup restore …` and re-attach.
