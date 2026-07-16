import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLogin } from "@/hooks/useCurrentUser";
import { useMockRoster } from "@/hooks/useUsers";
import { ApiError, setMockUserId } from "@/lib/api";

/**
 * Login screen.
 *
 * Two paths depending on backend AUTH_MODE:
 *   - password mode → email + password form
 *   - mock mode     → dropdown of seeded users; picking one sets a
 *                     localStorage header used on every API call
 *                     (Waypoint's dev pattern)
 *
 * Detection is by response: we try to load the mock roster; a 404
 * means we're in password mode. Both forms are always rendered
 * so you don't have to reload after switching modes locally.
 */
export function LoginView() {
  const login = useLogin();
  const rosterQ = useMockRoster();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    login.mutate(
      { email, password, remember_me: rememberMe },
      {
        onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
      },
    );
  }

  function pickMockUser(id: string) {
    setMockUserId(id);
    qc.invalidateQueries({ queryKey: ["me"] });
  }

  const mockAvailable = rosterQ.data?.users && rosterQ.data.users.length > 0;
  const passwordError =
    login.error instanceof ApiError ? String(login.error.message) : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-rs-bg px-4">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-rs-stone bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-rs-ink">Reddit Scanner</h1>
          <p className="text-sm text-rs-slate">Sign in to review flagged mentions.</p>
        </div>

        <form className="space-y-3" onSubmit={onPasswordSubmit}>
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-rs-slate">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="rounded border-rs-stone"
            />
            Remember me for 30 days
          </label>
          {passwordError && (
            <p className="text-sm text-red-600">{passwordError}</p>
          )}
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        {mockAvailable && (
          <div className="border-t border-rs-stone pt-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-rs-slate">
              Dev switcher (mock mode)
            </p>
            <div className="grid gap-1">
              {rosterQ.data!.users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => pickMockUser(u.id)}
                  className="flex items-center justify-between rounded-md border border-rs-stone px-3 py-2 text-left text-sm hover:bg-rs-bg"
                >
                  <span className="font-medium text-rs-ink">{u.name}</span>
                  <span className="text-xs uppercase tracking-wide text-rs-slate">
                    {u.role}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
