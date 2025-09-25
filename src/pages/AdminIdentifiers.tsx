// src/pages/AdminIdentifiers.tsx
import * as React from "react";
import { getSupabase } from "../lib/supabaseClient";

type Row = {
  user_id: string;
  random_id: string | null;
  username: string | null;
  display_handle_mode: "random_id" | "username" | null;
  created_at: string | null;
  username_changes: number | null;
  username_last_changed_at: string | null;
  location_changes: number | null;
  location_last_changed_at: string | null;
};

export default function AdminIdentifiers() {
  const sb = React.useMemo(getSupabase, []);
  const [allowed, setAllowed] = React.useState<boolean | null>(null);
  const [q, setQ] = React.useState("");
  const [rows, setRows] = React.useState<Row[]>([]);
  const [count, setCount] = React.useState<number>(0);
  const [page, setPage] = React.useState(0);
  const limit = 25;
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      if (!sb) return setAllowed(false);
      const u = await sb.auth.getUser();
      if (!u.data.user) return setAllowed(false);
      const { data, error } = await sb.rpc("is_moderator");
      if (error) {
        setMsg(error.message);
        setAllowed(false);
        return;
      }
      setAllowed(Boolean(data));
    })();
  }, [sb]);

  React.useEffect(() => {
    if (!allowed) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, q, page]);

  async function load() {
    if (!sb) return;
    setBusy(true);
    setMsg(null);
    try {
      const from = page * limit;
      const to = from + limit - 1;
      let query = sb
        .from("mod_identifier_overview")
        .select(
          "user_id, random_id, username, display_handle_mode, created_at, username_changes, username_last_changed_at, location_changes, location_last_changed_at",
          { count: "exact" }
        )
        .order("created_at", { ascending: false })
        .range(from, to);

      const term = q.trim();
      if (term) {
        // match username OR random_id (case-insensitive)
        query = query.or(`username.ilike.*${term}*,random_id.ilike.*${term}*`);
      }

      const { data, error, count: c } = await query;
      if (error) throw error;
      setRows((data as Row[]) || []);
      setCount(c || 0);
    } catch (e: any) {
      setMsg(e.message || "Failed to load");
    } finally {
      setBusy(false);
    }
  }

  if (!sb) return <div className="p-6">Supabase is OFF (check env).</div>;
  if (allowed === null) return <div className="p-6">Checking access…</div>;
  if (allowed === false) return <div className="p-6">Not authorized.</div>;

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Moderator · Identifiers</h1>

      <div className="flex items-center gap-2">
        <input
          className="border rounded px-3 py-2 w-80"
          placeholder="Search username or random_id"
          value={q}
          onChange={(e) => {
            setPage(0);
            setQ(e.target.value);
          }}
        />
        <button
          className="border rounded px-3 py-2"
          onClick={() => load()}
          disabled={busy}
        >
          {busy ? "Loading…" : "Refresh"}
        </button>
        {msg && <div className="text-sm text-rose-700">{msg}</div>}
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-3 py-2">User ID</th>
              <th className="text-left px-3 py-2">Random ID</th>
              <th className="text-left px-3 py-2">Username</th>
              <th className="text-left px-3 py-2">Display as</th>
              <th className="text-left px-3 py-2">Username changes</th>
              <th className="text-left px-3 py-2">Last username change</th>
              <th className="text-left px-3 py-2">Location changes</th>
              <th className="text-left px-3 py-2">Last location change</th>
              <th className="text-left px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-slate-500">
                  {busy ? "Loading…" : "No results"}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.user_id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{r.user_id}</td>
                  <td className="px-3 py-2">{r.random_id || "—"}</td>
                  <td className="px-3 py-2">{r.username || "—"}</td>
                  <td className="px-3 py-2">{r.display_handle_mode || "—"}</td>
                  <td className="px-3 py-2">{r.username_changes ?? 0}</td>
                  <td className="px-3 py-2">
                    {r.username_last_changed_at
                      ? new Date(r.username_last_changed_at).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-3 py-2">{r.location_changes ?? 0}</td>
                  <td className="px-3 py-2">
                    {r.location_last_changed_at
                      ? new Date(r.location_last_changed_at).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pager */}
      <div className="flex items-center gap-3 text-sm">
        <span>
          Page {page + 1} / {Math.max(1, Math.ceil(count / limit))}
        </span>
        <button
          className="border rounded px-2 py-1"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={busy || page === 0}
        >
          Prev
        </button>
        <button
          className="border rounded px-2 py-1"
          onClick={() => setPage((p) => (p + 1 < Math.ceil(count / limit) ? p + 1 : p))}
          disabled={busy || rows.length < limit}
        >
          Next
        </button>
      </div>
    </div>
  );
}
