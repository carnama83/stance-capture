import { startPerf, emitPerf } from "./perf.ts";
const FUNC = "reframe";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function log(level, msg, extra = {}, traceId) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, func: FUNC, traceId, msg, ...extra }));
}
// H-08 (Sep 2026, backported from Prod): the previous gate was
//     const isServiceKey = authHeader.startsWith("Bearer ") && authHeader.length > 20;
// which is authentication-shaped but is NOT an authorization check - it accepts ANY bearer
// longer than 20 characters. With verify_jwt: true the platform guarantees a valid credential
// for this project, but the PUBLIC ANON KEY qualifies and ships inside the frontend bundle, so
// any visitor could trigger a full reframe run: LLM spend plus status/content mutations across
// question_drafts.
//
// The x-cron-secret branch is gone and CRON_SECRET is no longer read here.
//
// PORTABLE CREDENTIAL CHECK - accepts either shape this codebase uses:
//   Path A - exact match against this project's own SUPABASE_SERVICE_ROLE_KEY. UAT's pg_cron
//            sends Vault's modern sb_secret_ key, and UAT has NO JWT-format service key at all
//            (private.get_secret('service_role_key') is NULL here, same as Dev), so a
//            claims-only check would reject UAT's own scheduler.
//   Path B - a service_role JWT (Prod's pg_cron sends a legacy JWT from private.get_secret).
// Verified live: a bare `Authorization: Bearer <sb_secret_...>` with no apikey header returns
// 200 from a verify_jwt:true function, so the platform accepts both shapes.
//
// Do NOT set verify_jwt to false: unsigned claims are forgeable and Path B would become a hole.
// Fails CLOSED on anything else.
function isServiceRoleCaller(req) {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return false;
  const token = m[1];
  const envKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (envKey && token === envKey) return true;
  try {
    const seg = token.split(".")[1];
    if (!seg) return false;
    const norm = seg.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(norm + "=".repeat((4 - norm.length % 4) % 4)));
    if (claims?.role !== "service_role") return false;
    const expectedRef = (Deno.env.get("SUPABASE_URL") ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
    if (expectedRef && claims?.ref && claims.ref !== expectedRef) return false;
    return true;
  } catch  {
    return false;
  }
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
      q.push(()=>fn().then(res, rej).finally(()=>{ active--; next(); }));
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
    try { return await originalFetch(input, init); } finally{ end(); }
  };
}
Deno.serve(async (req)=>{
  if (req.method.toUpperCase() === "OPTIONS") { return new Response("ok", { status: 200, headers: CORS_HEADERS }); }
  if (req.method.toUpperCase() !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), { status: 405, headers: { ...CORS_HEADERS, "content-type": "application/json" } });
  }
  if (!isServiceRoleCaller(req)) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { ...CORS_HEADERS, "content-type": "application/json" } });
  }
  const perf = startPerf();
  wrapFetch(perf);
  const traceId = perf.traceId;
  log("info", "start", { ua: req.headers.get("user-agent"), source: "service_role" }, traceId);
  const BUDGET = Number(Deno.env.get("GEN_BUDGET_MS") ?? 25000);
  const PAR = Number(Deno.env.get("REFRAME_PARALLEL") ?? 3);
  const limit = pLimit(PAR);
  const ctx = {
    func: FUNC, traceId, perf, budgetMs: BUDGET, parallel: PAR,
    shouldStop: ()=>{
      const external = perf.spans.external ?? 0;
      const elapsed = performance.now() - perf.t0;
      return elapsed - external > BUDGET;
    },
    limit,
    log: (level, msg, extra)=>log(level, msg, { ...extra }, traceId)
  };
  try {
    try {
      const raw = await req.text();
      if (raw) log("info", "request.body", { preview: raw.slice(0, 500) }, traceId);
    } catch  {}
    const mod = await import("./logic.ts");
    const result = typeof mod.run === "function" ? await mod.run(ctx) : { reframed: 0, failed: 0, skipped: 0 };
    const summary = summarize(result);
    const done = perf.finish(summary ?? {});
    await emitPerf({
      func: FUNC, trace_id: done.traceId, duration_ms: done.duration_ms, external_ms: done.external_ms,
      db_ms: done.db_ms, compute_ms: done.compute_ms, items: summary?.reframed ?? undefined, ok: true, note: null
    });
    log("info", "done", done, traceId);
    return new Response(JSON.stringify({ ok: true, traceId, ...done, result: summary ?? result }), {
      status: 200, headers: { ...CORS_HEADERS, "content-type": "application/json", "x-trace-id": traceId }
    });
  } catch (err) {
    const done = perf.finish({ error: err.message });
    await emitPerf({
      func: FUNC, trace_id: done.traceId, duration_ms: done.duration_ms, external_ms: done.external_ms,
      db_ms: done.db_ms, compute_ms: done.compute_ms, ok: false, note: err.message
    });
    log("error", "exception", { ...done, stack: err.stack?.slice(0, 1500) }, traceId);
    return new Response(JSON.stringify({ ok: false, traceId, error: err.message }), {
      status: 500, headers: { ...CORS_HEADERS, "content-type": "application/json", "x-trace-id": traceId }
    });
  }
});
function summarize(result) {
  if (!result || typeof result !== "object") return null;
  const keys = ["reframed", "failed", "skipped", "errors"];
  const out = {};
  for (const k of keys)if (k in result) out[k] = result[k];
  return Object.keys(out).length ? out : null;
}
