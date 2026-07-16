/**
 * Tiny RFC-4180-compliant CSV serializer. Custom-built (no dep) since
 * we only need the trivial cases: strings, numbers, ISO datetimes,
 * comma-joined arrays.
 *
 * Quotes fields that contain comma, quote, CR, or LF. Doubles embedded
 * quotes per the spec.
 */

const NEEDS_QUOTE = /[",\r\n]/;

function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (!NEEDS_QUOTE.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines: string[] = [];
  lines.push(headers.map(esc).join(","));
  for (const r of rows) lines.push(r.map(esc).join(","));
  // Trailing newline keeps `wc -l` honest and satisfies importers
  // (Excel, Sheets) that treat the last line as incomplete without it.
  return lines.join("\r\n") + "\r\n";
}
