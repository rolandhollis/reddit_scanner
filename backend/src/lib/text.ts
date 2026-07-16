/**
 * Shared text helpers for the scan pipeline. Kept dependency-free so
 * unit tests (later) don't need a DB.
 */

/** Case-insensitive substring match. Returns which of the needles were
 *  found in the haystack, preserving needle case for display. */
export function matchKeywords(haystack: string, needles: string[]): string[] {
  if (!haystack) return [];
  const hay = haystack.toLowerCase();
  const out: string[] = [];
  for (const needle of needles) {
    const nl = needle.toLowerCase().trim();
    if (!nl) continue;
    if (hay.includes(nl)) out.push(needle);
  }
  return out;
}

/**
 * Find the first topic whose keyword matches the haystack (case-
 * insensitive substring). Returns the label + the keyword that
 * triggered it so the reviewer can see WHY the item was topic-guessed
 * this way. `Uncategorized` when nothing matches.
 *
 * Iteration order is the order the caller passes — the route sorts
 * topic keywords by keyword length descending so more-specific matches
 * beat generic ones (e.g. "customer service" before "service").
 */
export function guessTopic(
  haystack: string,
  topics: { keyword: string; topic_label: string }[],
): { label: string; source_keyword: string | null } {
  if (!haystack) return { label: "Uncategorized", source_keyword: null };
  const hay = haystack.toLowerCase();
  for (const t of topics) {
    const kw = t.keyword.toLowerCase().trim();
    if (!kw) continue;
    if (hay.includes(kw)) {
      return { label: t.topic_label, source_keyword: t.keyword };
    }
  }
  return { label: "Uncategorized", source_keyword: null };
}

/**
 * Snippet builder. Prefers a window around the first matched keyword
 * (so the reviewer sees the mention in context) and falls back to a
 * plain head slice when nothing matched. Max length is chosen to fit
 * comfortably in a table cell + email digest without hiding useful
 * context.
 */
export function buildExcerpt(text: string, matchedKeywords: string[], maxLen = 280): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;

  if (matchedKeywords.length > 0) {
    const lc = cleaned.toLowerCase();
    for (const kw of matchedKeywords) {
      const idx = lc.indexOf(kw.toLowerCase());
      if (idx === -1) continue;
      const halfWindow = Math.floor((maxLen - kw.length) / 2);
      const start = Math.max(0, idx - halfWindow);
      const end = Math.min(cleaned.length, start + maxLen);
      const prefix = start > 0 ? "…" : "";
      const suffix = end < cleaned.length ? "…" : "";
      return `${prefix}${cleaned.slice(start, end)}${suffix}`;
    }
  }

  return `${cleaned.slice(0, maxLen)}…`;
}
