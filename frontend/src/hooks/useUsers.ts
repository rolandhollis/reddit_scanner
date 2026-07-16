import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Role, User } from "@/lib/types";

export function useUsers() {
  return useQuery<{ users: User[] }>({
    queryKey: ["users"],
    queryFn: () => api<{ users: User[] }>("/users"),
  });
}

export function useMockRoster() {
  return useQuery<{ users: Pick<User, "id" | "name" | "email" | "role">[] }>({
    queryKey: ["mock-roster"],
    queryFn: () =>
      api<{ users: Pick<User, "id" | "name" | "email" | "role">[] }>("/users/mock-roster"),
    // Fine to fail silently — the login screen falls back to a
    // password form when this 404s.
    retry: false,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; name: string; role: Role }) =>
      api<{ user: User; initial_password: string | null }>("/users", {
        method: "POST",
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; role?: Role } }) =>
      api<{ user: User }>(`/users/${id}`, { method: "PUT", body: patch }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: (id: string) =>
      api<{ new_password: string }>(`/users/${id}/reset-password`, { method: "POST" }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/users/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}
