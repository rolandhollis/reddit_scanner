/**
 * Digest email builder + sender.
 *
 * Called from the scan engine when a run finds new or resurfaced
 * items (or every run when `send_email_when_no_new_items` is on). The
 * caller passes counts; we query the DB for the actual "new since
 * last successful scan" list so the email stays consistent with what
 * the dashboard shows.
 *
 * HTML is hand-rolled (no template engine) — this is a single email
 * layout and pulling in mjml/handlebars is over-engineering.
 */
import { config } from "../config.js";
import { query } from "../db/pool.js";
import type { FlaggedMentionRow } from "../types.js";
import { sendEmail } from "./resend.js";

export type SendDigestInput = {
  recipients: string[];
  /** Not currently used — we requery here so the email content is
   *  driven by what's actually in the DB right now. Kept in the API
   *  in case a future caller wants to pin a specific set of ids. */
  newItemIds?: string[];
  newItemsCount: number;
  resurfacedCount: number;
};

/**
 * Send the digest. Emits ONE email addressed to all recipients (BCC
 * would be cleaner from a privacy standpoint but this is an internal
 * team distribution; a shared list is fine).
 */
export async function sendDigest(input: SendDigestInput): Promise<void> {
  const { recipients } = input;
  if (recipients.length === 0) return;

  // Pull the last 25 items in either "new" or "resurfaced" state —
  // matches what a reviewer would see on the dashboard sorted by
  // date_found DESC.
  const { rows: items } = await query<FlaggedMentionRow>(
    `SELECT * FROM flagged_mentions
      WHERE status IN ('new', 'resurfaced')
      ORDER BY date_found DESC
      LIMIT 25`,
  );

  const subject = digestSubject(input.newItemsCount, input.resurfacedCount);
  const html = digestHtml(items, input);
  const text = digestText(items, input);

  await sendEmail({ to: recipients, subject, html, text });
}

function digestSubject(newCount: number, resurfacedCount: number): string {
  if (newCount === 0 && resurfacedCount === 0) {
    return `[Reddit Scanner] No new mentions today`;
  }
  const parts: string[] = [];
  if (newCount > 0) parts.push(`${newCount} new`);
  if (resurfacedCount > 0) parts.push(`${resurfacedCount} resurfaced`);
  return `[Reddit Scanner] ${parts.join(" + ")} mention${
    newCount + resurfacedCount === 1 ? "" : "s"
  } to review`;
}

function digestHtml(items: FlaggedMentionRow[], input: SendDigestInput): string {
  const rows = items
    .map((m) => {
      const permalink = escapeHtml(m.permalink);
      const title = escapeHtml(m.title ?? "(no title)");
      const excerpt = escapeHtml(m.excerpt);
      const topic = escapeHtml(m.suggested_topic);
      const matched = m.matched_keywords.map(escapeHtml).join(", ");
      const badge =
        m.status === "resurfaced"
          ? `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600">RESURFACED</span>`
          : `<span style="background:#dbeafe;color:#1e3a8a;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600">NEW</span>`;
      return `
        <tr>
          <td style="padding:12px 16px;border-top:1px solid #e5e7eb;vertical-align:top">
            <div style="margin-bottom:4px">${badge}
              <span style="color:#6b7280;font-size:12px;margin-left:6px">r/${escapeHtml(m.subreddit)} · ${topic}</span>
            </div>
            <div style="font-weight:600;color:#111827;margin-bottom:4px">
              <a href="${permalink}" style="color:#111827;text-decoration:none">${title}</a>
            </div>
            <div style="color:#374151;font-size:14px;margin-bottom:6px">${excerpt}</div>
            <div style="color:#9ca3af;font-size:12px">
              Matched: ${matched} · <a href="${permalink}" style="color:#2563eb">Open thread</a>
            </div>
          </td>
        </tr>`;
    })
    .join("");

  const dashboardUrl = escapeHtml(`${config.publicAppUrl}/`);

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
        <tr>
          <td style="padding:20px 24px;border-bottom:1px solid #e5e7eb;background:#111827;color:#f9fafb">
            <div style="font-size:14px;color:#9ca3af;margin-bottom:2px">Reddit Scanner digest</div>
            <div style="font-size:18px;font-weight:600">
              ${input.newItemsCount} new · ${input.resurfacedCount} resurfaced
            </div>
          </td>
        </tr>
        ${
          items.length === 0
            ? `<tr><td style="padding:24px;color:#6b7280">No open items right now.</td></tr>`
            : rows
        }
        <tr>
          <td style="padding:16px 24px;background:#f3f4f6;text-align:center">
            <a href="${dashboardUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">Open dashboard</a>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 24px;color:#9ca3af;font-size:11px;text-align:center">
            Sent by the Reddit Scanner. Manage recipients in Settings.
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function digestText(items: FlaggedMentionRow[], input: SendDigestInput): string {
  const lines: string[] = [];
  lines.push(`Reddit Scanner digest`);
  lines.push(`${input.newItemsCount} new · ${input.resurfacedCount} resurfaced`);
  lines.push("");
  if (items.length === 0) {
    lines.push(`No open items right now.`);
  } else {
    for (const m of items) {
      lines.push(
        `[${m.status.toUpperCase()}] r/${m.subreddit} · ${m.suggested_topic}`,
      );
      lines.push(m.title ?? "(no title)");
      lines.push(m.excerpt);
      lines.push(`Matched: ${m.matched_keywords.join(", ")}`);
      lines.push(m.permalink);
      lines.push("");
    }
  }
  lines.push(`Open dashboard: ${config.publicAppUrl}/`);
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
