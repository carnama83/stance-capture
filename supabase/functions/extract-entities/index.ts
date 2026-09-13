// supabase/functions/extract-entities/index.ts
// v1.1 — pipeline_jobs logging added (reconciled Sep 2026).
//
// Auth: mirrors embed/index.ts — accepts cron secret OR valid Supabase JWT.
// Handles: CORS, auth, request lifecycle, perf telemetry.
// Delegates all business logic to logic.ts.
import { startPerf, emitPerf } from "./perf.ts";
import { run as logicRun } from "./logic.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";
const FUNC = "extract-entities";
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
      return await originalFetch(input, init);
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
function summarize(result) {
  if (!result || typeof result !== "object") return null;
  const keys = [
    "extracted",
    "attempted",
    "skipped",
    "failed",
    "errors"
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
  // Auth gate — mirrors embed/index.ts exactly:
  // accepts cron secret OR valid Supabase JWT (admin UI calls)
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? "";
  if (cronSecret || supabaseUrl) {
    const cronHeader = req.headers.get("x-cron-secret") ?? "";
    const authHeader = req.headers.get("authorization") ?? "";
    const cronOk = cronSecret && cronHeader === cronSecret;
    let jwtOk = false;
    if (!cronOk && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      if (serviceRoleKey && token === serviceRoleKey) {
        jwtOk = true;
      } else if (supabaseUrl && (serviceRoleKey || anonKey)) {
        try {
          const verifyKey = serviceRoleKey || anonKey;
          const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
            headers: {
              authorization: `Bearer ${token}`,
              apikey: verifyKey
            }
          });
          if (resp.ok) {
            const user = await resp.json();
            jwtOk = !!user?.id;
          }
        } catch  {
          jwtOk = false;
        }
      }
    }
    if (!cronOk && !jwtOk) {
      log("warn", "auth_rejected", {
        hasCronHeader: !!cronHeader,
        hasAuthHeader: !!authHeader
      });
      return new Response(JSON.stringify({
        ok: false,
        error: "Unauthorized"
      }), {
        status: 401,
        headers: baseHeaders
      });
    }
    log("info", "auth_ok", {
      method: cronOk ? "cron_secret" : "jwt"
    });
  }
  // ── Perf setup ────────────────────────────────────────────────────────
  const perf = startPerf();
  const restoreFetch = wrapFetch(perf);
  const { traceId } = perf;
  const BUDGET = Number(Deno.env.get("ENTITY_BUDGET_MS") ?? 45_000);
  const SAFETY = Number(Deno.env.get("ENTITY_SAFETY_MS") ?? 1_500);
  log("info", "start", {
    ua: req.headers.get("user-agent"),
    budgetMs: BUDGET
  }, traceId);
  const pipelineJobId = await startPipelineJob("extract_entities", traceId);
  const ctx = {
    func: FUNC,
    traceId,
    perf,
    budgetMs: BUDGET,
    shouldStop: ()=>performance.now() - perf.t0 >= BUDGET - SAFETY,
    log: (level, msg, extra)=>log(level, msg, extra ?? {}, traceId)
  };
  try {
    const result = await logicRun(ctx);
    const summary = summarize(result);
    const done = perf.finish(summary ?? {});
    try {
      await emitPerf({
        func: FUNC,
        trace_id: done.traceId,
        duration_ms: done.duration_ms,
        external_ms: done.external_ms,
        db_ms: done.db_ms,
        compute_ms: done.compute_ms,
        items: summary?.extracted ?? undefined,
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
      items_processed: summary?.extracted ?? 0
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
