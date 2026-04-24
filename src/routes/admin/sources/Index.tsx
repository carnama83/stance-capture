/**
 * File: src/routes/admin/sources/Index.tsx
 *
 * Admin: News Sources Manager
 *
 * Provides the full CRUD interface for managing news ingestion sources
 * stored in the `topic_sources` table. Accessible at /admin/sources.
 *
 * Functionality:
 * - Lists all sources via the `v_source_health` view (joined with `topic_sources`
 *   for live polling stats: success/failure counts, last status, last polled time)
 * - Filter by kind (rss/api/social), enabled state, and free-text search
 * - Create new source via modal form (name, kind, country, endpoint, cadence)
 * - Edit existing source (fetches latest from `topic_sources` before opening modal)
 * - Toggle enabled/disabled per source inline
 * - Delete source with confirmation
 * - Run single source: invokes `ingest` Edge Function, falls back to
 *   `admin_ingest_source` RPC if Edge Function is unavailable
 * - Bulk run: multi-select checkboxes + "Run N Selected" button with
 *   sequential execution and per-source progress reporting
 * - StatusPill component: renders last_status as a color-coded badge
 *   (queued / running / done / error / unknown)
 * - All mutations use `withTimeout(promise, 15000)` to prevent silent hangs
 *
 * Key implementation notes:
 * - Reads via `v_source_health` (aggregated view); writes always go to `topic_sources`
 * - All Supabase insert/update calls must include `.select()` to force query execution
 *   (lazy builder pattern — without it the HTTP request never fires)
 * - `saving` state is explicitly reset to false before opening any modal to prevent
 *   stale lock from a prior failed save attempt blocking subsequent saves
 */

import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { getSupabase } from "@/lib/supabaseClient";
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
  polling_interval: string | null;
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

