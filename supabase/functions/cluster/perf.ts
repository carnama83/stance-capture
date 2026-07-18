// supabase/functions/cluster/perf.ts
export function startPerf() {
  const t0 = performance.now();
  const traceId = crypto.randomUUID();
  // Accumulators in ms
  const spans = {
    db: 0,
    external: 0,
    compute: 0
  };
  function span(kind) {
    const s = performance.now();
    let ended = false;
    return ()=>{
      if (ended) return; // guard: prevents double-counting if end() called twice
      ended = true;
      const dt = performance.now() - s;
      spans[kind] = (spans[kind] ?? 0) + dt;
    };
  }
  function finish(extra = {}) {
    const duration = performance.now() - t0;
    const external_ms = Number((spans.external ?? 0).toFixed(0));
    const db_ms = Number((spans.db ?? 0).toFixed(0));
    // Compute is total minus external time minus db time
    const computeRaw = duration - external_ms - db_ms;
    const compute_ms = Number(Math.max(0, computeRaw).toFixed(0));
    const done = {
      traceId,
      duration_ms: Number(duration.toFixed(0)),
      external_ms,
      db_ms,
      compute_ms,
      ...extra
    };
    return done;
  }
  return {
    traceId,
    t0,
    spans,
    span,
    finish
  };
}
function envStr(key, fallback = "") {
  return Deno.env.get(key) ?? fallback;
}
/**
 * Best-effort emit into admin.fn_perf via PostgREST.
 *
 * FIX: Table is admin.fn_perf, not public.admin_fn_perf.
 * PostgREST exposes it as /rest/v1/fn_perf when the accept-profile
 * and content-profile headers are set to "admin".
 *
 * If env vars are missing, no-ops safely.
 */ export async function emitPerf(payload) {
  try {
    const projectUrl = envStr("SUPABASE_URL") || envStr("PROJECT_URL");
    const serviceKey = envStr("SUPABASE_SERVICE_ROLE_KEY") || envStr("SERVICE_ROLE_KEY");
    if (!projectUrl || !serviceKey) {
      console.log(JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        func: "cluster",
        msg: "perf_emit_skipped_missing_env",
        hasProjectUrl: !!projectUrl,
        hasServiceRole: !!serviceKey
      }));
      return;
    }
    const base = projectUrl.replace(/\/+$/, "");
    // FIXED: was /rest/v1/admin_fn_perf (wrong — that's a public schema path).
    // admin.fn_perf is exposed at /rest/v1/fn_perf with schema-switching headers.
    const endpoint = `${base}/rest/v1/fn_perf`;
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": serviceKey,
        "authorization": `Bearer ${serviceKey}`,
        "prefer": "return=minimal",
        // Tell PostgREST to target the admin schema
        "accept-profile": "admin",
        "content-profile": "admin"
      },
      body: JSON.stringify(payload)
    });
    // Do NOT throw if this fails — keep perf as non-blocking
    const preview = await resp.text().catch(()=>"");
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: resp.ok ? "info" : "warn",
      func: "cluster",
      msg: "perf_emit_result",
      status: resp.status,
      endpoint,
      response_preview: preview?.slice(0, 300) ?? ""
    }));
  } catch (e) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      func: "cluster",
      msg: "perf_emit_failed_nonblocking",
      error: e?.message ?? String(e)
    }));
  }
}
