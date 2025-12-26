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
  country_name: string | null;
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

/**
 * UI polish: show appropriate icon/color for status instead of always warning triangle.
 * Does not affect any existing functionality (pure render helper).
 */
function StatusPill({
  status,
  error,
}: {
  status: string | null;
  error: string | null;
}) {
  const raw = (status ?? "").toLowerCase().trim();

  // Normalize common aliases
  const norm =
    raw === "ok" || raw === "success"
      ? "done"
      : raw === "fail" || raw === "failed"
      ? "error"
      : raw;

  const meta = (() => {
    switch (norm) {
      case "":
        return { icon: "—", text: "—", bg: "transparent", fg: "inherit" };

      case "queued":
      case "pending":
      case "new":
        return { icon: "🕒", text: norm, bg: "#f1f5f9", fg: "#334155" };

      case "running":
        return { icon: "🔄", text: "running", bg: "#e0f2fe", fg: "#075985" };

      case "done":
        return { icon: "✅", text: "done", bg: "#dcfce7", fg: "#166534" };

      case "error":
        return { icon: "❌", text: "error", bg: "#fee2e2", fg: "#991b1b" };

      default:
        return { icon: "⚠️", text: norm || "unknown", bg: "#fef3c7", fg: "#92400e" };
    }
  })();

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 8px",
          borderRadius: 999,
          background: meta.bg,
          color: meta.fg,
          fontSize: 12,
          fontWeight: 600,
          lineHeight: 1.6,
          whiteSpace: "nowrap",
        }}
        title={error ? `Error: ${error}` : meta.text}
      >
        <span>{meta.icon}</span>
        <span>{meta.text}</span>
      </span>

      {error ? (
        <span
          title={error}
          style={{ marginLeft: 2, color: "#b00", cursor: "help" }}
        >
          ⓘ
        </span>
      ) : null}
    </span>
  );
}

