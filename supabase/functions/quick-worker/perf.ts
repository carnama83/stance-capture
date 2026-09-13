// supabase/functions/cluster/perf.ts
// Minimal perf helper to match cluster/index.ts expectations
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
      if (ended) return;
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
 * Best-effort emit into public.admin_fn_perf via PostgREST.
 * If env vars are missing, this will no-op safely.
 */ export async function emitPerf(payload) {
  try {
    const projectUrl = envStr("SUPABASE_URL") || envStr("PROJECT_URL");
    const serviceKey = envStr("SUPABASE_SERVICE_ROLE_KEY") || envStr("SERVICE_ROLE_KEY");
    if (!projectUrl || !serviceKey) {
      // Safe no-op (avoid breaking the function if perf env isn't set)
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
    const endpoint = `${base}/rest/v1/admin_fn_perf`;
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": serviceKey,
        "authorization": `Bearer ${serviceKey}`,
        "prefer": "return=minimal"
      },
      body: JSON.stringify(payload)
    });
    // Do NOT throw if this fails — keep perf as non-blocking
    const preview = await resp.text().catch(()=>"");
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
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
