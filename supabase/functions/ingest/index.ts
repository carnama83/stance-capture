// ingest/index.ts — secure, observable, timeboxed
import { startPerf, emitPerf, Perf } from "./perf.ts";

/** ─────────────────────────────────────────────────────────
 *  Env knobs (set as function secrets)
 *    CRON_SECRET           required (auth)
 *    PROJECT_URL           for emitPerf (optional but recommended)
 *    SERVICE_ROLE_KEY      for emitPerf (optional but recommended)
 *    INGEST_CONCURRENCY    default 4
 *    INGEST_BUDGET_MS      default 2000  (compute + db; external excluded)
 *  ───────────────────────────────────────────────────────── */

type LogLevel = "info" | "warn" | "error";
const FUNC = "ingest" as const;

function log(level: LogLevel, msg: string, extra: Record<string, unknown> = {}, traceId?: string) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, func: FUNC, traceId, msg, ...extra }));
}

// Minimal p-limit
function pLimit(n: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= n || queue.length === 0) return;
    active++;
    const run = queue.shift()!;
    run();
  };
  return <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => fn().then(resolve, reject).finally(() => { active--; next(); }));
      next();
    });
}

// Helpers
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Wrap global fetch to auto-count external vs DB time
function wrapFetch(perf: Perf) {
  const originalFetch = globalThis.fetch;
  const projectUrl = Deno.env.get("PROJECT_URL")?.replace(/\/+$/, "") ?? "";
  globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
    let url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const isDb = projectUrl && url.startsWith(projectUrl);
    const end = perf.span(isDb ? "db" : "external");
    try {
      return await originalFetch(input as any, init);
    } finally {
      end();
    }
  }) as typeof fetch;
}

type Ctx = {
  func: "ingest";
  traceId: string;
  startedAt: number;
  nowISO: string;
  perf: Perf;
  budgetMs: number;
  // Timebox predicate: true if (now - t0 - external_ms) > budget
  shouldStop: () => boolean;
  // Concurrency limiter helper
  limit: <T>(task: () => Promise<T>) => Promise<T>;
  // Utilities
  chunk: typeof chunk;
  log: (level: LogLevel, msg: string, extra?: Record<string, unknown>) => void;
};

// If you already have implementation, import it here:
async function logicRun(ctx: Ctx): Promise<Record<string, unknown>> {
  // ⬇️ Replace this stub with `const mod = await import("./logic.ts"); return mod.run(ctx);`
  // or paste your previous ingest code here and use ctx.perf.span('db'|'compute') as needed.
  return { fetched: 0, inserted: 0, skipped: 0 };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method.toUpperCase() !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method Not Allowed" }), { status: 405, headers: { "content-type": "application/json" } });
  }

  const incoming = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET") || "";
  if (!expected || incoming !== expected) {
    log("warn", "unauthorized", { hasExpected: Boolean(expected) });
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  }

  const perf = startPerf();
  wrapFetch(perf);

  const traceId = perf.traceId;
  const startedAt = perf.t0;
  const nowISO = new Date().toISOString();

  const CONC = Number(Deno.env.get("INGEST_CONCURRENCY") ?? 4);
  const BUDGET = Number(Deno.env.get("INGEST_BUDGET_MS") ?? 2000);
  const limit = pLimit(CONC);

  const ctx: Ctx = {
    func: FUNC,
    traceId,
    startedAt,
    nowISO,
    perf,
    budgetMs: BUDGET,
    shouldStop: () => {
      const external = perf.spans.external ?? 0;
      const elapsed = performance.now() - perf.t0;
      return (elapsed - external) > BUDGET;
    },
    limit,
    chunk,
    log: (level, msg, extra) => log(level, msg, { ...extra }, traceId),
  };

  log("info", "start", { ua: req.headers.get("user-agent") }, traceId);

  try {
    // Optional read body for overrides
    try {
      const raw = await req.text();
      if (raw) log("info", "request.body", { preview: raw.slice(0, 500) }, traceId);
    } catch {}

    // 🔧 Call your actual logic (instrument with ctx.perf.span)
    let result: any;
    try {
      const mod = await import("./logic.ts");
      result = typeof mod.run === "function" ? await mod.run(ctx) : await logicRun(ctx);
    } catch {
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
      items: (summary?.processed as number) ?? (summary?.inserted as number) ?? undefined,
      ok: true,
      note: null,
    });

    log("info", "done", done, traceId);

    return new Response(JSON.stringify({ ok: true, traceId, ...done, result: summary ?? result }), {
      status: 200,
      headers: { "content-type": "application/json", "x-trace-id": traceId },
    });
  } catch (err) {
    const done = perf.finish({ error: (err as Error).message });
    await emitPerf({
      func: FUNC,
      trace_id: done.traceId,
      duration_ms: done.duration_ms,
      external_ms: done.external_ms,
      db_ms: done.db_ms,
      compute_ms: done.compute_ms,
      ok: false,
      note: (err as Error).message,
    });
    log("error", "exception", { ...done, stack: (err as Error).stack?.slice(0, 1500) }, traceId);
    return new Response(JSON.stringify({ ok: false, traceId, error: (err as Error).message }), {
      status: 500,
      headers: { "content-type": "application/json", "x-trace-id": traceId },
    });
  }
});

function summarize(result: any): Record<string, unknown> | null {
  if (!result || typeof result !== "object") return null;
  const keys = ["fetched", "inserted", "processed", "deduped", "skipped", "failed", "errors"];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in result) out[k] = result[k];
  return Object.keys(out).length ? out : null;
}