function StatusPill({
  status,
  error,
}: {
  status: string | null;
  error: string | null;
}) {
  const raw = (status ?? "").toLowerCase().trim();

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
  const supabase = getSupabase()!;
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

  // NEW: Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState<boolean>(false);
  const [runProgress, setRunProgress] = useState<string>("");

  const headers = useMemo(
    () => [
      "", // Checkbox column
      "Name",
      "Kind",
      "Country",
      "Endpoint",
      "Enabled",
      "Success",
      "Failure",
      "Cadence",
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

  // NEW: Toggle individual checkbox
  function toggleSelection(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // NEW: Toggle all checkboxes
  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(r => r.id)));
    }
  }

  // NEW: Run all selected sources
  async function runAllSelected() {
    if (selectedIds.size === 0) {
      alert("No sources selected");
      return;
    }

    if (!confirm(`Run ${selectedIds.size} selected source(s)?`)) {
      return;
    }

    setRunningAll(true);
    setRunProgress("");

    const selectedSources = filtered.filter(r => selectedIds.has(r.id));
    let completed = 0;
    const results: { name: string; success: boolean; error?: string }[] = [];

    for (const source of selectedSources) {
      completed++;
      setRunProgress(`Running ${completed}/${selectedSources.length}: ${source.name}...`);

      try {
        // Try Edge Function first
        try {
          const { data, error } = await withTimeout(
            supabase.functions.invoke("ingest", {
              body: { source_id: source.id },
            }),
            15000
          );

          if (error) throw error;
          results.push({ name: source.name, success: true });
          continue;
        } catch (edgeErr: any) {
          console.warn(`Edge ingest failed for ${source.name}, trying RPC`, edgeErr);
        }

        // Fallback to RPC
        const { error: rpcError } = await withTimeout(
          supabase.rpc("admin_ingest_source", { p_source_id: source.id }),
          15000
        );

        if (rpcError) {
          throw rpcError;
        }

        results.push({ name: source.name, success: true });
      } catch (e: any) {
        results.push({ 
          name: source.name, 
          success: false, 
          error: e?.message || String(e) 
        });
      }
    }

    setRunningAll(false);
    setRunProgress("");

    // Show results
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    let message = `Completed: ${successCount} succeeded, ${failCount} failed\n\n`;
    
    if (failCount > 0) {
      message += "Failed sources:\n";
      results
        .filter(r => !r.success)
        .forEach(r => {
          message += `- ${r.name}: ${r.error}\n`;
        });
    }

    alert(message);
    
    // Clear selection and refresh
    setSelectedIds(new Set());
    fetchRows();
  }

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

      setSaving(false);
      setEditing({
        id: canonical.id,
        name: canonical.name ?? "",
        kind: (canonical.kind as SourceKind) ?? "rss",
        endpoint: canonical.endpoint ?? "",
        country_name: canonical.country_name ?? "",
        is_enabled: canonical.is_enabled ?? true,
        polling_interval: (canonical as any).polling_interval ?? "daily",
      });
    } catch (e: any) {
      alert(`Failed to open edit: ${e?.message ?? e}`);
      setSaving(false);
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

  async function onToggle(row: SourceRow, checked: boolean) {
    setBusyId(row.id);
    const { error } = await supabase
      .from("topic_sources")
      .update({ is_enabled: checked })
      .eq("id", row.id);
    setBusyId(null);
    if (error) {
      alert(`Toggle failed: ${error.message}`);
      return;
    }
    void fetchRows();
  }

  async function onRun(row: SourceRow) {
    setBusyId(row.id);
    setErr(null);

    try {
      // Try Edge Function first
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
        console.warn("Edge ingest failed; falling back to RPC admin_ingest_source", edgeErr);
      }

      // Attempt B: RPC admin_ingest_source(p_source_id uuid)
      const { data: rpcData, error: rpcError } = await withTimeout(
        supabase.rpc("admin_ingest_source", { p_source_id: row.id }),
        15000
      );

      if (rpcError) {
        throw rpcError;
      }

      alert(`Triggered ingest for "${row.name}" via admin_ingest_source().`);
      void fetchRows();
      return;
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
            polling_interval: draft.polling_interval ?? "daily",
          })
          .eq("id", draft.id)
          .select();

        const { error } = await withTimeout(p, 15000);
        if (error) throw error;
      } else {
        const p = supabase.from("topic_sources").insert({
          name: draft.name!.trim(),
          endpoint: draft.endpoint!.trim(),
          kind: draft.kind,
          country_name: countryName,
          is_enabled: draft.is_enabled ?? true,
          polling_interval: draft.polling_interval ?? "daily",
        }).select();

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

  const allChecked = filtered.length > 0 && selectedIds.size === filtered.length;
  const someChecked = selectedIds.size > 0 && selectedIds.size < filtered.length;

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
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* NEW: Run All Selected button */}
          {selectedIds.size > 0 && (
            <button
              onClick={runAllSelected}
              disabled={runningAll}
              style={{
                padding: "8px 16px",
                background: "#1d4ed8",
                color: "white",
                border: "none",
                borderRadius: 6,
                fontWeight: 600,
                cursor: runningAll ? "not-allowed" : "pointer",
                opacity: runningAll ? 0.6 : 1,
              }}
            >
              {runningAll 
                ? `⏳ ${runProgress}` 
                : `▶️ Run ${selectedIds.size} Selected`}
            </button>
          )}
          
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
            onClick={() => {
              setSaving(false);
              setEditing({
                kind: "rss",
                is_enabled: true,
                country_name: "",
              } as Partial<SourceRow>);
            }}
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
                {headers.map((h, idx) => (
                  <th
                    key={idx === 0 ? "checkbox" : h}
                    style={h === "Actions" ? { textAlign: "right" } : undefined}
                  >
                    {idx === 0 ? (
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={input => {
                          if (input) {
                            input.indeterminate = someChecked;
                          }
                        }}
                        onChange={toggleSelectAll}
                        title="Select all"
                      />
                    ) : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isSelected = selectedIds.has(r.id);
                
                const cells: React.ReactNode[] = [
                  <td key="checkbox">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelection(r.id)}
                      disabled={busyId === r.id || runningAll}
                    />
                  </td>,
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
                        disabled={busyId === r.id || runningAll}
                        onChange={(e) => onToggle(r, e.target.checked)}
                      />
                      {r.is_enabled ? "On" : "Off"}
                    </label>
                  </td>,
                  <td key="success">{r.success_count ?? 0}</td>,
                  <td key="failure">{r.failure_count ?? 0}</td>,
                  <td key="cadence" style={{ fontSize: 12, color: "#64748b" }}>
                    {r.polling_interval ?? "daily"}
                  </td>,
                  <td key="status">
                    <StatusPill status={r.last_status} error={r.last_error} />
                  </td>,
                  <td key="lastrun">
                    {r.last_polled_at ? new Date(r.last_polled_at).toLocaleString() : "—"}
                  </td>,
                  <td key="actions" style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 8 }}>
                      <button 
                        disabled={busyId === r.id || runningAll} 
                        onClick={() => openEdit(r)}
                      >
                        Edit
                      </button>
                      <button 
                        disabled={busyId === r.id || runningAll} 
                        onClick={() => onRun(r)}
                      >
                        Run
                      </button>
                      <button
                        disabled={busyId === r.id || runningAll}
                        onClick={() => onDelete(r)}
                        style={{ color: "#b00" }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>,
                ];

                return (
                  <tr 
                    key={r.id} 
                    style={{ 
                      borderBottom: "1px solid #eee",
                      background: isSelected ? "#eff6ff" : "transparent"
                    }}
                  >
                    {cells}
                  </tr>
                );
              })}

              {!filtered.length ? (
                <tr>
                  <td
                    colSpan={12}
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
                  placeholder="e.g., United States"
                  style={{ width: "100%" }}
                  disabled={saving}
                />
              </label>

              <label>
                <div>Endpoint (URL or identifier)</div>
                <input
                  value={editing.endpoint ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, endpoint: e.target.value })
                  }
                  placeholder="https://..."
                  style={{ width: "100%" }}
                  disabled={saving}
                />
              </label>

              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={!!editing.is_enabled}
                  onChange={(e) =>
                    setEditing({ ...editing, is_enabled: e.target.checked })
                  }
                  disabled={saving}
                />
                <span>Enabled</span>
              </label>

              <label>
                <div>Polling cadence</div>
                <select
                  value={(editing as any).polling_interval ?? "daily"}
                  onChange={(e) =>
                    setEditing({ ...editing, polling_interval: e.target.value } as any)
                  }
                  style={{ width: "100%" }}
                  disabled={saving}
                >
                  <option value="hourly">Hourly</option>
                  <option value="6h">Every 6 hours</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
            </div>

            <div
              style={{
                marginTop: 16,
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
              }}
            >
              <button onClick={() => setEditing(null)} disabled={saving}>
                Cancel
              </button>
              <button
                onClick={() => onSave(editing)}
                disabled={saving}
                style={{ fontWeight: 600 }}
              >
                {saving ? "Saving…" : editing.id ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
