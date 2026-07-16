import { useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { Download, ExternalLink, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  downloadMentionsCsv,
  useMentions,
  useUpdateMention,
  type MentionFilters,
} from "@/hooks/useMentions";
import { cn } from "@/lib/cn";
import type { Mention, MentionStatus } from "@/lib/types";

/**
 * Dashboard = the flagged mentions review surface.
 *
 * Design notes:
 *   - One row per flagged item. Human-owned cells (Topic Confirmed,
 *     Actually Negative?, Status, Notes) are editable inline; system
 *     cells are display-only.
 *   - Sorting is server-side: resurfaced + new float to the top,
 *     then most-recently-surfaced first (see mentions.ts).
 *   - Filters are two simple controls (status pills + free-text q).
 *     No pagination controls; the API caps at 100 for now, more
 *     than enough for a triage tool.
 *   - CSV export honors the current filter set so a reviewer can
 *     download exactly what they're looking at.
 */

const STATUS_PILLS: { key: MentionStatus; label: string }[] = [
  { key: "new", label: "New" },
  { key: "resurfaced", label: "Resurfaced" },
  { key: "worked", label: "Worked" },
  { key: "ignored", label: "Ignored" },
];

export function DashboardView() {
  const [statusFilter, setStatusFilter] = useState<MentionStatus[]>(["new", "resurfaced"]);
  const [q, setQ] = useState("");
  const filters: MentionFilters = useMemo(
    () => ({ status: statusFilter.length ? statusFilter : undefined, q: q || undefined }),
    [statusFilter, q],
  );

  const meQ = useCurrentUser();
  const mentionsQ = useMentions(filters);
  const canWrite = meQ.data?.user?.role === "admin" || meQ.data?.user?.role === "user";

  function toggleStatus(k: MentionStatus) {
    setStatusFilter((cur) =>
      cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k],
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          {STATUS_PILLS.map((p) => (
            <button
              key={p.key}
              onClick={() => toggleStatus(p.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium",
                statusFilter.includes(p.key)
                  ? "border-rs-orange bg-rs-orange/10 text-rs-orange-dark"
                  : "border-rs-stone bg-white text-rs-slate hover:bg-rs-bg",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-md">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-rs-slate"
          />
          <Input
            placeholder="Search title, excerpt, subreddit, notes…"
            className="pl-8"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-rs-slate">
            {mentionsQ.data?.total ?? 0} total
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => downloadMentionsCsv(filters)}
          >
            <Download size={14} />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-rs-stone bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-rs-stone bg-rs-bg text-xs uppercase tracking-wide text-rs-slate">
              <tr>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Subreddit</th>
                <th className="px-4 py-2">Mention</th>
                <th className="px-4 py-2">Suggested topic</th>
                <th className="px-4 py-2">Topic (confirmed)</th>
                <th className="px-4 py-2">Actually negative?</th>
                <th className="px-4 py-2">Worked by</th>
                <th className="px-4 py-2">Post date</th>
                <th className="px-4 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {mentionsQ.isPending && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-rs-slate">
                    Loading…
                  </td>
                </tr>
              )}
              {mentionsQ.data?.mentions.length === 0 && !mentionsQ.isPending && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-rs-slate">
                    No mentions match the current filters.
                  </td>
                </tr>
              )}
              {mentionsQ.data?.mentions.map((m) => (
                <MentionRow key={m.id} mention={m} canWrite={canWrite} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MentionRow({ mention, canWrite }: { mention: Mention; canWrite: boolean }) {
  const update = useUpdateMention();

  function patch(p: Parameters<typeof update.mutate>[0]["patch"]) {
    if (!canWrite) return;
    update.mutate({ id: mention.id, patch: p });
  }

  return (
    <tr className="border-b border-rs-stone last:border-b-0 align-top">
      <td className="px-4 py-3">
        <select
          value={mention.status}
          disabled={!canWrite}
          onChange={(e) => patch({ status: e.target.value as MentionStatus })}
          className="rounded-md border border-rs-stone bg-white px-2 py-1 text-xs"
        >
          {STATUS_PILLS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3 text-rs-slate">
        r/{mention.subreddit}
        {mention.author && (
          <div className="text-[11px] text-rs-slate/70">u/{mention.author}</div>
        )}
      </td>
      <td className="px-4 py-3 max-w-xl">
        <a
          href={mention.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-rs-ink hover:text-rs-orange-dark"
        >
          {mention.title ?? "(no title)"}
          <ExternalLink size={12} />
        </a>
        <p className="mt-1 text-xs text-rs-slate">{mention.excerpt}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <StatusBadge status={mention.status} />
          {mention.matched_keywords.map((k) => (
            <span
              key={k}
              className="rounded bg-rs-stone px-1.5 py-0.5 text-[10px] text-rs-slate"
            >
              {k}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3 text-rs-slate">
        {mention.suggested_topic}
        {mention.suggested_topic_source_keyword && (
          <div className="text-[11px] text-rs-slate/60">
            via "{mention.suggested_topic_source_keyword}"
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <input
          type="text"
          defaultValue={mention.confirmed_topic ?? ""}
          disabled={!canWrite}
          onBlur={(e) => {
            const val = e.target.value.trim();
            if ((val || null) !== mention.confirmed_topic) {
              patch({ confirmed_topic: val || null });
            }
          }}
          placeholder="Confirm…"
          className="w-32 rounded-md border border-rs-stone bg-white px-2 py-1 text-xs"
        />
      </td>
      <td className="px-4 py-3">
        <select
          value={
            mention.actually_negative === null
              ? ""
              : mention.actually_negative
                ? "true"
                : "false"
          }
          disabled={!canWrite}
          onChange={(e) => {
            const v = e.target.value;
            patch({
              actually_negative: v === "" ? null : v === "true",
            });
          }}
          className="rounded-md border border-rs-stone bg-white px-2 py-1 text-xs"
        >
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </td>
      <td className="px-4 py-3 text-xs text-rs-slate">
        {mention.worked_by_name ?? "—"}
        {mention.worked_date && (
          <div className="text-[11px] text-rs-slate/70">
            {formatDistanceToNow(new Date(mention.worked_date), { addSuffix: true })}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-rs-slate whitespace-nowrap">
        {format(new Date(mention.post_date), "MMM d, yyyy")}
        <div className="text-[11px] text-rs-slate/70">
          {formatDistanceToNow(new Date(mention.date_found), { addSuffix: true })}
        </div>
      </td>
      <td className="px-4 py-3 max-w-xs">
        <textarea
          defaultValue={mention.notes ?? ""}
          disabled={!canWrite}
          onBlur={(e) => {
            const val = e.target.value.trim();
            if ((val || null) !== mention.notes) {
              patch({ notes: val || null });
            }
          }}
          placeholder="Add note…"
          rows={2}
          className="w-full rounded-md border border-rs-stone bg-white px-2 py-1 text-xs"
        />
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: MentionStatus }) {
  return <Badge variant={status}>{status}</Badge>;
}
