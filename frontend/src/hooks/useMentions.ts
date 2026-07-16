import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiDownload } from "@/lib/api";
import type { Mention, MentionStatus } from "@/lib/types";

export type MentionFilters = {
  status?: MentionStatus[];
  q?: string;
};

function toQuery(f: MentionFilters): string {
  const p = new URLSearchParams();
  if (f.status && f.status.length > 0) p.set("status", f.status.join(","));
  if (f.q) p.set("q", f.q);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function useMentions(filters: MentionFilters = {}) {
  return useQuery<{ mentions: Mention[]; total: number }>({
    queryKey: ["mentions", filters],
    queryFn: () =>
      api<{ mentions: Mention[]; total: number }>(`/mentions${toQuery(filters)}`),
  });
}

export type MentionPatch = {
  confirmed_topic?: string | null;
  actually_negative?: boolean | null;
  status?: MentionStatus;
  notes?: string | null;
};

export function useUpdateMention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: MentionPatch }) =>
      api<{ mention: Mention }>(`/mentions/${id}`, { method: "PATCH", body: patch }),
    // Optimistic-ish: on success we invalidate every mentions query
    // (regardless of filters) so a status change from 'new' → 'worked'
    // repositions the row correctly.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mentions"] }),
  });
}

export async function downloadMentionsCsv(filters: MentionFilters = {}) {
  const today = new Date().toISOString().slice(0, 10);
  await apiDownload(`/mentions/export.csv${toQuery(filters)}`, `reddit-scanner-mentions-${today}.csv`);
}
