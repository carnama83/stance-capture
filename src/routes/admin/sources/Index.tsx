// stance-capture/src/routes/admin/sources/Index.tsx
import React, { useEffect, useMemo, useState } from "react";
import { createSupabase } from "@/lib/createSupabase";

type SourceKind = "rss" | "api" | "social";
type SourceRow = {
  id: string;
  name: string;
  kind: SourceKind;
  endpoint: string;
  is_enabled: boolean;
  last_polled_at: string | null;
  last_status: string | null;
  last_error: string | null;
  success_count: number | null;
  failure_count: number | null;
};

export default function AdminSourcesIndex() {
  const supabase = React.useMemo(createSupabase, []); // ← use same pattern as your layout

  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);

  // simple filters (client-side for now; can push to server later)
  const [kind, setKind] = useState<"all" | SourceKind>("all");
  const [enabled, setEnabled] = useState<"all" | "on" | "off">("all");
  const [q, setQ] = useState<string>("");

  // edit/create modal state
  const [editing, setEditing] = useState<Partial<SourceRow> | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null); // for per-row actions

  async function fetchRows() {
    setLoading(true);
    setErr(null);
    const qSel = supabase
      .from("v_source_health")
      .select("*")
      .order("is_enabled", { ascending: false })
      .order("last_polled_at", { ascending: false });

    const { data, error } = await qSel;
    if (error) setErr(error.message);
    setRows((data ?? []) as SourceRow[]);
    setLoading(false);
  }

  useEffect(() => {
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (enabled === "on" && !r.is_enabled) return false;
      if (enabled === "off" && r.is_enabled) return false;
      if (q) {
        const qq = q.toLowerCase();
        const hay = `${r.name} ${r.endpoint}`.toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [rows, kind, enabled, q]);

  async function onToggle(row: SourceRow, nextEnabled: boolean) {
    setBusyId(row.id);
    const prev = rows;
    setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, is_enabled: nextEnabled } : x)));
    const { error } = await supabase
      .from("topic_sources")
      .update({ is_enabled: nextEnabled })
      .eq("id", row.id)
      .select()
      .single();
    setBusyId(null);
    if (error) {
      alert(`Failed to toggle: ${error.message}`);
      setRows(prev);
    } else {
      fetchRows();
    }
  }

  async function onRun(row: SourceRow) {
    setBusyId(row.id);
    const { data, error } = await supabase.rpc("admin_ingest_source", { p_source_id: row.id });
    setBusyId(null);
    if (error) return alert(`Run failed: ${error.message}`);
    const status = (data as any)?.status ?? "unknown";
    alert(`Triggered ingest for "${row.name}" (HTTP ${status}). Check /admin/ingestion for activity.`);
  }

  async function onSave(draft: Partial<SourceRow>) {
    if (!draft.name || !draft.endpoint || !draft.kind) {
      return alert("Please provide name, kind, and endpoint.");
    }
    if (draft.id) {
      const { error } = await supabase
        .from("topic_sources")
        .update({
          name: draft.name,
          endpoint: draft.endpoint,
          kind: draft.kind,
          is_enabled: draft.is_enabled ?? true,
        })
        .eq("id", draft.id)
        .select()
        .single();
      if (error) return alert(`Update failed: ${error.message}`);
    } else {
      const { error } = await supabase
        .from("topic_sources")
        .insert({
          name: draft.name,
          endpoint: draft.endpoint,
          kind: draft.kind,
          is_enabled: draft.is_enabled ?? true,
        })
        .select()
        .single();
      if (error) return alert(`Create failed: ${error.message}`);
    }
    setEditing(null);
    fetchRows();
  }

  async function onDelete(row: SourceRow) {
    if (!confirm(`Delete source "${row.name}"?`)) return;
    setBusyId(row.id);
    const { error } = await supabase.from("topic_sources").delete().eq("id", row.id);
    setBusyId(null);
    if (error) return alert(`Delete failed: ${error.message}`);
    fetchRows();
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Header / filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Sources</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={kind} onChange={(e) => setKind(e.target.value as any)}>
            <option value="all">All kinds</option>
            <option value="rss">rss</option>
            <option value="api">api</option>
            <option value="social">social</option>
          </select>
          <select value={enabled} onChange={(e) => setEnabled(e.target.value as any)}>
            <option value="all">All</option>
            <option value="on">Enabled</option>
            <option value="off">Disabled</option>
          </select>
          <input
            placeholder="Search name or endpoint…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 240 }}
          />
          <button onClick={() => setEditing({ kind: "rss", is_enabled: true } as Partial<SourceRow>)}>+ New</button>
        </div>
      </div>

      {/* Errors / loading */}
      {err && <p style={{ color: "crimson", marginTop: 8 }}>Error: {err}</p>}
      {loading ? (
        <p style={{ marginTop: 12 }}>Loading…</p>
      ) : (
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th>Name</th>
                <th>Kind</th>
                <th>Endpoint</th>
                <th>Enabled</th>
                <th>Success</th>
                <th>Failure</th>
                <th>Last Status</th>
                <th>Last Run</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ maxWidth: 260, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</td>
                  <td>{r.kind}</td>
                  <td style={{ maxWidth: 420, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.endpoint}>
                    {r.endpoint}
                  </td>
                  <td>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={!!r.is_enabled}
                        disabled={busyId === r.id}
                        onChange={(e) => onToggle(r, e.target.checked)}
                      />
                      {r.is_enabled ? "On" : "Off"}
                    </label>
                  </td>
                  <td>{r.success_count ?? 0}</td>
                  <td>{r.failure_count ?? 0}</td>
                  <td>
                    {!r.last_status ? "—" : r.last_status === "ok" ? "✅ ok" : "⚠️ " + r.last_status}
                    {r.last_error ? (
                      <span title={r.last_error} style={{ marginLeft: 6, color: "#b00", cursor: "help" }}>
                        ⓘ
                      </span>
                    ) : null}
                  </td>
                  <td>{r.last_polled_at ? new Date(r.last_polled_at).toLocaleString() : "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 8 }}>
                      <button disabled={busyId === r.id} onClick={() => setEditing(r)}>
                        Edit
                      </button>
                      <button disabled={busyId === r.id} onClick={() => onRun(r)}>
                        Run
                      </button>
                      <button disabled={busyId === r.id} onClick={() => onDelete(r)} style={{ color: "#b00" }}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={9} style={{ padding: 24, textAlign: "center", color: "#666" }}>
                    No sources found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal for create/edit (very small inline dialog) */}
      {editing && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "grid", placeItems: "center", padding: 16 }}
          onClick={() => setEditing(null)}
        >
          <div
            style={{ background: "white", minWidth: 420, maxWidth: 640, padding: 16, borderRadius: 12 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>{editing.id ? "Edit source" : "New source"}</h3>

            <div style={{ display: "grid", gap: 12 }}>
              <label>
                <div>Name</div>
                <input
                  value={editing.name ?? ""}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="e.g., BBC World RSS"
                  style={{ width: "100%" }}
                />
              </label>

              <label>
                <div>Kind</div>
                <select
                  value={(editing.kind as SourceKind) ?? "rss"}
                  onChange={(e) => setEditing({ ...editing, kind: e.target.value as SourceKind })}
                  style={{ width: "100%" }}
                >
                  <option value="rss">rss</option>
                  <option value="api">api</option>
                  <option value="social">social</option>
                </select>
              </label>

              <label>
                <div>Endpoint (URL)</div>
                <input
                  value={editing.endpoint ?? ""}
                  onChange={(e) => setEditing({ ...editing, endpoint: e.target.value })}
                  placeholder="https://example.com/feed.xml"
                  style={{ width: "100%" }}
                />
              </label>

              <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={editing.is_enabled ?? true}
                  onChange={(e) => setEditing({ ...editing, is_enabled: e.target.checked })}
                />
                Enabled
              </label>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setEditing(null)}>Cancel</button>
              <button onClick={() => onSave(editing!)} style={{ fontWeight: 600 }}>
                {editing.id ? "Save changes" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
