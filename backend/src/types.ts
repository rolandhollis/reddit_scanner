export type Role = "admin" | "user" | "viewer";

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  password_hash: string | null;
  password_updated_at: Date | null;
  is_super_user: boolean;
  created_at: Date;
  updated_at: Date;
};

export type ConfigRow = {
  id: number;
  lookback_days: number;
  /**
   * "all" → search all of Reddit; "subreddits" → limit to `subreddits` list.
   * Stored as text (not enum) so we can add scopes (exclude-list, etc.)
   * without a migration if Kathryn asks for one later.
   */
  search_scope: "all" | "subreddits";
  subreddits: string[];
  schedule_cron: string;
  schedule_timezone: string;
  recipient_emails: string[];
  send_email_when_no_new_items: boolean;
  updated_at: Date;
};

export type SearchTermRow = {
  id: string;
  term: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

export type NegativeKeywordRow = {
  id: string;
  keyword: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

export type TopicKeywordRow = {
  id: string;
  keyword: string;
  topic_label: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

export type MentionStatus = "new" | "worked" | "resurfaced" | "ignored";
export type MentionType = "post" | "comment";

export type FlaggedMentionRow = {
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
  date_found: Date;
  post_date: Date;
  confirmed_topic: string | null;
  actually_negative: boolean | null;
  status: MentionStatus;
  worked_by_user_id: string | null;
  worked_date: Date | null;
  notes: string | null;
  last_comment_count: number;
  raw_json: unknown;
  created_at: Date;
  updated_at: Date;
};

export type ScanRunTrigger = "cron" | "manual" | "external" | "test";
export type ScanRunStatus = "running" | "success" | "error";

export type ScanRunRow = {
  id: string;
  started_at: Date;
  finished_at: Date | null;
  status: ScanRunStatus;
  items_found: number;
  new_items: number;
  resurfaced_items: number;
  error_message: string | null;
  triggered_by: ScanRunTrigger;
  triggered_by_user_id: string | null;
};
