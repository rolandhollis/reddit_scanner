/**
 * Fetch wrapper.
 *
 * Same-origin (or Vite-proxied) `/api/*` calls with:
 *   - Content-Type: application/json on non-GET
 *   - credentials: include (cookies for password mode)
 *   - `x-mock-user-id` header injected from localStorage when the
 *     server is in mock mode (Waypoint dev pattern; the header is
 *     harmless in password mode and simply ignored)
 *
 * Errors normalize to a thrown `ApiError` carrying { status, body }
 * so TanStack Query's `error` receives structured info the UI can
 * render inline.
 */

const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${status}`;
    super(msg);
    this.name = "ApiError";
  }
}

export type ApiOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** For endpoints that need the raw Response (e.g. CSV download). */
  raw?: boolean;
};

const MOCK_HEADER = "x-mock-user-id";
const MOCK_STORAGE_KEY = "reddit_scanner.mock_user_id";

export function getMockUserId(): string | null {
  return localStorage.getItem(MOCK_STORAGE_KEY);
}

export function setMockUserId(id: string | null): void {
  if (id) localStorage.setItem(MOCK_STORAGE_KEY, id);
  else localStorage.removeItem(MOCK_STORAGE_KEY);
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const mockId = getMockUserId();
  if (mockId) headers[MOCK_HEADER] = mockId;

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers,
    credentials: "include",
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  if (opts.raw) return res as unknown as T;

  if (res.status === 204) return undefined as T;

  const ct = res.headers.get("content-type") ?? "";
  const parsed = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}

/** Download a Response body as a browser file save. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const res = (await api<Response>(path, { raw: true })) as Response;
  if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => ""));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
