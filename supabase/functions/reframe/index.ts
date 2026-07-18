import { startPerf, emitPerf } from "./perf.ts";
const FUNC = "reframe";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
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
function pLimit(n) {
  let active = 0;
  const q = [];
  const next = ()=>{
    if (active >= n || !q.length) return;
    active++;
    const f = q.shift();
    f();
  };
  return (fn)=>new Promise((res, rej)=>{
      q.push(()=>fn().then(res, rej).finally(()=>{
          active--;
          next();
        }));
      next();
    });
}
function wrapFetch(perf) {
  const originalFetch = globalThis.fetch;
  const projectUrl = Deno.env.get("PROJECT_URL")?.replace(/\/+$/, "") ?? "";
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
Deno.serve(async (req)=>{
  // ✅ CORS preflight — must be first, before any auth check
  if (req.method.toUpperCase() === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: CORS_HEADERS
    });
  }
  if (req.method.toUpperCase() !== "POST") {
    return new Response(JSON.stringify({
      ok: false,
      error: "Method Not Allowed"
    }), {
      status: 405,
      headers: {
        ...CORS_HEADERS,
        "content-type": "application/json"
      }
    });
  }
  // ✅ Auth: accept either CRON_SECRET (scheduled) or valid Supabase JWT (admin browser call)
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const incomingCron = req.headers.get("x-cron-secret") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const isServiceKey = authHeader.startsWith("Bearer ") && authHeader.length > 20;
  const isCron = cronSecret && incomingCron === cronSecret;
  if (!isCron && !isServiceKey) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Unauthorized"
    }), {
      status: 401,
      headers: {
        ...CORS_HEADERS,
        "content-type": "application/json"
      }
    });
  }
  const perf = startPerf();
  wrapFetch(perf);
  const traceId = perf.traceId;
  log("info", "start", {
    ua: req.headers.get("user-agent"),
    source: isCron ? "cron" : "admin"
  }, traceId);
  const BUDGET = Number(Deno.env.get("GEN_BUDGET_MS") ?? 25000);
  const PAR = Number(Deno.env.get("REFRAME_PARALLEL") ?? 3);
  const limit = pLimit(PAR);
  const ctx = {
    func: FUNC,
    traceId,
    perf,
    budgetMs: BUDGET,
    parallel: PAR,
    shouldStop: ()=>{
      const external = perf.spans.external ?? 0;
      const elapsed = performance.now() - perf.t0;
      return elapsed - external > BUDGET;
    },
    limit,
    log: (level, msg, extra)=>log(level, msg, {
        ...extra
      }, traceId)
  };
  try {
    try {
      const raw = await req.text();
      if (raw) log("info", "request.body", {
        preview: raw.slice(0, 500)
      }, traceId);
    } catch  {}
    const mod = await import("./logic.ts");
    const result = typeof mod.run === "function" ? await mod.run(ctx) : {
      reframed: 0,
      failed: 0,
      skipped: 0
    };
    const summary = summarize(result);
    const done = perf.finish(summary ?? {});
    await emitPerf({
      func: FUNC,
      trace_id: done.traceId,
      duration_ms: done.duration_ms,
      external_ms: done.external_ms,
      db_ms: done.db_ms,
      compute_ms: done.compute_ms,
      items: summary?.reframed ?? undefined,
      ok: true,
      note: null
    });
    log("info", "done", done, traceId);
    return new Response(JSON.stringify({
      ok: true,
      traceId,
      ...done,
      result: summary ?? result
    }), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "content-type": "application/json",
        "x-trace-id": traceId
      }
    });
  } catch (err) {
    const done = perf.finish({
      error: err.message
    });
    await emitPerf({
      func: FUNC,
      trace_id: done.traceId,
      duration_ms: done.duration_ms,
      external_ms: done.external_ms,
      db_ms: done.db_ms,
      compute_ms: done.compute_ms,
      ok: false,
      note: err.message
    });
    log("error", "exception", {
      ...done,
      stack: err.stack?.slice(0, 1500)
    }, traceId);
    return new Response(JSON.stringify({
      ok: false,
      traceId,
      error: err.message
    }), {
      status: 500,
      headers: {
        ...CORS_HEADERS,
        "content-type": "application/json",
        "x-trace-id": traceId
      }
    });
  }
});
function summarize(result) {
  if (!result || typeof result !== "object") return null;
  const keys = [
    "reframed",
    "failed",
    "skipped",
    "errors"
  ];
  const out = {};
  for (const k of keys)if (k in result) out[k] = result[k];
  return Object.keys(out).length ? out : null;
}
