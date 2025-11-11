import { startPerf, emitPerf, Perf } from "./perf.ts";

type LogLevel = "info" | "warn" | "error";
const FUNC = "generate" as const;

function log(level: LogLevel, msg: string, extra: Record<string, unknown> = {}, traceId?: string) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, func: FUNC, traceId, msg, ...extra }));
}

function pLimit(n: number) {
  let active = 0; const q: Array<() => void> = [];
  const next=()=>{ if(active>=n||!q.length) return; active++; const f=q.shift()!; f(); };
  return <T>(fn:()=>Promise<T>)=> new Promise<T>((res,rej)=>{ q.push(()=>fn().then(res,rej).finally(()=>{active--;next();})); next();});
}

function wrapFetch(perf: Perf) {
  const originalFetch = globalThis.fetch;
  const projectUrl = Deno.env.get("PROJECT_URL")?.replace(/\/+$/, "") ?? "";
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    let url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const isDb = projectUrl && url.startsWith(projectUrl);
    const end = perf.span(isDb ? "db" : "external");
    try { return await originalFetch(input as any, init); } finally { end(); }
  }) as typeof fetch;
}

type Ctx = {
  func: "generate";
  traceId: string;
  perf: Perf;
  budgetMs: number;
  parallel: number; // how many drafts at once
  shouldStop: () => boolean;
  limit: <T>(task: () => Promise<T>) => Promise<T>;
  log: (level: LogLevel, msg: string, extra?: Record<string, unknown>) => void;
};

// Replace with your generation implementation if present
async function logicRun(ctx: Ctx): Promise<Record<string, unknown>> {
  // Example: iterate drafts with ctx.limit(async () => { ... })
  return { drafts_created: 0, drafts_updated: 0, skipped: 0 };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method.toUpperCase() !== "POST")
    return new Response(JSON.stringify({ ok:false, error:"Method Not Allowed"}), { status:405, headers:{ "content-type":"application/json" } });

  const incoming = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET") || "";
  if (!expected || incoming !== expected)
    return new Response(JSON.stringify({ ok:false, error:"Unauthorized"}), { status:401, headers:{ "content-type":"application/json" } });

  const perf = startPerf();
  wrapFetch(perf);

  const traceId = perf.traceId;
  log("info","start",{ ua: req.headers.get("user-agent") }, traceId);

  const BUDGET = Number(Deno.env.get("GEN_BUDGET_MS") ?? 2000);
  const PAR = Number(Deno.env.get("GEN_PARALLEL") ?? 3);
  const limit = pLimit(PAR);

  const ctx: Ctx = {
    func: FUNC,
    traceId,
    perf,
    budgetMs: BUDGET,
    parallel: PAR,
    shouldStop: () => {
      const external = perf.spans.external ?? 0;
      const elapsed = performance.now() - perf.t0;
      return (elapsed - external) > BUDGET;
    },
    limit,
    log: (level, msg, extra) => log(level, msg, { ...extra }, traceId),
  };

  try {
    try { const raw = await req.text(); if (raw) log("info","request.body",{preview: raw.slice(0,500)}, traceId);} catch {}

    let result: any;
    try {
      const mod = await import("./logic.ts");
      result = typeof mod.run === "function" ? await mod.run(ctx) : await logicRun(ctx);
    } catch { result = await logicRun(ctx); }

    const summary = summarize(result);
    const done = perf.finish(summary ?? {});
    await emitPerf({
      func: FUNC,
      trace_id: done.traceId,
      duration_ms: done.duration_ms,
      external_ms: done.external_ms,
      db_ms: done.db_ms,
      compute_ms: done.compute_ms,
      items: (summary?.drafts_created as number) ?? (summary?.drafts_updated as number) ?? undefined,
      ok: true,
      note: null,
    });
    log("info","done", done, traceId);

    return new Response(JSON.stringify({ ok:true, traceId, ...done, result: summary ?? result }), {
      status: 200, headers: { "content-type":"application/json", "x-trace-id": traceId }
    });
  } catch (err) {
    const done = perf.finish({ error: (err as Error).message });
    await emitPerf({
      func: FUNC, trace_id: done.traceId, duration_ms: done.duration_ms,
      external_ms: done.external_ms, db_ms: done.db_ms, compute_ms: done.compute_ms,
      ok: false, note: (err as Error).message
    });
    log("error","exception",{ ...done, stack:(err as Error).stack?.slice(0,1500)}, traceId);
    return new Response(JSON.stringify({ ok:false, traceId, error:(err as Error).message }), {
      status: 500, headers: { "content-type":"application/json", "x-trace-id": traceId }
    });
  }
});

function summarize(result: any): Record<string, unknown> | null {
  if (!result || typeof result !== "object") return null;
  const keys = ["drafts_created","drafts_updated","skipped","failed","errors"];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in result) out[k] = result[k];
  return Object.keys(out).length ? out : null;
}
