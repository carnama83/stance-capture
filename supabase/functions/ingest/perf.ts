// perf.ts — perf spans + DB emitter (Edge Functions / Deno)
export type Perf = {
  traceId: string;
  t0: number;
  spans: Record<string, number>;
  incr(name: "external" | "db" | "compute", ms: number): void;
  span(name: "external" | "db" | "compute"): () => void; // returns end() to record elapsed
  finish(meta?: Record<string, unknown>): {
    traceId: string;
    duration_ms: number;
    external_ms?: number;
    db_ms?: number;
    compute_ms?: number;
  } & Record<string, unknown>;
};

export function startPerf(): Perf {
  const t0 = performance.now();
  const spans: Record<string, number> = {};
  const traceId = crypto.randomUUID();

  const incr = (name: "external" | "db" | "compute", ms: number) => {
    spans[name] = (spans[name] || 0) + ms;
  };

  const span = (name: "external" | "db" | "compute") => {
    const s0 = performance.now();
    return () => incr(name, performance.now() - s0);
  };

  const finish = (meta: Record<string, unknown> = {}) => ({
    traceId,
    duration_ms: Math.round(performance.now() - t0),
    external_ms: spans.external !== undefined ? Math.round(spans.external) : undefined,
    db_ms: spans.db !== undefined ? Math.round(spans.db) : undefined,
    compute_ms: spans.compute !== undefined ? Math.round(spans.compute) : undefined,
    ...meta,
  });

  return { traceId, t0, spans, incr, span, finish };
}

// Emit one perf row via PostgREST (best-effort).
// Requires URL + service role key in env. We support both custom and built-in names.
export async function emitPerf(row: {
  func: string;
  trace_id: string;
  duration_ms: number;
  items?: number;
  external_ms?: number;
  db_ms?: number;
  compute_ms?: number;
  ok?: boolean;
  note?: string | null;
}) {
  const url = Deno.env.get("PROJECT_URL") || Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    // helpful skip log
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      func: row.func,
      traceId: row.trace_id,
      msg: "perf_emit_skip_env",
      hasUrl: Boolean(url),
      hasKey: Boolean(key),
    }));
    return;
  }

  //const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/admin.fn_perf`;
  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/admin_fn_perf`;
  
  const payload = [{
    func: row.func,
    trace_id: row.trace_id,
    duration_ms: row.duration_ms,
    items: row.items ?? null,
    external_ms: row.external_ms ?? null,
    db_ms: row.db_ms ?? null,
    compute_ms: row.compute_ms ?? null,
    ok: row.ok ?? true,
    note: row.note ?? null,
  }];

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: res.ok ? "info" : "warn",
      func: row.func,
      traceId: row.trace_id,
      msg: "perf_emit_result",
      status: res.status,
      endpoint,
      response_preview: text.slice(0, 200),
    }));
  } catch (e) {
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      func: row.func,
      traceId: row.trace_id,
      msg: "perf_emit_error",
      error: (e as Error).message,
    }));
  }
}
