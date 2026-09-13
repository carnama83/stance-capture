// supabase/functions/cluster/index.ts
// v3.2 — pipeline_jobs logging added (reconciled Sep 2026).
//        Embedding removed (v3.1). Assumes the `embed` function has already run.
import { startPerf, emitPerf } from "./perf.ts";
import { run as logicRun } from "./logic.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";
const FUNC = "cluster";
// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function log(level, msg, extra = {}, traceId) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    func: FUNC,
    traceId,
    msg,
    ...extra
  }));
}
// ---------------------------------------------------------------------------
// pipeline_jobs logging (best-effort — never blocks the actual pipeline work)
// ---------------------------------------------------------------------------
function pipelineJobsClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}
async function startPipelineJob(jobType, traceId) {
  const sb = pipelineJobsClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb.from("pipeline_jobs").insert({
      job_type: jobType,
      status: "running",
      metadata: { trace_id: traceId }
    }).select("id").single();
    if (error) {
      log("warn", "pipeline_job_start_failed_nonblocking", { error: error.message }, traceId);
      return null;
    }
    return data?.id ?? null;
  } catch (e) {
    log("warn", "pipeline_job_start_failed_nonblocking", { error: e?.message ?? String(e) }, traceId);
    return null;
  }
}
async function finishPipelineJob(jobId, patch, traceId) {
  if (!jobId) return;
  const sb = pipelineJobsClient();
  if (!sb) return;
  try {
    await sb.from("pipeline_jobs").update(patch).eq("id", jobId);
  } catch (e) {
    log("warn", "pipeline_job_finish_failed_nonblocking", { error: e?.message ?? String(e) }, traceId);
  }
}
// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,apikey,content-type,x-client-info,x-cron-secret"
  };
}
// ---------------------------------------------------------------------------
// Fetch instrumentation
// ---------------------------------------------------------------------------
function wrapFetch(perf) {
  const originalFetch = globalThis.fetch;
  const projectUrl = (Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  globalThis.fetch = async (input, init)=>{
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const isDb = !!projectUrl && url.startsWith(projectUrl);
    const end = perf.span(isDb ? "db" : "external");
    try {
      const res = await originalFetch(input, init);
      return res;
    } finally{
      end();
    }
  };
  return ()=>{
    globalThis.fetch = originalFetch;
  };
}
// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function chunk(arr, size) {
  const out = [];
  for(let i = 0; i < arr.length; i += size)out.push(arr.slice(i, i + size));
  return out;
}
function pLimit(n) {
  let active = 0;
  const q = [];
  const next = ()=>{
    if (active >= n || !q.length) return;
    active++;
    const f = q.shift();
    f?.();
  };
  return (fn)=>new Promise((res, rej)=>{
      q.push(()=>fn().then(res, rej).finally(()=>{
          active--;
          next();
        }));
      next();
    });
}
function summarize(result) {
  if (!result || typeof result !== "object") return null;
  // v3.1 adds eventClusters/storyClusters/mode for observability
  const keys = [
    "clusters",
    "items",
    "updated",
    "skipped",
    "failed",
    "errors",
    "eventClusters",
    "storyClusters",
    "mode"
  ];
  const out = {};
  for (const k of keys)if (k in result) out[k] = result[k];
  return Object.keys(out).length ? out : null;
}
// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req)=>{
  const origin = req.headers.get("origin") ?? "*";
  const baseHeaders = {
    "content-type": "application/json",
    ...corsHeaders(origin)
  };
  // CORS preflight
  if (req.method.toUpperCase() === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: baseHeaders
    });
  }
  if (req.method.toUpperCase() !== "POST") {
    return new Response(JSON.stringify({
      ok: false,
      error: "Method Not Allowed"
    }), {
      status: 405,
      headers: baseHeaders
    });
  }
  // Cron-secret gate
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (expected) {
    const incoming = req.headers.get("x-cron-secret");
    if (incoming !== expected) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Unauthorized"
      }), {
        status: 401,
        headers: baseHeaders
      });
    }
  }
  // ── Perf setup ────────────────────────────────────────────────────────
  const perf = startPerf();
  const restoreFetch = wrapFetch(perf);
  const { traceId } = perf;
  const BUDGET = Number(Deno.env.get("CLUSTER_BUDGET_MS") ?? 45_000);
  const SAFETY = Number(Deno.env.get("CLUSTER_SAFETY_MS") ?? 1_500);
  const PAR = Number(Deno.env.get("CLUSTER_PARALLEL") ?? 4);
  const limit = pLimit(Math.max(1, PAR));
  log("info", "start", {
    ua: req.headers.get("user-agent"),
    budgetMs: BUDGET,
    parallel: PAR
  }, traceId);
  try {
    const raw = await req.text();
    if (raw) log("info", "request.body", {
      preview: raw.slice(0, 500)
    }, traceId);
  } catch  {
  // ignore
  }
  const pipelineJobId = await startPipelineJob("cluster", traceId);
  // ── Context passed to logic.ts ────────────────────────────────────────────────
  const ctx = {
    func: FUNC,
    traceId,
    perf,
    budgetMs: BUDGET,
    shouldStop: ()=>performance.now() - perf.t0 >= BUDGET - SAFETY,
    limit,
    chunk,
    log: (level, msg, extra)=>log(level, msg, extra ?? {}, traceId)
  };
  // ── Run ──────────────────────────────────────────────────────────────
  try {
    const result = await logicRun(ctx);
    const summary = summarize(result);
    const done = perf.finish(summary ?? {});
    // Emit perf telemetry non-blockingly
    try {
      await emitPerf({
        func: FUNC,
        trace_id: done.traceId,
        duration_ms: done.duration_ms,
        external_ms: done.external_ms,
        db_ms: done.db_ms,
        compute_ms: done.compute_ms,
        items: summary?.items ?? undefined,
        ok: true,
        note: null
      });
    } catch (e) {
      log("warn", "perf_emit_failed_nonblocking", {
        error: e?.message ?? String(e)
      }, traceId);
    }
    await finishPipelineJob(pipelineJobId, {
      status: "success",
      finished_at: new Date().toISOString(),
      duration_ms: done.duration_ms,
      items_processed: summary?.items ?? summary?.clusters ?? 0
    }, traceId);
    log("info", "done", done, traceId);
    return new Response(JSON.stringify({
      ok: true,
      traceId,
      ...done,
      result: summary ?? result
    }), {
      status: 200,
      headers: {
        ...baseHeaders,
        "x-trace-id": traceId
      }
    });
  } catch (err) {
    const message = err?.message ?? String(err);
    const done = perf.finish({
      error: message
    });
    try {
      await emitPerf({
        func: FUNC,
        trace_id: done.traceId,
        duration_ms: done.duration_ms,
        external_ms: done.external_ms,
        db_ms: done.db_ms,
        compute_ms: done.compute_ms,
        ok: false,
        note: message.slice(0, 500)
      });
    } catch (e) {
      log("warn", "perf_emit_failed_nonblocking", {
        error: e?.message ?? String(e)
      }, traceId);
    }
    await finishPipelineJob(pipelineJobId, {
      status: "failed",
      finished_at: new Date().toISOString(),
      duration_ms: done.duration_ms,
      error_message: message.slice(0, 800)
    }, traceId);
    log("error", "exception", {
      ...done,
      error: message,
      stack: err?.stack?.slice(0, 1_500)
    }, traceId);
    return new Response(JSON.stringify({
      ok: false,
      traceId,
      error: message
    }), {
      status: 500,
      headers: {
        ...baseHeaders,
        "x-trace-id": traceId
      }
    });
  } finally{
    restoreFetch();
  }
});
