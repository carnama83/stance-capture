// supabase/functions/ingest/index.ts
// ingest — secure, observable, timeboxed
import { startPerf, emitPerf } from "./perf.ts";
const FUNC = "ingest";
/* ───────────────────── CORS HELPERS ───────────────────── */ const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:8080",
  Deno.env.get("PUBLIC_SITE_URL") ?? "",
  Deno.env.get("NEXT_PUBLIC_SITE_URL") ?? ""
].filter(Boolean);
function buildCorsHeaders(origin) {
  const allowAny = Deno.env.get("CORS_ALLOW_ANY") === "true";
  const allowed = allowAny ? "*" : DEFAULT_ALLOWED_ORIGINS;
  const allowOrigin = allowAny ? "*" : origin && allowed.includes(origin) ? origin : allowed[0] ?? "*";
  return new Headers({
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-cron-secret",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json"
  });
}
function withCors(res, origin) {
  const h = buildCorsHeaders(origin);
  res.headers.forEach((v, k)=>h.set(k, v));
  return new Response(res.body, {
    status: res.status,
    headers: h
  });
}
/* ─────────────────── END CORS HELPERS ─────────────────── */ function log(level, msg, extra = {}, traceId) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    func: FUNC,
    traceId,
    msg,
    ...extra
  }));
}
// Minimal p-limit
function pLimit(n) {
  let active = 0;
  const q = [];
  const next = ()=>{
    if (active >= n || q.length === 0) return;
    active++;
    const run = q.shift();
    run();
  };
  return (fn)=>new Promise((resolve, reject)=>{
      q.push(()=>fn().then(resolve, reject).finally(()=>{
          active--;
          next();
        }));
      next();
    });
}
// Chunk helper
function chunk(arr, size) {
  const out = [];
  for(let i = 0; i < arr.length; i += size)out.push(arr.slice(i, i + size));
  return out;
}
// Wrap global fetch to record external vs db time
function wrapFetch(perf) {
  const originalFetch = globalThis.fetch;
  const projectUrl = (Deno.env.get("PROJECT_URL") || Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  globalThis.fetch = async (input, init)=>{
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const isDb = projectUrl && url.startsWith(projectUrl);
    const end = perf.span(isDb ? "db" : "external");
    try {
      return await originalFetch(input, init);
    } finally{
      end();
    }
  };
}
// If you have your own implementation, export it from ./logic.ts as `run(ctx)`
async function logicRun(ctx) {
  // Stub — replace or keep calling into your existing logic.ts
  // if (ctx.shouldStop()) return { processed: 0, skipped: 0, note: "budget_exhausted" };
  return {
    fetched: 0,
    inserted: 0,
    skipped: 0
  };
}
// Admin gate — allow either cron secret OR user JWT with is_admin_me = true
async function authorize(req) {
  const incoming = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET") || "";
  // Path A: Cron secret
  if (expected && incoming === expected) return {
    ok: true
  };
  // Path B: User JWT + is_admin_me()
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return {
    ok: false,
    status: 401,
    error: "unauthorized"
  };
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.2");
  const supabase = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`
      }
    }
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return {
    ok: false,
    status: 401,
    error: "unauthorized"
  };
  const { data: isAdmin, error: adminErr } = await supabase.rpc("is_admin_me");
  if (adminErr || !isAdmin) return {
    ok: false,
    status: 403,
    error: "forbidden"
  };
  return {
    ok: true
  };
}
Deno.serve(async (req)=>{
  const origin = req.headers.get("origin");
  // CORS preflight
  if (req.method === "OPTIONS") {
    return withCors(new Response(null, {
      status: 204
    }), origin);
  }
  if (req.method.toUpperCase() !== "POST") {
    return withCors(new Response(JSON.stringify({
      ok: false,
      error: "Method Not Allowed"
    }), {
      status: 405
    }), origin);
  }
  const perf = startPerf();
  wrapFetch(perf);
  const traceId = perf.traceId;
  // 🔐 Auth
  const auth = await authorize(req);
  if (!("ok" in auth) || auth.ok !== true) {
    log("warn", "auth_failed", auth, traceId);
    return withCors(new Response(JSON.stringify({
      ok: false,
      error: auth.error
    }), {
      status: auth.status
    }), origin);
  }
  // Env check (kept)
  log("info", "env_check", {
    hasProjectUrl: !!Deno.env.get("PROJECT_URL"),
    hasSupabaseUrl: !!Deno.env.get("SUPABASE_URL"),
    hasServiceRoleKey: !!Deno.env.get("SERVICE_ROLE_KEY"),
    hasSbServiceRoleKey: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    budgetMs: Number(Deno.env.get("INGEST_BUDGET_MS") ?? 2000),
    concurrency: Number(Deno.env.get("INGEST_CONCURRENCY") ?? 4)
  }, traceId);
  log("info", "start", {
    ua: req.headers.get("user-agent")
  }, traceId);
  try {
    // Read body (accept { source_id })
    let source_id = null;
    try {
      const raw = await req.text();
      if (raw) {
        log("info", "request.body", {
          preview: raw.slice(0, 500)
        }, traceId);
        const parsed = JSON.parse(raw);
        source_id = typeof parsed?.source_id === "string" ? parsed.source_id : null;
      }
    } catch  {}
    // Build ctx
    const startedAt = perf.t0;
    const nowISO = new Date().toISOString();
    const CONC = Number(Deno.env.get("INGEST_CONCURRENCY") ?? 4);
    const BUDGET = Number(Deno.env.get("INGEST_BUDGET_MS") ?? 2000);
    const limit = pLimit(CONC);
    const ctx = {
      func: FUNC,
      traceId,
      startedAt,
      nowISO,
      perf,
      budgetMs: BUDGET,
      shouldStop: ()=>{
        const external = perf.spans?.external ?? 0;
        const elapsed = performance.now() - perf.t0;
        return elapsed - external > BUDGET;
      },
      limit,
      chunk,
      log: (level, msg, extra)=>log(level, msg, {
          ...extra
        }, traceId),
      source_id
    };
    // Run your actual ingest logic
    let result;
    try {
      const mod = await import("./logic.ts");
      result = typeof mod.run === "function" ? await mod.run(ctx) : await logicRun(ctx);
    } catch  {
      result = await logicRun(ctx);
    }
    const summary = summarize(result);
    const done = perf.finish(summary ?? {});
    await emitPerf({
      func: FUNC,
      trace_id: done.traceId,
      duration_ms: done.duration_ms,
      external_ms: done.external_ms,
      db_ms: done.db_ms,
      compute_ms: done.compute_ms,
      items: summary?.processed ?? summary?.inserted ?? undefined,
      ok: true,
      note: null
    });
    log("info", "done", done, traceId);
    return withCors(new Response(JSON.stringify({
      ok: true,
      traceId,
      status: 200,
      ...done,
      result: summary ?? result
    }), {
      status: 200,
      headers: {
        "x-trace-id": traceId
      }
    }), origin);
  } catch (err) {
    const done = perf.finish({
      error: err?.message
    });
    await emitPerf({
      func: FUNC,
      trace_id: done.traceId,
      duration_ms: done.duration_ms,
      external_ms: done.external_ms,
      db_ms: done.db_ms,
      compute_ms: done.compute_ms,
      ok: false,
      note: err?.message
    });
    log("error", "exception", {
      ...done,
      stack: (err?.stack || "").slice(0, 1500)
    }, traceId);
    return withCors(new Response(JSON.stringify({
      ok: false,
      traceId: done.traceId,
      error: err?.message
    }), {
      status: 500,
      headers: {
        "x-trace-id": done.traceId
      }
    }), origin);
  }
});
function summarize(result) {
  if (!result || typeof result !== "object") return null;
  const keys = [
    "fetched",
    "inserted",
    "processed",
    "deduped",
    "skipped",
    "failed",
    "errors"
  ];
  const out = {};
  for (const k of keys)if (k in result) out[k] = result[k];
  return Object.keys(out).length ? out : null;
}
