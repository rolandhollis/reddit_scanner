import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ScanRun } from "@/lib/types";

export function useScanRuns() {
  return useQuery<{ runs: ScanRun[] }>({
    queryKey: ["scan-runs"],
    queryFn: () => api<{ runs: ScanRun[] }>("/scan/runs"),
    refetchInterval: 15_000,
  });
}

export function useRunScanNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{
        scan_run: ScanRun;
        new_items: number;
        resurfaced_items: number;
        items_found: number;
      }>("/scan/run", { method: "POST", body: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mentions"] });
      qc.invalidateQueries({ queryKey: ["scan-runs"] });
    },
  });
}
