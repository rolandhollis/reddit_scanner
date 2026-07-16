import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, setMockUserId } from "@/lib/api";
import type { User } from "@/lib/types";

/**
 * Session hook.
 *
 * `data` is the current user or `null` when unauthenticated. Errors
 * other than 401 propagate as query errors so a real backend outage
 * doesn't silently look like "logged out".
 */
export function useCurrentUser() {
  return useQuery<{ user: User } | null>({
    queryKey: ["me"],
    retry: false,
    queryFn: async () => {
      try {
        return await api<{ user: User }>("/auth/me");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; password: string; remember_me: boolean }) =>
      api<{ user: User }>("/auth/login", { method: "POST", body: input }),
    onSuccess: (data) => {
      qc.setQueryData(["me"], data);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api<undefined>("/auth/logout", { method: "POST" });
      setMockUserId(null);
    },
    onSuccess: () => {
      qc.setQueryData(["me"], null);
      qc.clear();
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { current_password: string; new_password: string }) =>
      api<undefined>("/auth/change-password", { method: "POST", body: input }),
  });
}
