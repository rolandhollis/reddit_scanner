import { useEffect, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useConfig, useSaveConfig } from "@/hooks/useConfig";
import {
  negativeKeywordsHooks,
  searchTermsHooks,
  topicKeywordsHooks,
} from "@/hooks/useLists";
import {
  useCreateUser,
  useDeleteUser,
  useResetUserPassword,
  useUpdateUser,
  useUsers,
} from "@/hooks/useUsers";
import { ApiError } from "@/lib/api";
import type { AppConfig, Role } from "@/lib/types";

/**
 * Admin settings page.
 *
 * Layout is a single vertical stack of five panels so an admin can
 * see everything without tab-swapping — the app is single-tenant and
 * these settings change infrequently.
 *
 *   1. Scan configuration
 *   2. Search terms
 *   3. Negative keywords
 *   4. Topic keywords
 *   5. Users
 */
export function SettingsView() {
  return (
    <div className="space-y-6">
      <ConfigPanel />
      <SearchTermsPanel />
      <NegativeKeywordsPanel />
      <TopicKeywordsPanel />
      <UsersPanel />
    </div>
  );
}

// -----------------------------------------------------------------
// Config
// -----------------------------------------------------------------
function ConfigPanel() {
  const configQ = useConfig();
  const save = useSaveConfig();

  // Local edit buffer so the admin can type freely without every
  // keystroke firing a PUT. Reset when the server-side config
  // changes (initial load, or another admin saves elsewhere).
  const [form, setForm] = useState<AppConfig | null>(null);
  useEffect(() => {
    if (configQ.data?.config) setForm(configQ.data.config);
  }, [configQ.data?.config]);

  if (!form) return <Panel title="Scan configuration"><p className="text-rs-slate">Loading…</p></Panel>;

  function set<K extends keyof AppConfig>(k: K, v: AppConfig[K]) {
    setForm((cur) => (cur ? { ...cur, [k]: v } : cur));
  }

  const err = save.error instanceof ApiError ? String(save.error.message) : null;

  return (
    <Panel
      title="Scan configuration"
      subtitle="Governs when scans run, how far back they look, and who gets the digest email."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label>Lookback days</Label>
          <Input
            type="number"
            min={1}
            max={365}
            value={form.lookback_days}
            onChange={(e) => set("lookback_days", Number(e.target.value))}
          />
          <p className="text-xs text-rs-slate">
            How far back each scan queries Reddit.
          </p>
        </div>
        <div className="space-y-1">
          <Label>Search scope</Label>
          <select
            value={form.search_scope}
            onChange={(e) => set("search_scope", e.target.value as AppConfig["search_scope"])}
            className="block h-9 w-full rounded-md border border-rs-stone bg-white px-3 text-sm"
          >
            <option value="all">All of Reddit</option>
            <option value="subreddits">Specific subreddits</option>
          </select>
          {form.search_scope === "subreddits" && (
            <Input
              className="mt-2"
              placeholder="frugal, deals, coupons"
              value={form.subreddits.join(", ")}
              onChange={(e) =>
                set(
                  "subreddits",
                  e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
            />
          )}
        </div>
        <div className="space-y-1">
          <Label>Schedule (cron)</Label>
          <Input
            value={form.schedule_cron}
            onChange={(e) => set("schedule_cron", e.target.value)}
            placeholder="0 9 * * 1,3,5"
          />
          <p className="text-xs text-rs-slate">
            Standard 5-field cron. Default is Mon/Wed/Fri at 9am.
          </p>
        </div>
        <div className="space-y-1">
          <Label>Schedule timezone</Label>
          <Input
            value={form.schedule_timezone}
            onChange={(e) => set("schedule_timezone", e.target.value)}
            placeholder="America/Chicago"
          />
          <p className="text-xs text-rs-slate">IANA timezone name.</p>
        </div>
        <div className="md:col-span-2 space-y-1">
          <Label>Recipient emails</Label>
          <Textarea
            rows={2}
            value={form.recipient_emails.join(", ")}
            onChange={(e) =>
              set(
                "recipient_emails",
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
            placeholder="marketing@example.com, cs@example.com"
          />
        </div>
        <div className="md:col-span-2 flex items-center gap-3">
          <Switch
            checked={form.send_email_when_no_new_items}
            onCheckedChange={(v) => set("send_email_when_no_new_items", v)}
          />
          <span className="text-sm">Send digest email even when no new items</span>
        </div>
      </div>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-4 flex justify-end">
        <Button
          onClick={() => {
            const { id: _id, updated_at: _u, ...rest } = form;
            save.mutate(rest);
          }}
          disabled={save.isPending}
        >
          {save.isPending ? "Saving…" : "Save configuration"}
        </Button>
      </div>
    </Panel>
  );
}

// -----------------------------------------------------------------
// Search terms
// -----------------------------------------------------------------
function SearchTermsPanel() {
  const listQ = searchTermsHooks.useList();
  const create = searchTermsHooks.useCreate();
  const update = searchTermsHooks.useUpdate();
  const del = searchTermsHooks.useDelete();
  const [draft, setDraft] = useState("");

  return (
    <Panel
      title="Search terms"
      subtitle="Brand-name variants queried against Reddit's search endpoint. One row per query."
    >
      <div className="space-y-2">
        {listQ.data?.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2 rounded-md border border-rs-stone px-3 py-2"
          >
            <Input
              defaultValue={t.term}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== t.term) update.mutate({ id: t.id, patch: { term: v } });
              }}
              className="max-w-xs"
            />
            <div className="ml-auto flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-rs-slate">
                <Switch
                  checked={t.active}
                  onCheckedChange={(v) => update.mutate({ id: t.id, patch: { active: v } })}
                />
                {t.active ? "Active" : "Paused"}
              </label>
              <Button variant="ghost" size="icon" onClick={() => del.mutate(t.id)}>
                <Trash2 size={14} className="text-red-500" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          placeholder="Add a term (e.g. RetailMeNot)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              create.mutate({ term: draft.trim() }, { onSuccess: () => setDraft("") });
            }
          }}
          className="max-w-md"
        />
        <Button
          variant="secondary"
          disabled={!draft.trim() || create.isPending}
          onClick={() =>
            create.mutate({ term: draft.trim() }, { onSuccess: () => setDraft("") })
          }
        >
          <Plus size={14} /> Add
        </Button>
      </div>
    </Panel>
  );
}

