// supabase/functions/embed/index.ts
// v2.0 — Entry point for the embed Edge Function.
//
// Handles: CORS, cron-secret auth, request lifecycle, perf telemetry.
// Delegates all business logic to logic.ts.
import { startPerf, emitPerf } from "./perf.ts";
import { run as logicRun } from "./logic.ts";
const FUNC = "embed";
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
// Wraps globalThis.fetch to classify calls as "db" or "external" for perf.
// Returns a restore() fn — always call it in finally to prevent leaks.
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
// Utilities (kept self-contained so index.ts has no extra imports)
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
    q.shift()?.();
  };
  return (fn)=>new Promise((res, rej)=>{
      q.push(()=>fn().then(res, rej).finally(()=>{
          active--;
          next();
        }));
      next();
    });
}
// Extracts the subset of result fields that go into the response body / perf note.
function summarize(result) {
  if (!result || typeof result !== "object") return null;
  const keys = [
    "embedded",
    "attempted",
    "updated",
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
  // Auth gate — accepts either:
  //   1. A valid x-cron-secret header (for pg_cron / scheduled calls), OR
  //   2. A valid Supabase JWT in the Authorization header (for admin UI calls via supabase.functions.invoke())
  //
  // This lets the same function be triggered both by the scheduler and by the admin dashboard
  // without needing a separate RPC wrapper or exposing the cron secret to the browser.
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? "";
  if (cronSecret || supabaseUrl) {
    const cronHeader = req.headers.get("x-cron-secret") ?? "";
    const authHeader = req.headers.get("authorization") ?? "";
    // Path 1: cron secret matches
    const cronOk = cronSecret && cronHeader === cronSecret;
    // Path 2: Authorization header carries a known Supabase key (service-role or anon)
    // supabase.functions.invoke() sends: "Bearer <user-jwt>" for logged-in users,
    // or the service-role key directly when called server-side.
    // We verify by checking the JWT against the Supabase auth API.
    let jwtOk = false;
    if (!cronOk && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      // Accept service-role key directly (server-side callers)
      if (serviceRoleKey && token === serviceRoleKey) {
        jwtOk = true;
      } else if (anonKey && token === anonKey) {
        // Anon key alone isn't sufficient for an admin function — require service-role
        jwtOk = false;
      } else if (supabaseUrl && (serviceRoleKey || anonKey)) {
        // Verify JWT via Supabase auth — this covers logged-in admin users
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
            // Accept any authenticated user — RLS on DB tables handles row-level access.
            // If you want to restrict to admins only, check user.role or user.email here.
            jwtOk = !!user?.id;
          }
        } catch  {
          // JWT verification network failure — fail closed
          jwtOk = false;
        }
      }
    }
    if (!cronOk && !jwtOk) {
      log("warn", "auth_rejected", {
        hasCronHeader: !!cronHeader,
        hasAuthHeader: !!authHeader,
        cronSecretSet: !!cronSecret
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
  // ── Perf setup ─────────────────────────────────────────────────────────────
  const perf = startPerf();
  const restoreFetch = wrapFetch(perf);
  const { traceId } = perf;
  const BUDGET = Number(Deno.env.get("EMBED_BUDGET_MS") ?? 45_000);
  const SAFETY = Number(Deno.env.get("EMBED_SAFETY_MS") ?? 1_500);
  const PAR = Number(Deno.env.get("EMBED_PARALLEL") ?? 4);
  const limit = pLimit(Math.max(1, PAR));
  log("info", "start", {
    ua: req.headers.get("user-agent"),
    budgetMs: BUDGET,
    parallel: PAR
  }, traceId);
  // Log request body for debugging (non-fatal if missing / unreadable)
  try {
    const raw = await req.text();
    if (raw) log("info", "request.body", {
      preview: raw.slice(0, 500)
    }, traceId);
  } catch  {
  // ignore
  }
  // ── Context passed to logic.ts ─────────────────────────────────────────────
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
  // ── Run ────────────────────────────────────────────────────────────────────
  try {
    const result = await logicRun(ctx);
    const summary = summarize(result);
    const done = perf.finish(summary ?? {});
    // Emit perf telemetry non-blockingly — a failure here must never 500 the function
    try {
      await emitPerf({
        func: FUNC,
        trace_id: done.traceId,
        duration_ms: done.duration_ms,
        external_ms: done.external_ms,
        db_ms: done.db_ms,
        compute_ms: done.compute_ms,
        items: summary?.embedded ?? undefined,
        ok: true,
        note: null
      });
    } catch (e) {
      log("warn", "perf_emit_failed_nonblocking", {
        error: e?.message ?? String(e)
      }, traceId);
    }
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
    // Always restore fetch — even on uncaught exceptions — to prevent leaks
    restoreFetch();
  }
});
