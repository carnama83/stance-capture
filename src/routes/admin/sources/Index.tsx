import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { createSupabase } from "@/lib/createSupabase";
import { ROUTES } from "@/routes/paths";

type SourceKind = "rss" | "api" | "social";

type SourceRow = {
  id: string;
  name: string;
  kind: SourceKind;
  endpoint: string;
  country_name: string | null; // ✅ NEW
  is_enabled: boolean;
  last_polled_at: string | null;
  last_status: string | null;
  last_error: string | null;
  success_count: number | null;
  failure_count: number | null;
};

const adminNavItems = [
  { label: "Sources", to: ROUTES.ADMIN_SOURCES },
  { label: "Ingestion", to: ROUTES.ADMIN_INGESTION },
  { label: "Drafts", to: ROUTES.ADMIN_DRAFTS },
  { label: "Questions", to: ROUTES.ADMIN_QUESTIONS },
  { label: "News", to: ROUTES.ADMIN_NEWS },
];

// ✅ timeout helper so UI never gets stuck on a hung request
function withTimeout<T>(p: Promise<T>, ms = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export default function AdminSourcesIndex() {
  const supabase = useMemo(createSupabase, []);
  const location = useLocation();

  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);

  // simple filters (client-side)
  const [kind, setKind] = useState<"all" | SourceKind>("all");
  const [enabled, setEnabled] = useState<"all" | "on" | "off">("all");
  const [q, setQ] = useState<string>("");

  // edit/create modal state
  const [editing, setEditing] = useState<Partial<SourceRow> | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null); // per-row action gate
  const [saving, setSaving] = useState<boolean>(false); // modal save gate

  async function fetchRows() {
    setLoading(true);
    setErr(null);

    try {
      // Attempt 1: v_source_health
      {
        const qSel = supabase
          .from("v_source_health")
          .select("*")
          .order("is_enabled", { ascending: false })
          .order("last_polled_at", { ascending: false });

        const { data, error } = await qSel;
        if (!error && data) {
          setRows((data as any[]).map(mapHealthToRow));
          setLoading(false);
          return;
        }
      }

      // Attempt 2: topic_sources (map to the UI shape)
      {
        const { data, error } = await supabase
          .from("topic_sources")
          .select("*")
          .order("name", { ascending: true });

        if (error) throw error;

        const mapped = (data ?? []).map(mapTopicSourcesToRow);
        setRows(mapped);
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load sources");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editing) setSaving(false);
  }, [editing]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (enabled === "on" && !r.is_enabled) return false;
      if (enabled === "off" && r.is_enabled) return false;
      if (q) {
        const qq = q.toLowerCase();
        const hay = `${r.name} ${r.endpoint} ${r.country_name ?? ""}`.toLowerCase(); // ✅ include
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [rows, kind, enabled, q]);

  function mapHealthToRow(r: any): SourceRow {
    return {
      id: r.id,
      name: r.name,
      kind: r.kind as SourceKind,
      endpoint: r.endpoint,
      country_name: r.country_name ?? null, // ✅ NEW
      is_enabled: !!r.is_enabled,
      last_polled_at: r.last_polled_at ?? r.last_run_at ?? null,
      last_status: r.last_status ?? null,
      last_error: r.last_error ?? null,
      success_count: r.success_count ?? null,
      failure_count: r.failure_count ?? null,
    };
  }

  function mapTopicSourcesToRow(r: any): SourceRow {
    return {
      id: r.id,
      name: r.name,
      kind: (r.kind as SourceKind) ?? "rss",
      endpoint: r.endpoint ?? r.url ?? "",
      country_name: r.country_name ?? null, // ✅ NEW
      is_enabled: !!(r.is_enabled ?? r.enabled ?? true),
      last_polled_at: r.last_polled_at ?? r.last_run_at ?? null,
      last_status: r.last_status ?? null,
      last_error: r.last_error ?? null,
      success_count: r.success_count ?? null,
      failure_count: r.failure_count ?? null,
    };
  }

  async function onToggle(row: SourceRow, nextEnabled: boolean) {
    setBusyId(row.id);
    const prev = rows;
    setRows((rs) =>
      rs.map((x) => (x.id === row.id ? { ...x, is_enabled: nextEnabled } : x))
    );

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
    try {
      const { data, error } = await supabase.functions.invoke("ingest", {
        body: { source_id: row.id },
      });
      if (error) throw error;

      const statusLine =
        typeof data?.status !== "undefined" ? `Status: ${data.status}` : "";
      const traceLine = data?.traceId ? `Trace: ${data.traceId}` : "";
      alert(
        `Triggered ingest for "${row.name}".\n${[statusLine, traceLine]
          .filter(Boolean)
          .join("\n")}`
      );

      fetchRows();
    } catch (e: any) {
      alert(`Run failed: ${e?.message || e}`);
    } finally {
      setBusyId(null);
    }
  }

  async function onSave(draft: Partial<SourceRow>) {
    if (saving) return;

    if (!draft.name || !draft.endpoint || !draft.kind) {
      alert("Please provide name, kind, and endpoint.");
      return;
    }

    setSaving(true);
    setErr(null);

    // normalize country_name: empty -> null
    const countryName =
      draft.country_name && draft.country_name.trim().length > 0
        ? draft.country_name.trim()
        : null;

    try {
      if (draft.id) {
        const p = supabase
          .from("topic_sources")
          .update({
            name: draft.name,
            endpoint: draft.endpoint,
            kind: draft.kind,
            country_name: countryName, // ✅ NEW
            is_enabled: draft.is_enabled ?? true,
          })
          .eq("id", draft.id);

        const { error } = await withTimeout(p, 15000);
        if (error) throw error;
      } else {
        const p = supabase.from("topic_sources").insert({
          name: draft.name,
          endpoint: draft.endpoint,
          kind: draft.kind,
          country_name: countryName, // ✅ NEW
          is_enabled: draft.is_enabled ?? true,
        });

        const { error } = await withTimeout(p, 15000);
        if (error) throw error;
      }

      setEditing(null);
      void fetchRows();
    } catch (e: any) {
      alert(`Save failed: ${e?.message ?? e}`);
    } finally {
      setSaving(false);
    }
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
      {/* Top admin nav */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 12,
          borderBottom: "1px solid #e2e8f0",
          paddingBottom: 8,
        }}
      >
        {adminNavItems.map((item, idx) => {
          const active = location.pathname === item.to;
          return (
            <Link
              key={`${item.to}-${idx}`}
              to={item.to}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                fontSize: 13,
                textDecoration: "none",
                border: active ? "1px solid #1d4ed8" : "1px solid transparent",
                backgroundColor: active ? "#e0edff" : "transparent",
                color: active ? "#1d4ed8" : "#334155",
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Header / filters */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
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
            placeholder="Search name, endpoint, or country…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 240 }}
          />
          <button
            onClick={() =>
              setEditing({
                kind: "rss",
                is_enabled: true,
                country_name: "", // ✅ NEW default field
              } as Partial<SourceRow>)
            }
          >
            + New
          </button>
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
                <th>Country</th> {/* ✅ NEW */}
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
                  <td
                    style={{
                      maxWidth: 260,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.name}
                  </td>
                  <td>{r.kind}</td>
                  <td>{r.country_name ?? "—"}</td> {/* ✅ NEW */}
                  <td
                    style={{
                      maxWidth: 420,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={r.endpoint}
                  >
                    {r.endpoint}
                  </td>
                  <td>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
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
                      <span
                        title={r.last_error}
                        style={{
                          marginLeft: 6,
                          color: "#b00",
                          cursor: "help",
                        }}
                      >
                        ⓘ
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {r.last_polled_at ? new Date(r.last_polled_at).toLocaleString() : "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 8 }}>
                      <button disabled={busyId === r.id} onClick={() => setEditing(r)}>
                        Edit
                      </button>
                      <button disabled={busyId === r.id} onClick={() => onRun(r)}>
                        Run
                      </button>
                      <button
                        disabled={busyId === r.id}
                        onClick={() => onDelete(r)}
                        style={{ color: "#b00" }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td
                    colSpan={10} // ✅ was 9
                    style={{
                      padding: 24,
                      textAlign: "center",
                      color: "#666",
                    }}
                  >
                    No sources found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal for create/edit */}
      {editing && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.35)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => setEditing(null)}
        >
          <div
            style={{
              background: "white",
              minWidth: 420,
              maxWidth: 640,
              padding: 16,
              borderRadius: 12,
            }}
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
                  disabled={saving}
                />
              </label>

              <label>
                <div>Kind</div>
                <select
                  value={(editing.kind as SourceKind) ?? "rss"}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      kind: e.target.value as SourceKind,
                    })
                  }
                  style={{ width: "100%" }}
                  disabled={saving}
                >
                  <option value="rss">rss</option>
                  <option value="api">api</option>
                  <option value="social">social</option>
                </select>
              </label>

              {/* ✅ NEW: Country Name field */}
              <label>
                <div>Country Name</div>
                <input
                  value={editing.country_name ?? ""}
                  onChange={(e) => setEditing({ ...editing, country_name: e.target.value })}
                  placeholder="e.g., Australia"
                  style={{ width: "100%" }}
                  disabled={saving}
                />
              </label>

              <label>
                <div>Endpoint (URL)</div>
                <input
                  value={editing.endpoint ?? ""}
                  onChange={(e) => setEditing({ ...editing, endpoint: e.target.value })}
                  placeholder="https://example.com/feed.xml"
                  style={{ width: "100%" }}
                  disabled={saving}
                />
              </label>

              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <input
                  type="checkbox"
                  checked={editing.is_enabled ?? true}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      is_enabled: e.target.checked,
                    })
                  }
                  disabled={saving}
                />
                Enabled
              </label>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                marginTop: 16,
              }}
            >
              <button onClick={() => setEditing(null)}>Cancel</button>

              <button
                disabled={saving}
                onClick={() => onSave(editing!)}
                style={{ fontWeight: 600 }}
              >
                {saving ? "Saving..." : editing.id ? "Save changes" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