// -----------------------------------------------------------------
// Negative keywords
// -----------------------------------------------------------------
function NegativeKeywordsPanel() {
  const listQ = negativeKeywordsHooks.useList();
  const create = negativeKeywordsHooks.useCreate();
  const update = negativeKeywordsHooks.useUpdate();
  const del = negativeKeywordsHooks.useDelete();
  const [draft, setDraft] = useState("");

  return (
    <Panel
      title="Negative keywords"
      subtitle="Case-insensitive substring match against title + selftext. Only hits that touch at least one active keyword make it into the report."
    >
      <div className="flex flex-wrap gap-2">
        {listQ.data?.map((k) => (
          <span
            key={k.id}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${
              k.active
                ? "border-rs-stone bg-white"
                : "border-rs-stone bg-rs-bg text-rs-slate"
            }`}
          >
            <span
              className="cursor-pointer"
              onClick={() => update.mutate({ id: k.id, patch: { active: !k.active } })}
              title={k.active ? "Click to pause" : "Click to activate"}
            >
              {k.keyword}
            </span>
            <button
              onClick={() => del.mutate(k.id)}
              className="text-red-400 hover:text-red-600"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          placeholder="Add a keyword (e.g. scam)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              create.mutate({ keyword: draft.trim() }, { onSuccess: () => setDraft("") });
            }
          }}
          className="max-w-md"
        />
        <Button
          variant="secondary"
          disabled={!draft.trim() || create.isPending}
          onClick={() =>
            create.mutate({ keyword: draft.trim() }, { onSuccess: () => setDraft("") })
          }
        >
          <Plus size={14} /> Add
        </Button>
      </div>
    </Panel>
  );
}

// -----------------------------------------------------------------
// Topic keywords
// -----------------------------------------------------------------
function TopicKeywordsPanel() {
  const listQ = topicKeywordsHooks.useList();
  const create = topicKeywordsHooks.useCreate();
  const update = topicKeywordsHooks.useUpdate();
  const del = topicKeywordsHooks.useDelete();
  const [kw, setKw] = useState("");
  const [label, setLabel] = useState("");

  return (
    <Panel
      title="Topic keywords"
      subtitle="Maps keyword → topic label. First substring hit wins; longest keywords are checked first so 'customer service' beats 'service'."
    >
      <div className="overflow-hidden rounded-md border border-rs-stone">
        <table className="w-full text-left text-sm">
          <thead className="bg-rs-bg text-xs uppercase text-rs-slate">
            <tr>
              <th className="px-3 py-2">Keyword</th>
              <th className="px-3 py-2">Topic label</th>
              <th className="px-3 py-2">Active</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {listQ.data?.map((t) => (
              <tr key={t.id} className="border-t border-rs-stone">
                <td className="px-3 py-2">
                  <Input
                    defaultValue={t.keyword}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== t.keyword) update.mutate({ id: t.id, patch: { keyword: v } });
                    }}
                    className="max-w-xs"
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    defaultValue={t.topic_label}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== t.topic_label)
                        update.mutate({ id: t.id, patch: { topic_label: v } });
                    }}
                    className="max-w-xs"
                  />
                </td>
                <td className="px-3 py-2">
                  <Switch
                    checked={t.active}
                    onCheckedChange={(v) => update.mutate({ id: t.id, patch: { active: v } })}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <Button variant="ghost" size="icon" onClick={() => del.mutate(t.id)}>
                    <Trash2 size={14} className="text-red-500" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input
          placeholder="Keyword"
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          className="max-w-xs"
        />
        <Input
          placeholder="Topic label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="max-w-xs"
        />
        <Button
          variant="secondary"
          disabled={!kw.trim() || !label.trim() || create.isPending}
          onClick={() =>
            create.mutate(
              { keyword: kw.trim(), topic_label: label.trim() },
              {
                onSuccess: () => {
                  setKw("");
                  setLabel("");
                },
              },
            )
          }
        >
          <Plus size={14} /> Add mapping
        </Button>
      </div>
    </Panel>
  );
}

// -----------------------------------------------------------------
// Users
// -----------------------------------------------------------------
function UsersPanel() {
  const usersQ = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const resetPw = useResetUserPassword();
  const deleteUser = useDeleteUser();

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<Role>("user");
  const [dialog, setDialog] = useState<
    | { kind: "created"; email: string; password: string | null }
    | { kind: "reset"; email: string; password: string }
    | null
  >(null);

  function addUser() {
    if (!newEmail.trim() || !newName.trim()) return;
    createUser.mutate(
      { email: newEmail.trim(), name: newName.trim(), role: newRole },
      {
        onSuccess: (res) => {
          setNewEmail("");
          setNewName("");
          setNewRole("user");
          if (res.initial_password) {
            setDialog({
              kind: "created",
              email: res.user.email,
              password: res.initial_password,
            });
          }
        },
      },
    );
  }

  return (
    <Panel title="Users" subtitle="Admins manage everything. Users review mentions. Viewers are read-only.">
      <div className="overflow-hidden rounded-md border border-rs-stone">
        <table className="w-full text-left text-sm">
          <thead className="bg-rs-bg text-xs uppercase text-rs-slate">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Password</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {usersQ.data?.users.map((u) => (
              <tr key={u.id} className="border-t border-rs-stone">
                <td className="px-3 py-2">
                  <Input
                    defaultValue={u.name}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== u.name) updateUser.mutate({ id: u.id, patch: { name: v } });
                    }}
                    className="max-w-xs"
                  />
                </td>
                <td className="px-3 py-2 text-rs-slate">{u.email}</td>
                <td className="px-3 py-2">
                  <select
                    value={u.role}
                    onChange={(e) =>
                      updateUser.mutate({ id: u.id, patch: { role: e.target.value as Role } })
                    }
                    className="rounded-md border border-rs-stone bg-white px-2 py-1 text-sm"
                  >
                    <option value="admin">Admin</option>
                    <option value="user">User</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </td>
                <td className="px-3 py-2 text-xs text-rs-slate">
                  {u.password_updated_at
                    ? new Date(u.password_updated_at).toLocaleDateString()
                    : "—"}
                  {u.is_super_user && <Badge className="ml-2" variant="warning">Super</Badge>}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        resetPw.mutate(u.id, {
                          onSuccess: (r) =>
                            setDialog({ kind: "reset", email: u.email, password: r.new_password }),
                        })
                      }
                    >
                      Reset password
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm(`Delete ${u.email}? This cannot be undone.`)) {
                          deleteUser.mutate(u.id);
                        }
                      }}
                    >
                      <Trash2 size={14} className="text-red-500" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr,1fr,140px,auto]">
        <Input placeholder="name@example.com" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
        <Input placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <select
          value={newRole}
          onChange={(e) => setNewRole(e.target.value as Role)}
          className="rounded-md border border-rs-stone bg-white px-2 py-1 text-sm"
        >
          <option value="admin">Admin</option>
          <option value="user">User</option>
          <option value="viewer">Viewer</option>
        </select>
        <Button
          variant="secondary"
          onClick={addUser}
          disabled={!newEmail.trim() || !newName.trim() || createUser.isPending}
        >
          <Plus size={14} /> Add user
        </Button>
      </div>

      {dialog && (
        <Dialog open onOpenChange={() => setDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {dialog.kind === "created" ? "User created" : "Password reset"}
              </DialogTitle>
              <DialogDescription>
                {dialog.kind === "created"
                  ? "Copy this password once — it won't be shown again. Share it with the user out-of-band."
                  : `New password for ${dialog.email}. Every active session for this user has been killed.`}
              </DialogDescription>
            </DialogHeader>
            {dialog.password && (
              <div className="flex items-center gap-2 rounded-md bg-rs-bg p-3 font-mono text-sm">
                <span className="flex-1 break-all">{dialog.password}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigator.clipboard.writeText(dialog.password!)}
                >
                  <Copy size={14} /> Copy
                </Button>
              </div>
            )}
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDialog(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Panel>
  );
}

// -----------------------------------------------------------------
// Shared panel wrapper
// -----------------------------------------------------------------
function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-rs-stone bg-white p-5">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-rs-ink">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-rs-slate">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}
