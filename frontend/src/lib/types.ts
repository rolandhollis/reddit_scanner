// Mirrors backend types.ts. Duplicated (not imported cross-package)
// because the frontend has no build-time reference to the backend —
// keeping the shapes in sync is a small manual tax vs. wiring up a
// full monorepo just for types.

export type Role = "admin" | "user" | "viewer";

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  password_updated_at: string | null;
  is_super_user: boolean;
  created_at: string;
  updated_at: string;
};

export type AppConfig = {
  id: number;
  lookback_days: number;
  search_scope: "all" | "subreddits";
  subreddits: string[];
  schedule_cron: string;
  schedule_timezone: string;
  recipient_emails: string[];
  send_email_when_no_new_items: boolean;
  updated_at: string;
};

export type SearchTerm = {
  id: string;
  term: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type NegativeKeyword = {
  id: string;
  keyword: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type TopicKeyword = {
  id: string;
  keyword: string;
  topic_label: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type MentionStatus = "new" | "worked" | "resurfaced" | "ignored";
export type MentionType = "post" | "comment";

export type Mention = {
  id: string;
  reddit_id: string;
  type: MentionType;
  permalink: string;
  subreddit: string;
  author: string | null;
  title: string | null;
  excerpt: string;
  matched_keywords: string[];
  suggested_topic: string;
  suggested_topic_source_keyword: string | null;
  date_found: string;
  post_date: string;
  confirmed_topic: string | null;
  actually_negative: boolean | null;
  status: MentionStatus;
  worked_by_user_id: string | null;
  worked_date: string | null;
  notes: string | null;
  last_comment_count: number;
  raw_json: unknown;
  worked_by_name: string | null;
  worked_by_email: string | null;
  created_at: string;
  updated_at: string;
};

export type ScanRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "error";
  items_found: number;
  new_items: number;
  resurfaced_items: number;
  error_message: string | null;
  triggered_by: "cron" | "manual" | "external" | "test";
  triggered_by_user_id: string | null;
};