export default function AdminSourcesIndex() {
  const supabase = useMemo(createSupabase, []);
  const location = useLocation();

  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);

  const [kind, setKind] = useState<"all" | SourceKind>("all");
  const [enabled, setEnabled] = useState<"all" | "on" | "off">("all");
  const [q, setQ] = useState<string>("");

  const [editing, setEditing] = useState<Partial<SourceRow> | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  const headers = useMemo(
    () => [
      "Name",
      "Kind",
      "Country",
      "Endpoint",
      "Enabled",
      "Success",
      "Failure",
      "Last Status",
      "Last Run",
      "Actions",
    ],
    []
  );

  function mapHealthToRow(r: any): SourceRow {
    return {
      id: r.id,
      name: r.name ?? "",
      kind: (r.kind ?? "rss") as SourceKind,
      endpoint: r.endpoint ?? "",
      country_name: r.country_name ?? null,
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
      name: r.name ?? "",
      kind: (r.kind as SourceKind) ?? "rss",
      endpoint: r.endpoint ?? r.url ?? "",
      country_name: r.country_name ?? null,
      is_enabled: !!(r.is_enabled ?? r.enabled ?? true),
      last_polled_at: r.last_polled_at ?? r.last_run_at ?? null,
      last_status: r.last_status ?? null,
      last_error: r.last_error ?? null,
      success_count: r.success_count ?? null,
      failure_count: r.failure_count ?? null,
    };
  }

  async function fetchRows() {
    setLoading(true);
    setErr(null);

    try {
      const [healthRes, srcRes] = await Promise.all([
        supabase
          .from("v_source_health")
          .select("*")
          .order("is_enabled", { ascending: false })
          .order("last_polled_at", { ascending: false }),
        supabase
          .from("topic_sources")
          .select("id,name,kind,endpoint,country_name,is_enabled")
          .order("name", { ascending: true }),
      ]);

      const { data: healthData, error: healthError } = healthRes;
      const { data: srcData, error: srcError } = srcRes;

      if (srcError) throw srcError;

      const srcById = new Map<string, any>();
      (srcData ?? []).forEach((s: any) => srcById.set(s.id, s));

      if (!healthError && healthData) {
        const merged: SourceRow[] = (healthData as any[]).map((h) => {
          const s = srcById.get(h.id);
          const base = mapHealthToRow(h);

          return {
            ...base,
            name: base.name || (s?.name ?? ""),
            kind: (base.kind || s?.kind || "rss") as SourceKind,
            endpoint: base.endpoint || (s?.endpoint ?? ""),
            country_name: base.country_name ?? (s?.country_name ?? null),
            is_enabled:
              typeof h.is_enabled === "boolean" ? h.is_enabled : !!s?.is_enabled,
          };
        });

        setRows(merged);
        return;
      }

      setRows((srcData ?? []).map(mapTopicSourcesToRow));
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
        const hay = `${r.name} ${r.endpoint} ${r.country_name ?? ""}`.toLowerCase();
        if (!hay.includes(qq)) return false;
      }
      return true;
    });
  }, [rows, kind, enabled, q]);

  async function openEdit(row: SourceRow) {
    setErr(null);
    setBusyId(row.id);

    try {
      const { data, error } = await supabase
        .from("topic_sources")
        .select("id,name,kind,endpoint,country_name,is_enabled")
        .eq("id", row.id)
        .maybeSingle();

      if (error) throw error;

      const canonical = data ?? {
        id: row.id,
        name: row.name,
        kind: row.kind,
        endpoint: row.endpoint,
        country_name: row.country_name,
        is_enabled: row.is_enabled,
      };

      setEditing({
        id: canonical.id,
        name: canonical.name ?? "",
        kind: (canonical.kind as SourceKind) ?? "rss",
        endpoint: canonical.endpoint ?? "",
        country_name: canonical.country_name ?? "",
        is_enabled: canonical.is_enabled ?? true,
      });
    } catch (e: any) {
      alert(`Failed to open edit: ${e?.message ?? e}`);
      setEditing({
        id: row.id,
        name: row.name ?? "",
        kind: row.kind ?? "rss",
        endpoint: row.endpoint ?? "",
        country_name: row.country_name ?? "",
        is_enabled: row.is_enabled ?? true,
      });
    } finally {
      setBusyId(null);
    }
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

  // ✅ FIXED: Run ingestion with Edge Function first, then fallback to RPC admin_ingest_source
  async function onRun(row: SourceRow) {
    setBusyId(row.id);

    try {
      // Attempt A: Edge Function (if it exists in your project)
      try {
        const { data, error } = await withTimeout(
          supabase.functions.invoke("ingest", {
            body: { source_id: row.id },
          }),
          15000
        );

        if (error) throw error;

        const statusLine =
          typeof (data as any)?.status !== "undefined" ? `Status: ${(data as any).status}` : "";
        const traceLine = (data as any)?.traceId ? `Trace: ${(data as any).traceId}` : "";

        alert(
          `Triggered ingest for "${row.name}".\n${[statusLine, traceLine]
            .filter(Boolean)
            .join("\n")}`
        );

        void fetchRows();
        return;
      } catch (edgeErr: any) {
        // fall through to RPC
        console.warn("Edge ingest failed; falling back to RPC admin_ingest_source", edgeErr);
      }

      // Attempt B: RPC admin_ingest_source(uuid)
      // Parameter name can vary; try a few common ones.
      const paramCandidates = [
        { source_id: row.id },
        { p_source_id: row.id },
        { p_source: row.id },
        { id: row.id },
      ];

      let lastRpcError: any = null;
      for (const args of paramCandidates) {
        const { error } = await withTimeout(
          supabase.rpc("admin_ingest_source", args as any),
          15000
        );
        if (!error) {
          alert(`Triggered ingest for "${row.name}" via admin_ingest_source().`);
          void fetchRows();
          return;
        }
        lastRpcError = error;
      }

      throw lastRpcError ?? new Error("RPC admin_ingest_source failed (unknown error)");
    } catch (e: any) {
      alert(`Run failed: ${e?.message || e}`);
    } finally {
      setBusyId(null);
    }
  }

  async function onSave(draft: Partial<SourceRow>) {
    if (saving) return;

    const missing: string[] = [];
    if (!draft.name?.trim()) missing.push("name");
    if (!draft.kind) missing.push("kind");
    if (!draft.endpoint?.trim()) missing.push("endpoint");
    if (missing.length) {
      alert(`Please provide: ${missing.join(", ")}`);
      return;
    }

    setSaving(true);
    setErr(null);

    const countryName =
      draft.country_name && draft.country_name.trim().length > 0
        ? draft.country_name.trim()
        : null;

    try {
      if (draft.id) {
        const p = supabase
          .from("topic_sources")
          .update({
            name: draft.name!.trim(),
            endpoint: draft.endpoint!.trim(),
            kind: draft.kind,
            country_name: countryName,
            is_enabled: draft.is_enabled ?? true,
          })
          .eq("id", draft.id);

        const { error } = await withTimeout(p, 15000);
        if (error) throw error;
      } else {
        const p = supabase.from("topic_sources").insert({
          name: draft.name!.trim(),
          endpoint: draft.endpoint!.trim(),
          kind: draft.kind,
          country_name: countryName,
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
                country_name: "",
              } as Partial<SourceRow>)
            }
          >
            + New
          </button>
        </div>
      </div>

      {err && <p style={{ color: "crimson", marginTop: 8 }}>Error: {err}</p>}

      {loading ? (
        <p style={{ marginTop: 12 }}>Loading…</p>
      ) : (
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                {headers.map((h) => (
                  <th
                    key={h}
                    style={h === "Actions" ? { textAlign: "right" } : undefined}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const cells: React.ReactNode[] = [
                  <td
                    key="name"
                    style={{
                      maxWidth: 260,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.name}
                  </td>,
                  <td key="kind">{r.kind}</td>,
                  <td key="country">{r.country_name ?? "—"}</td>,
                  <td
                    key="endpoint"
                    style={{
                      maxWidth: 420,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={r.endpoint}
                  >
                    {r.endpoint}
                  </td>,
                  <td key="enabled">
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={!!r.is_enabled}
                        disabled={busyId === r.id}
                        onChange={(e) => onToggle(r, e.target.checked)}
                      />
                      {r.is_enabled ? "On" : "Off"}
                    </label>
                  </td>,
                  <td key="success">{r.success_count ?? 0}</td>,
                  <td key="failure">{r.failure_count ?? 0}</td>,

                  // ✅ Polished status UI (no more always-yellow)
                  <td key="status">
                    <StatusPill status={r.last_status} error={r.last_error} />
                  </td>,

                  <td key="lastrun">
                    {r.last_polled_at ? new Date(r.last_polled_at).toLocaleString() : "—"}
                  </td>,
                  <td key="actions" style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 8 }}>
                      <button disabled={busyId === r.id} onClick={() => openEdit(r)}>
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
                  </td>,
                ];

                return (
                  <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
                    {cells}
                  </tr>
                );
              })}

              {!filtered.length ? (
                <tr>
                  <td
                    colSpan={10}
                    style={{ padding: 24, textAlign: "center", color: "#666" }}
                  >
                    No sources found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
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
                    setEditing({ ...editing, kind: e.target.value as SourceKind })
                  }
                  style={{ width: "100%" }}
                  disabled={saving}
                >
                  <option value="rss">rss</option>
                  <option value="api">api</option>
                  <option value="social">social</option>
                </select>
              </label>

              <label>
                <div>Country Name</div>
                <input
                  value={editing.country_name ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, country_name: e.target.value })
                  }
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

              <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={editing.is_enabled ?? true}
                  onChange={(e) =>
                    setEditing({ ...editing, is_enabled: e.target.checked })
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
                onClick={() => onSave(editing)}
                style={{ fontWeight: 600 }}
              >
                {saving ? "Saving..." : editing.id ? "Save changes" : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
