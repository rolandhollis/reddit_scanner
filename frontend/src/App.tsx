import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/AppShell";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { DashboardView } from "@/views/DashboardView";
import { LoginView } from "@/views/LoginView";
import { SettingsView } from "@/views/SettingsView";

export default function App() {
  const meQ = useCurrentUser();

  if (meQ.isPending) {
    return <div className="flex min-h-screen items-center justify-center text-rs-slate">Loading…</div>;
  }

  const me = meQ.data?.user ?? null;
  if (!me) return <LoginView />;

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardView />} />
        <Route
          path="/settings"
          element={
            me.role === "admin" ? (
              <SettingsView />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
