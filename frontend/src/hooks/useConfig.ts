import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AppConfig } from "@/lib/types";

export function useConfig() {
  return useQuery<{ config: AppConfig }>({
    queryKey: ["config"],
    queryFn: () => api<{ config: AppConfig }>("/config"),
  });
}

export function useSaveConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<AppConfig, "id" | "updated_at">) =>
      api<{ config: AppConfig }>("/config", { method: "PUT", body }),
    onSuccess: (data) => {
      qc.setQueryData(["config"], data);
    },
  });
}
