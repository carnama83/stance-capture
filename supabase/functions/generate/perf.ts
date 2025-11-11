<<<<<<< HEAD
// perf.ts — tiny perf spans + emitter (Edge Functions / Deno)
=======
// perf.ts — perf spans + DB emitter (Edge Functions / Deno)
>>>>>>> c28bb1d302724469db11f708477132bdd523ef0d
export type Perf = {
  traceId: string;
  t0: number;
  spans: Record<string, number>;
  incr(name: "external" | "db" | "compute", ms: number): void;
<<<<<<< HEAD
  span(name: "external" | "db" | "compute"): () => void;  // returns end() to record elapsed
=======
  span(name: "external" | "db" | "compute"): () => void; // returns end() to record elapsed
>>>>>>> c28bb1d302724469db11f708477132bdd523ef0d
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
<<<<<<< HEAD
    external_ms: spans.external && Math.round(spans.external),
    db_ms: spans.db && Math.round(spans.db),
    compute_ms: spans.compute && Math.round(spans.compute),
=======
    external_ms: spans.external !== undefined ? Math.round(spans.external) : undefined,
    db_ms: spans.db !== undefined ? Math.round(spans.db) : undefined,
    compute_ms: spans.compute !== undefined ? Math.round(spans.compute) : undefined,
>>>>>>> c28bb1d302724469db11f708477132bdd523ef0d
    ...meta,
  });

  return { traceId, t0, spans, incr, span, finish };
}

<<<<<<< HEAD
// Emit one perf row via PostgREST (best-effort). Requires:
//   PROJECT_URL, SERVICE_ROLE_KEY secrets set for this function.
=======
// Emit one perf row via PostgREST (best-effort).
// Requires URL + service role key in env. We support both custom and built-in names.
>>>>>>> c28bb1d302724469db11f708477132bdd523ef0d
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
<<<<<<< HEAD
  const url = Deno.env.get("PROJECT_URL");
  const key = Deno.env.get("SERVICE_ROLE_KEY");
  if (!url || !key) return;

  const endpoint = `${url}/rest/v1/admin.fn_perf`; // table path (schema.table)
  const body = [{
=======
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
>>>>>>> c28bb1d302724469db11f708477132bdd523ef0d
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
<<<<<<< HEAD
    await fetch(endpoint, {
=======
    const res = await fetch(endpoint, {
>>>>>>> c28bb1d302724469db11f708477132bdd523ef0d
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "resolution=merge-duplicates",
      },
<<<<<<< HEAD
      body: JSON.stringify(body),
    });
  } catch {
    // best-effort: never throw from emitter
=======
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
>>>>>>> c28bb1d302724469db11f708477132bdd523ef0d
  }
}
