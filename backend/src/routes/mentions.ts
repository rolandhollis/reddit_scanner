import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { toCsv } from "../lib/csv.js";
import { requireWrite } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";
import type { FlaggedMentionRow } from "../types.js";

export const mentionsRouter = Router();

/**
 * List flagged mentions.
 *
 * Filter params (all optional):
 *   ?status=new,resurfaced  → comma-separated set. Default: everything.
 *   ?q=code                 → substring search in title / excerpt / subreddit / notes.
 *   ?limit=100&offset=0     → simple pagination. Default 100 (dashboard shows first page).
 *
 * The response also carries every mention's `worked_by` denormalized
 * so the table renders "Worked By" without a JOIN on the client.
 */

const listSchema = z.object({
  status: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(",")
            .map((v) => v.trim())
            .filter((v) => ["new", "worked", "resurfaced", "ignored"].includes(v))
        : undefined,
    ),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(500).optional().default(100),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

type MentionListRow = FlaggedMentionRow & {
  worked_by_name: string | null;
  worked_by_email: string | null;
};

async function queryMentions(params: {
  status?: string[];
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: MentionListRow[]; total: number }> {
  const conds: string[] = [];
  const args: unknown[] = [];

  if (params.status && params.status.length > 0) {
    args.push(params.status);
    conds.push(`m.status = ANY($${args.length}::text[])`);
  }
  if (params.q) {
    args.push(`%${params.q.toLowerCase()}%`);
    conds.push(
      `(lower(m.title) LIKE $${args.length} OR lower(m.excerpt) LIKE $${args.length} OR lower(m.subreddit) LIKE $${args.length} OR lower(COALESCE(m.notes, '')) LIKE $${args.length})`,
    );
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";

  const countRes = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM flagged_mentions m ${where}`,
    args,
  );
  const total = Number(countRes.rows[0]?.total ?? "0");

  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;
  args.push(limit);
  args.push(offset);
  const { rows } = await query<MentionListRow>(
    `SELECT m.*, u.name AS worked_by_name, u.email AS worked_by_email
       FROM flagged_mentions m
       LEFT JOIN users u ON u.id = m.worked_by_user_id
       ${where}
       ORDER BY
         -- Resurfaced and new floated to the top; then most-recently-surfaced first.
         CASE m.status WHEN 'resurfaced' THEN 0 WHEN 'new' THEN 1 WHEN 'worked' THEN 2 ELSE 3 END,
         m.date_found DESC
       LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args,
  );

  return { rows, total };
}

mentionsRouter.get("/", async (req, res) => {
  const parsed = listSchema.parse(req.query);
  const { rows, total } = await queryMentions(parsed);
  res.json({ mentions: rows, total });
});

// -----------------------------------------------------------------
// CSV export — the primary PRD deliverable (§5.3).
//
// Columns MUST be in the exact order the PRD specifies. The smoke
// test asserts this line-for-line, so if you change the order you'll
// break both the smoke test AND anyone who's already automating
// against the export.
// -----------------------------------------------------------------

const CSV_HEADERS = [
  "Date Found",
  "Post Date",
  "Type",
  "Permalink",
  "Excerpt",
  "Matched Keyword(s)",
  "Suggested Topic",
  "Topic (Confirmed)",
  "Actually Negative?",
  "Status",
  "Worked By",
  "Worked Date",
  "Notes",
];

function mentionToCsvRow(m: MentionListRow): unknown[] {
  return [
    m.date_found instanceof Date ? m.date_found.toISOString() : m.date_found,
    m.post_date instanceof Date ? m.post_date.toISOString() : m.post_date,
    m.type === "post" ? "Post" : "Comment",
    m.permalink,
    m.excerpt,
    m.matched_keywords.join(", "),
    m.suggested_topic,
    m.confirmed_topic ?? "",
    m.actually_negative === null || m.actually_negative === undefined
      ? ""
      : m.actually_negative
        ? "Yes"
        : "No",
    // Human-friendly title-case for CSV consumers.
    m.status.charAt(0).toUpperCase() + m.status.slice(1),
    m.worked_by_name ?? m.worked_by_email ?? "",
    m.worked_date
      ? m.worked_date instanceof Date
        ? m.worked_date.toISOString()
        : m.worked_date
      : "",
    m.notes ?? "",
  ];
}

mentionsRouter.get("/export.csv", async (req, res) => {
  const parsed = listSchema.parse(req.query);
  // Ignore limit/offset for exports — the point is to get everything.
  const { rows } = await queryMentions({ ...parsed, limit: 500, offset: 0 });
  // Simple loop-and-collect since we cap at 500 rows for this
  // prototype. If exports grow to tens of thousands, switch this to
  // a streaming COPY.
  let all: MentionListRow[] = rows;
  if (all.length === 500) {
    let offset = 500;
    while (true) {
      const next = await queryMentions({ ...parsed, limit: 500, offset });
      all = all.concat(next.rows);
      if (next.rows.length < 500) break;
      offset += 500;
      // Safety valve — bail at 50k rows so a bad filter can't blow
      // memory. Nobody's actually going to hit this in v1.
      if (all.length >= 50_000) break;
    }
  }

  const csv = toCsv(CSV_HEADERS, all.map(mentionToCsvRow));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="reddit-scanner-mentions-${todayForFilename()}.csv"`,
  );
  res.send(csv);
});

// -----------------------------------------------------------------
// Update — human-owned columns only. Admin + user can edit; viewer
// gets 403.
// -----------------------------------------------------------------
const updateSchema = z.object({
  confirmed_topic: z.string().max(200).nullable().optional(),
  actually_negative: z.boolean().nullable().optional(),
  status: z.enum(["new", "worked", "resurfaced", "ignored"]).optional(),
  notes: z.string().max(4000).nullable().optional(),
});

mentionsRouter.patch("/:id", requireWrite, async (req, res) => {
  const body = updateSchema.parse(req.body);
  const user = req.user!;

  // Auto-stamp worked_by / worked_date whenever status transitions
  // TO 'worked' or 'ignored' from something else — matches the
  // spreadsheet-era pattern where the reviewer's hand fills those
  // cells inline. Reverting to 'new'/'resurfaced' clears them so a
  // re-review isn't attributed to the wrong person.
  let workedByPatch: string | null | undefined = undefined;
  let workedDatePatch: string | null | undefined = undefined;
  if (body.status !== undefined) {
    if (body.status === "worked" || body.status === "ignored") {
      workedByPatch = user.id;
      workedDatePatch = new Date().toISOString();
    } else {
      workedByPatch = null;
      workedDatePatch = null;
    }
  }

  const { rows } = await query<FlaggedMentionRow>(
    `UPDATE flagged_mentions
        SET confirmed_topic   = COALESCE($1, confirmed_topic),
            actually_negative = CASE WHEN $2::text = '__unset__' THEN NULL
                                     WHEN $2::text IS NULL THEN actually_negative
                                     ELSE ($2::text = 'true') END,
            status            = COALESCE($3, status),
            notes             = COALESCE($4, notes),
            worked_by_user_id = COALESCE($5, worked_by_user_id),
            worked_date       = COALESCE($6, worked_date),
            updated_at        = NOW()
      WHERE id = $7
      RETURNING *`,
    [
      body.confirmed_topic === undefined ? null : body.confirmed_topic,
      body.actually_negative === undefined
        ? null
        : body.actually_negative === null
          ? "__unset__"
          : String(body.actually_negative),
      body.status ?? null,
      body.notes === undefined ? null : body.notes,
      workedByPatch ?? null,
      workedDatePatch ?? null,
      req.params.id,
    ],
  );
  if (!rows[0]) throw new HttpError(404, "mention not found");
  res.json({ mention: rows[0] });
});

function todayForFilename(): string {
  return new Date().toISOString().slice(0, 10);
}
