-- Initial schema for the Reddit Scanner.
--
-- Everything a fresh install needs: users + sessions (password auth),
-- single-row config, three editable lists (search terms / negative
-- keywords / topic keywords), the flagged_mentions record that powers
-- both the dashboard and the CSV export, and a scan_runs log.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------
-- users + sessions (mirrors Waypoint's password-auth pattern)
-- -----------------------------------------------------------------
CREATE TABLE users (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                TEXT NOT NULL UNIQUE,
  name                 TEXT NOT NULL,
  -- Three-tier role model:
  --   admin  → everything (config, keyword CRUD, user mgmt, mentions)
  --   user   → work items (confirm topic, mark worked, notes) + trigger scans
  --   viewer → read-only dashboard + CSV export
  role                 TEXT NOT NULL CHECK (role IN ('admin', 'user', 'viewer')),
  password_hash        TEXT,
  password_updated_at  TIMESTAMPTZ,
  -- Reserved for future multi-tenant expansion (see PRD phase 2). Kept
  -- so the auth pattern matches Waypoint's — if we ever add tenants,
  -- the super-user distinction is already there.
  is_super_user        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX users_email_ci_idx ON users (lower(email));

CREATE TABLE user_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_agent    TEXT,
  -- Opt-in 30-day session; sliding TTL either way.
  remember_me   BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX user_sessions_user_idx ON user_sessions (user_id);
CREATE INDEX user_sessions_expires_idx ON user_sessions (expires_at);

-- -----------------------------------------------------------------
-- config (single row, id = 1)
-- -----------------------------------------------------------------
CREATE TABLE config (
  id                              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  lookback_days                   INT  NOT NULL DEFAULT 90 CHECK (lookback_days > 0 AND lookback_days <= 365),
  search_scope                    TEXT NOT NULL DEFAULT 'all' CHECK (search_scope IN ('all', 'subreddits')),
  -- Only meaningful when search_scope = 'subreddits'; ignored otherwise.
  subreddits                      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Standard 5-field cron string interpreted in schedule_timezone.
  -- Default: 9am America/Chicago on Mon/Wed/Fri.
  schedule_cron                   TEXT NOT NULL DEFAULT '0 9 * * 1,3,5',
  schedule_timezone               TEXT NOT NULL DEFAULT 'America/Chicago',
  recipient_emails                TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  send_email_when_no_new_items    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the row so GET /api/config always returns something.
INSERT INTO config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------
-- Editable lists: search terms, negative keywords, topic keywords
-- -----------------------------------------------------------------
CREATE TABLE search_terms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term        TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Case-insensitive uniqueness — a duplicate "RetailMeNot" vs "retailmenot"
-- would just double our Reddit rate-limit usage for identical results.
CREATE UNIQUE INDEX search_terms_ci_idx ON search_terms (lower(term));

CREATE TABLE negative_keywords (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword     TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX negative_keywords_ci_idx ON negative_keywords (lower(keyword));

CREATE TABLE topic_keywords (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword      TEXT NOT NULL,
  topic_label  TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- A keyword can only map to one topic — if you want a term to be
-- ambiguous, pick one topic and use the reviewer's Topic (Confirmed)
-- column to override at review time.
CREATE UNIQUE INDEX topic_keywords_ci_idx ON topic_keywords (lower(keyword));

-- -----------------------------------------------------------------
-- flagged_mentions — the main record.
--
-- Doubles as the dedupe log per PRD 5.2: we insert one row per Reddit
-- item ever seen, so re-running the scan checks reddit_id UNIQUE and
-- skips work. `last_comment_count` powers the resurfacing check.
-- -----------------------------------------------------------------
CREATE TABLE flagged_mentions (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Reddit fullname, e.g. "t3_abc123" for a post, "t1_xyz789" for a
  -- comment. Unique constraint IS the dedupe.
  reddit_id                       TEXT NOT NULL UNIQUE,
  type                            TEXT NOT NULL CHECK (type IN ('post', 'comment')),
  permalink                       TEXT NOT NULL,
  subreddit                       TEXT NOT NULL,
  author                          TEXT,
  title                           TEXT,
  excerpt                         TEXT NOT NULL,
  matched_keywords                TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  suggested_topic                 TEXT NOT NULL DEFAULT 'Uncategorized',
  -- Which topic-keyword row triggered the suggested_topic. Useful when
  -- a reviewer wants to know "why did this get labeled X?".
  suggested_topic_source_keyword  TEXT,

  -- Timestamps: date_found is our scan discovery time; post_date is
  -- the Reddit created_utc for the item itself (from the API).
  date_found                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  post_date                       TIMESTAMPTZ NOT NULL,

  -- Human-owned columns. NULL until a reviewer touches them.
  confirmed_topic                 TEXT,
  actually_negative               BOOLEAN,
  status                          TEXT NOT NULL DEFAULT 'new'
                                    CHECK (status IN ('new', 'worked', 'resurfaced', 'ignored')),
  worked_by_user_id               UUID REFERENCES users(id) ON DELETE SET NULL,
  worked_date                     TIMESTAMPTZ,
  notes                           TEXT,

  -- Comment count from the most recent time we looked. Compared on
  -- every subsequent scan to detect resurfacing on already-Worked posts.
  last_comment_count              INT NOT NULL DEFAULT 0,

  -- Raw Reddit JSON kept for debugging + future re-scoring passes.
  raw_json                        JSONB,

  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX flagged_mentions_status_idx      ON flagged_mentions (status);
CREATE INDEX flagged_mentions_date_found_idx  ON flagged_mentions (date_found DESC);
CREATE INDEX flagged_mentions_post_date_idx   ON flagged_mentions (post_date DESC);

-- -----------------------------------------------------------------
-- scan_runs — one row per scan attempt.
--
-- Lets the UI show "last scan: 3 minutes ago, 2 new items" without
-- scanning flagged_mentions, and gives us a place to attach errors so
-- an admin can diagnose "why didn't Wednesday's scan email me?"
-- without SSH into the machine.
-- -----------------------------------------------------------------
CREATE TABLE scan_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at           TIMESTAMPTZ,
  status                TEXT NOT NULL DEFAULT 'running'
                          CHECK (status IN ('running', 'success', 'error')),
  items_found           INT NOT NULL DEFAULT 0,
  new_items             INT NOT NULL DEFAULT 0,
  resurfaced_items      INT NOT NULL DEFAULT 0,
  error_message         TEXT,
  triggered_by          TEXT NOT NULL CHECK (triggered_by IN ('cron', 'manual', 'external', 'test')),
  triggered_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX scan_runs_started_at_idx ON scan_runs (started_at DESC);
