// supabase/functions/create-topic-drafts/index.ts
import { startPerf, emitPerf } from "./perf.ts";
import { run as logicRun } from "./logic.ts";
const FUNC = "create-topic-drafts";
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
function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,apikey,content-type,x-client-info,x-cron-secret"
  };
}
function wrapFetch(perf) {
  const originalFetch = globalThis.fetch;
  const projectUrl = (Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  globalThis.fetch = async (input, init)=>{
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const isDb = projectUrl && url.startsWith(projectUrl);
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
  const keys = [
    "drafts_created",
    "skipped",
    "failed",
    "errors"
  ];
  const out = {};
  for (const k of keys)if (k in result) out[k] = result[k];
  return Object.keys(out).length ? out : null;
}
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
  const expected = Deno.env.get("CRON_SECRET") || "";
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
  const perf = startPerf();
  const restoreFetch = wrapFetch(perf);
  const traceId = perf.traceId;
  const BUDGET = Number(Deno.env.get("CREATE_DRAFTS_BUDGET_MS") ?? 25_000);
  const SAFETY = Number(Deno.env.get("CREATE_DRAFTS_SAFETY_MS") ?? 1_500);
  const PAR = Number(Deno.env.get("CREATE_DRAFTS_PARALLEL") ?? 4);
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
        items: summary?.drafts_created ?? undefined,
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
        note: message
      });
    } catch (e) {
      log("warn", "perf_emit_failed_nonblocking", {
        error: e?.message ?? String(e)
      }, traceId);
    }
    log("error", "exception", {
      ...done,
      error: message,
      stack: err?.stack?.slice(0, 1500)
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
