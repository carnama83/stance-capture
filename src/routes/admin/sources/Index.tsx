/**
 * File: src/routes/admin/sources/Index.tsx
 *
 * Admin: News Sources Manager
 *
 * Drop-in fixed version.
 *
 * Fixes included:
 * - Save mutations now use an explicit timeout, so the UI cannot remain stuck on
 *   "Saving…" forever if Supabase/network/PostgREST hangs.
 * - Save path logs every major step with a unique request id.
 * - Insert/update payload is logged before the request.
 * - Insert/update response is logged after the request.
 * - `saving` is reset in `finally` no matter what happens.
 * - Opening New/Edit always resets stale saving state.
 * - Fetch/Edit selects include `polling_interval`, so cadence does not get lost.
 * - Row mapping now always returns `polling_interval`, matching the SourceRow type.
 * - Fetches are also protected from silent hangs.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
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

type SavePayload = {
  name: string;
  endpoint: string;
  kind: SourceKind;
  country_name: string | null;
  is_enabled: boolean;
  polling_interval: string;
};

const ADMIN_SOURCES_DEBUG = true;

function debugLog(label: string, data?: unknown) {
  if (!ADMIN_SOURCES_DEBUG) return;
  const ts = new Date().toISOString();
  if (typeof data === "undefined") {
    console.log(`[AdminSources ${ts}] ${label}`);
  } else {
    console.log(`[AdminSources ${ts}] ${label}`, data);
  }
}

function debugWarn(label: string, data?: unknown) {
  if (!ADMIN_SOURCES_DEBUG) return;
  const ts = new Date().toISOString();
  console.warn(`[AdminSources ${ts}] ${label}`, data);
}

function debugError(label: string, data?: unknown) {
  const ts = new Date().toISOString();
  console.error(`[AdminSources ${ts}] ${label}`, data);
}

function errorMessage(e: unknown): string {
  if (!e) return "Unknown error";
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    const anyErr = e as any;
    return (
      anyErr.message ||
      anyErr.error_description ||
      anyErr.details ||
      anyErr.hint ||
      JSON.stringify(anyErr)
    );
  }
  return String(e);
}

function makeRequestId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}


function isAbortOrTimeoutError(e: unknown): boolean {
  const msg = errorMessage(e).toLowerCase();
  return msg.includes("abort") || msg.includes("timeout") || msg.includes("timed out");
}

async function runSupabaseWriteWithAbort<T>(
  build: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  const controller = new AbortController();
  debugLog(`[abort-timeout] starting ${label}; limit=${ms}ms`);

  const timer = window.setTimeout(() => {
    debugError(`[abort-timeout] aborting ${label}`, new Error(`${label} timed out after ${ms}ms`));
    controller.abort();
  }, ms);

  try {
    const result = await build(controller.signal);
    debugLog(`[abort-timeout] ${label} completed`);
    return result;
  } catch (e) {
    debugError(`[abort-timeout] ${label} rejected`, e);
    throw e;
  } finally {
    window.clearTimeout(timer);
  }
}

function withTimeout<T>(p: Promise<T>, ms = 15000, label = "operation"): Promise<T> {
  debugLog(`[timeout] starting ${label}; limit=${ms}ms`);

  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`);
      debugError(`[timeout] ${label} timed out`, err);
      reject(err);
    }, ms);

    p.then(
      (v) => {
        window.clearTimeout(t);
        debugLog(`[timeout] ${label} completed`);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        debugError(`[timeout] ${label} rejected`, e);
        reject(e);
      }
    );
  });
}

const adminNavItems = [
  { label: "Sources", to: ROUTES.ADMIN_SOURCES },
  { label: "Ingestion", to: ROUTES.ADMIN_INGESTION },
  { label: "Drafts", to: ROUTES.ADMIN_DRAFTS },
  { label: "Questions", to: ROUTES.ADMIN_QUESTIONS },
  { label: "News", to: ROUTES.ADMIN_NEWS },
];

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
        <span title={error} style={{ marginLeft: 2, color: "#b00", cursor: "help" }}>
          ⓘ
        </span>
      ) : null}
    </span>
  );
}

export default function AdminSourcesIndex() {
  const supabase = getSupabase()!;
  const location = useLocation();
  const mountedRef = useRef(true);

  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);

  const [kind, setKind] = useState<"all" | SourceKind>("all");
  const [enabled, setEnabled] = useState<"all" | "on" | "off">("all");
  const [q, setQ] = useState<string>("");

  const [editing, setEditing] = useState<Partial<SourceRow> | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState<boolean>(false);
  const [runProgress, setRunProgress] = useState<string>("");

  useEffect(() => {
    debugLog("mounted", { path: location.pathname, hash: window.location.hash });
    mountedRef.current = true;

    return () => {
      debugLog("unmounted", { path: location.pathname, hash: window.location.hash });
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headers = useMemo(
    () => [
      "",
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
      endpoint: r.endpoint ?? r.url ?? "",
      country_name: r.country_name ?? null,
      is_enabled: !!r.is_enabled,
      last_polled_at: r.last_polled_at ?? r.last_run_at ?? null,
      last_status: r.last_status ?? null,
      last_error: r.last_error ?? null,
      success_count: r.success_count ?? null,
      failure_count: r.failure_count ?? null,
      polling_interval: r.polling_interval ?? r.polling_cadence ?? "daily",
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
      polling_interval: r.polling_interval ?? r.polling_cadence ?? "daily",
    };
  }

  async function fetchRows() {
    const requestId = makeRequestId("fetchRows");
    debugLog(`[${requestId}] start`);

    setLoading(true);
    setErr(null);

    try {
      const [healthRes, srcRes] = await withTimeout(
        Promise.all([
          supabase
            .from("v_source_health")
            .select("*")
            .order("is_enabled", { ascending: false })
            .order("last_polled_at", { ascending: false }),
          supabase
            .from("topic_sources")
            .select("id,name,kind,endpoint,country_name,is_enabled,polling_interval")
            .order("name", { ascending: true }),
        ]),
        20000,
        `${requestId}: load v_source_health + topic_sources`
      );

      const { data: healthData, error: healthError } = healthRes;
      const { data: srcData, error: srcError } = srcRes;

      debugLog(`[${requestId}] responses`, {
        healthRows: healthData?.length ?? 0,
        srcRows: srcData?.length ?? 0,
        healthError,
        srcError,
      });

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
            polling_interval:
              base.polling_interval ?? s?.polling_interval ?? s?.polling_cadence ?? "daily",
          };
        });

        if (mountedRef.current) setRows(merged);
        debugLog(`[${requestId}] setRows from health`, { count: merged.length });
        return;
      }

      debugWarn(`[${requestId}] v_source_health unavailable; using topic_sources fallback`, healthError);
      const fallbackRows = (srcData ?? []).map(mapTopicSourcesToRow);
      if (mountedRef.current) setRows(fallbackRows);
      debugLog(`[${requestId}] setRows fallback`, { count: fallbackRows.length });
    } catch (e: any) {
      debugError(`[${requestId}] failed`, e);
      if (mountedRef.current) setErr(errorMessage(e) || "Failed to load sources");
    } finally {
      if (mountedRef.current) setLoading(false);
      debugLog(`[${requestId}] finally`);
    }
  }

  useEffect(() => {
    void fetchRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editing) {
      debugLog("editing opened/changed; forcing saving=false", editing);
      setSaving(false);
    }
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

  function openNew() {
    debugLog("[+ New] opening modal; reset saving=false");
    setErr(null);
    setSaving(false);
    setEditing({
      kind: "rss",
      is_enabled: true,
      country_name: "",
      polling_interval: "daily",
    } as Partial<SourceRow>);
  }

  function closeModal() {
    debugLog("[modal] closing; reset saving=false");
    setSaving(false);
    setEditing(null);
  }

  function toggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((r) => r.id)));
    }
  }

  async function runAllSelected() {
    if (selectedIds.size === 0) {
      alert("No sources selected");
      return;
    }

    if (!confirm(`Run ${selectedIds.size} selected source(s)?`)) return;

    setRunningAll(true);
    setRunProgress("");

    const selectedSources = filtered.filter((r) => selectedIds.has(r.id));
    let completed = 0;
    const results: { name: string; success: boolean; error?: string }[] = [];

    for (const source of selectedSources) {
      completed++;
      setRunProgress(`Running ${completed}/${selectedSources.length}: ${source.name}...`);

      try {
        try {
          const { error } = await withTimeout(
            supabase.functions.invoke("ingest", { body: { source_id: source.id } }),
            15000,
            `bulk ingest edge ${source.name}`
          );

          if (error) throw error;
          results.push({ name: source.name, success: true });
          continue;
        } catch (edgeErr: any) {
          debugWarn(`Edge ingest failed for ${source.name}, trying RPC`, edgeErr);
        }

        const { error: rpcError } = await withTimeout(
          supabase.rpc("admin_ingest_source", { p_source_id: source.id }),
          15000,
          `bulk ingest rpc ${source.name}`
        );

        if (rpcError) throw rpcError;
        results.push({ name: source.name, success: true });
      } catch (e: any) {
        results.push({ name: source.name, success: false, error: errorMessage(e) });
      }
    }

    setRunningAll(false);
    setRunProgress("");

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    let message = `Completed: ${successCount} succeeded, ${failCount} failed\n\n`;

    if (failCount > 0) {
      message += "Failed sources:\n";
      results
        .filter((r) => !r.success)
        .forEach((r) => {
          message += `- ${r.name}: ${r.error}\n`;
        });
    }

    alert(message);
    setSelectedIds(new Set());
    void fetchRows();
  }

  async function openEdit(row: SourceRow) {
    const requestId = makeRequestId("openEdit");
    debugLog(`[${requestId}] start`, row);

    setErr(null);
    setBusyId(row.id);
    setSaving(false);

    try {
      const { data, error } = await withTimeout(
        supabase
          .from("topic_sources")
          .select("id,name,kind,endpoint,country_name,is_enabled,polling_interval")
          .eq("id", row.id)
          .maybeSingle(),
        15000,
        `${requestId}: load topic_sources row`
      );

      debugLog(`[${requestId}] response`, { data, error });
      if (error) throw error;

      const canonical = data ?? {
        id: row.id,
        name: row.name,
        kind: row.kind,
        endpoint: row.endpoint,
        country_name: row.country_name,
        is_enabled: row.is_enabled,
        polling_interval: row.polling_interval ?? "daily",
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
      debugError(`[${requestId}] failed; opening fallback edit object`, e);
      alert(`Failed to open edit: ${errorMessage(e)}`);
      setSaving(false);
      setEditing({
        id: row.id,
        name: row.name ?? "",
        kind: row.kind ?? "rss",
        endpoint: row.endpoint ?? "",
        country_name: row.country_name ?? "",
        is_enabled: row.is_enabled ?? true,
        polling_interval: row.polling_interval ?? "daily",
      });
    } finally {
      setBusyId(null);
      debugLog(`[${requestId}] finally`);
    }
  }

  async function onToggle(row: SourceRow, checked: boolean) {
    const requestId = makeRequestId("toggle");
    debugLog(`[${requestId}] start`, { id: row.id, checked });

    setBusyId(row.id);
    try {
      const { error } = await withTimeout(
        supabase.from("topic_sources").update({ is_enabled: checked }).eq("id", row.id),
        15000,
        `${requestId}: update is_enabled`
      );
      if (error) throw error;
      void fetchRows();
    } catch (e: any) {
      debugError(`[${requestId}] failed`, e);
      alert(`Toggle failed: ${errorMessage(e)}`);
    } finally {
      setBusyId(null);
      debugLog(`[${requestId}] finally`);
    }
  }

  async function onRun(row: SourceRow) {
    const requestId = makeRequestId("runOne");
    debugLog(`[${requestId}] start`, row);

    setBusyId(row.id);
    setErr(null);

    try {
      try {
        const { data, error } = await withTimeout(
          supabase.functions.invoke("ingest", { body: { source_id: row.id } }),
          15000,
          `${requestId}: edge ingest`
        );

        debugLog(`[${requestId}] edge response`, { data, error });
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
        debugWarn(`[${requestId}] Edge ingest failed; falling back to RPC`, edgeErr);
      }

      const { error: rpcError } = await withTimeout(
        supabase.rpc("admin_ingest_source", { p_source_id: row.id }),
        15000,
        `${requestId}: rpc admin_ingest_source`
      );

      if (rpcError) throw rpcError;

      alert(`Triggered ingest for "${row.name}" via admin_ingest_source().`);
      void fetchRows();
    } catch (e: any) {
      debugError(`[${requestId}] failed`, e);
      alert(`Run failed: ${errorMessage(e)}`);
    } finally {
      setBusyId(null);
      debugLog(`[${requestId}] finally`);
    }
  }

  async function onSave(draft: Partial<SourceRow>) {
    const requestId = makeRequestId("save");
    debugLog(`[${requestId}] called`, {
      saving,
      draft,
      route: location.pathname,
      hash: window.location.hash,
      online: navigator.onLine,
    });

    if (saving) {
      debugWarn(`[${requestId}] blocked because saving=true`, draft);
      return;
    }

    const missing: string[] = [];
    if (!draft.name?.trim()) missing.push("name");
    if (!draft.kind) missing.push("kind");
    if (!draft.endpoint?.trim()) missing.push("endpoint");
    if (missing.length) {
      debugWarn(`[${requestId}] validation failed`, missing);
      alert(`Please provide: ${missing.join(", ")}`);
      return;
    }

    setSaving(true);
    setErr(null);

    const payload: SavePayload = {
      name: draft.name!.trim(),
      endpoint: draft.endpoint!.trim(),
      kind: draft.kind as SourceKind,
      country_name:
        draft.country_name && draft.country_name.trim().length > 0
          ? draft.country_name.trim()
          : null,
      is_enabled: draft.is_enabled ?? true,
      polling_interval: draft.polling_interval ?? "daily",
    };

    debugLog(`[${requestId}] payload prepared`, payload);

    try {
      const sb = getSupabase()!;

      if (draft.id) {
        debugLog(`[${requestId}] UPDATE path - no select/returning`, { id: draft.id });

        const response = await runSupabaseWriteWithAbort(
          (signal) =>
            sb
              .from("topic_sources")
              .update(payload)
              .eq("id", draft.id!)
              .abortSignal(signal),
          15000,
          `${requestId}: topic_sources update`
        );

        const { data, error, status, statusText } = response as any;
        debugLog(`[${requestId}] UPDATE response`, { data, error, status, statusText });
        if (error) throw error;
      } else {
        debugLog(`[${requestId}] INSERT path - no select/returning`);

        const response = await runSupabaseWriteWithAbort(
          (signal) =>
            sb
              .from("topic_sources")
              .insert(payload)
              .abortSignal(signal),
          15000,
          `${requestId}: topic_sources insert`
        );

        const { data, error, status, statusText } = response as any;
        debugLog(`[${requestId}] INSERT response`, { data, error, status, statusText });
        if (error) throw error;
      }

      debugLog(`[${requestId}] SUCCESS; closing modal immediately; refreshing rows in background`);
      setEditing(null);
      setSaving(false);
      void fetchRows();
    } catch (e: any) {
      const msg = errorMessage(e);
      debugError(`[${requestId}] CAUGHT`, {
        raw: e,
        message: msg,
        isAbortOrTimeout: isAbortOrTimeoutError(e),
        hint:
          "If this is a timeout/AbortError, check DevTools Network for the topic_sources request. The DB/API is not returning, or the browser request is stalled.",
      });
      setErr(msg);
      alert(`Save failed: ${msg}`);
    } finally {
      debugLog(`[${requestId}] finally; mounted=${mountedRef.current}; setSaving(false)`);
      if (mountedRef.current) setSaving(false);
    }
  }

  async function onDelete(row: SourceRow) {
    const requestId = makeRequestId("delete");
    if (!confirm(`Delete source "${row.name}"?`)) return;

    debugLog(`[${requestId}] start`, row);
    setBusyId(row.id);

    try {
      const { error } = await withTimeout(
        supabase.from("topic_sources").delete().eq("id", row.id),
        15000,
        `${requestId}: delete topic_sources row`
      );
      if (error) throw error;
      void fetchRows();
    } catch (e: any) {
      debugError(`[${requestId}] failed`, e);
      alert(`Delete failed: ${errorMessage(e)}`);
    } finally {
      setBusyId(null);
      debugLog(`[${requestId}] finally`);
    }
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
              {runningAll ? `⏳ ${runProgress}` : `▶️ Run ${selectedIds.size} Selected`}
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
          <button onClick={openNew}>+ New</button>
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
                  <th key={idx === 0 ? "checkbox" : h} style={h === "Actions" ? { textAlign: "right" } : undefined}>
                    {idx === 0 ? (
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={(input) => {
                          if (input) input.indeterminate = someChecked;
                        }}
                        onChange={toggleSelectAll}
                        title="Select all"
                      />
                    ) : (
                      h
                    )}
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
                      <button disabled={busyId === r.id || runningAll} onClick={() => openEdit(r)}>
                        Edit
                      </button>
                      <button disabled={busyId === r.id || runningAll} onClick={() => onRun(r)}>
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
                      background: isSelected ? "#eff6ff" : "transparent",
                    }}
                  >
                    {cells}
                  </tr>
                );
              })}

              {!filtered.length ? (
                <tr>
                  <td colSpan={12} style={{ padding: 24, textAlign: "center", color: "#666" }}>
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
          onClick={() => {
            if (!saving) closeModal();
          }}
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
                  onChange={(e) => setEditing({ ...editing, kind: e.target.value as SourceKind })}
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
                  onChange={(e) => setEditing({ ...editing, country_name: e.target.value })}
                  placeholder="e.g., United States"
                  style={{ width: "100%" }}
                  disabled={saving}
                />
              </label>

              <label>
                <div>Endpoint (URL or identifier)</div>
                <input
                  value={editing.endpoint ?? ""}
                  onChange={(e) => setEditing({ ...editing, endpoint: e.target.value })}
                  placeholder="https://..."
                  style={{ width: "100%" }}
                  disabled={saving}
                />
              </label>

              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={!!editing.is_enabled}
                  onChange={(e) => setEditing({ ...editing, is_enabled: e.target.checked })}
                  disabled={saving}
                />
                <span>Enabled</span>
              </label>

              <label>
                <div>Polling cadence</div>
                <select
                  value={editing.polling_interval ?? "daily"}
                  onChange={(e) => setEditing({ ...editing, polling_interval: e.target.value })}
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
              <button onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button onClick={() => onSave(editing)} disabled={saving} style={{ fontWeight: 600 }}>
                {saving ? "Saving…" : editing.id ? "Update" : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
