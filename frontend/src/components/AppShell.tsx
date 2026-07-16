import { formatDistanceToNow } from "date-fns";
import { LayoutDashboard, LogOut, Settings, RefreshCw } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCurrentUser, useLogout } from "@/hooks/useCurrentUser";
import { useRunScanNow, useScanRuns } from "@/hooks/useScan";
import { cn } from "@/lib/cn";

/**
 * Top-level chrome: brand strip, nav tabs, "Run now" button (writable
 * roles only), and a compact "last scan" indicator. Everything below
 * is rendered by the routed view.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const meQ = useCurrentUser();
  const logout = useLogout();
  const runsQ = useScanRuns();
  const runScan = useRunScanNow();

  const me = meQ.data?.user ?? null;
  const canWrite = me?.role === "admin" || me?.role === "user";
  const canAdmin = me?.role === "admin";

  const lastRun = runsQ.data?.runs.find((r) => r.status !== "running") ?? null;
  const inFlight =
    runsQ.data?.runs.some((r) => r.status === "running") || runScan.isPending;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-rs-stone bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-semibold text-rs-ink">Reddit Scanner</span>
            <span className="text-xs uppercase tracking-wide text-rs-slate">v0.1</span>
          </div>
          <nav className="flex items-center gap-1">
            <NavTab to="/" label="Dashboard" icon={<LayoutDashboard size={14} />} />
            {canAdmin && <NavTab to="/settings" label="Settings" icon={<Settings size={14} />} />}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <LastScanStrip
              lastRunAt={lastRun?.finished_at ?? lastRun?.started_at ?? null}
              status={lastRun?.status ?? null}
              errorMessage={lastRun?.error_message ?? null}
              newCount={lastRun?.new_items ?? 0}
              resurfacedCount={lastRun?.resurfaced_items ?? 0}
              inFlight={!!inFlight}
            />
            {canWrite && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => runScan.mutate()}
                disabled={runScan.isPending}
              >
                <RefreshCw size={14} className={cn(runScan.isPending && "animate-spin")} />
                {runScan.isPending ? "Running…" : "Run now"}
              </Button>
            )}
            {me && (
              <div className="flex items-center gap-2 border-l border-rs-stone pl-3">
                <div className="flex flex-col text-right leading-tight">
                  <span className="text-sm font-medium text-rs-ink">{me.name}</span>
                  <span className="text-[11px] uppercase tracking-wide text-rs-slate">
                    {me.role}
                  </span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => logout.mutate()}
                  title="Sign out"
                >
                  <LogOut size={14} />
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1 bg-rs-bg">
        <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>
      </main>
    </div>
  );
}

function NavTab({
  to,
  label,
  icon,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
          isActive
            ? "bg-rs-stone text-rs-ink"
            : "text-rs-slate hover:bg-rs-stone hover:text-rs-ink",
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

function LastScanStrip({
  lastRunAt,
  status,
  errorMessage,
  newCount,
  resurfacedCount,
  inFlight,
}: {
  lastRunAt: string | null;
  status: "success" | "error" | "running" | null;
  errorMessage: string | null;
  newCount: number;
  resurfacedCount: number;
  inFlight: boolean;
}) {
  if (!lastRunAt && !inFlight) return null;
  if (inFlight) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-rs-slate">
        <RefreshCw size={12} className="animate-spin" /> Scan in progress…
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs text-rs-slate">
      <span>
        Last scan {formatDistanceToNow(new Date(lastRunAt!), { addSuffix: true })}
      </span>
      {status === "error" ? (
        // Hover the badge for the full error message from scan_runs;
        // the truncated inline preview is there so the reason is
        // visible without an extra interaction (e.g. "Reddit
        // credentials not configured" is diagnostic enough on its
        // own).
        <>
          <Badge variant="error" title={errorMessage ?? "Scan failed"}>
            Error
          </Badge>
          {errorMessage && (
            <span
              className="max-w-xs truncate text-red-600"
              title={errorMessage}
            >
              {errorMessage}
            </span>
          )}
        </>
      ) : (
        <>
          {newCount > 0 && <Badge variant="new">{newCount} new</Badge>}
          {resurfacedCount > 0 && (
            <Badge variant="resurfaced">{resurfacedCount} resurfaced</Badge>
          )}
        </>
      )}
    </span>
  );
}
