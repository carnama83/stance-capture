// perf.ts — tiny perf spans + emitter (Edge Functions / Deno)
export type Perf = {
  traceId: string;
  t0: number;
  spans: Record<string, number>;
  incr(name: "external" | "db" | "compute", ms: number): void;
  span(name: "external" | "db" | "compute"): () => void;  // returns end() to record elapsed
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
    external_ms: spans.external && Math.round(spans.external),
    db_ms: spans.db && Math.round(spans.db),
    compute_ms: spans.compute && Math.round(spans.compute),
    ...meta,
  });

  return { traceId, t0, spans, incr, span, finish };
}

// Emit one perf row via PostgREST (best-effort). Requires:
//   PROJECT_URL, SERVICE_ROLE_KEY secrets set for this function.
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
  const url = Deno.env.get("PROJECT_URL");
  const key = Deno.env.get("SERVICE_ROLE_KEY");
  if (!url || !key) return;

  const endpoint = `${url}/rest/v1/admin.fn_perf`; // table path (schema.table)
  const body = [{
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
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(body),
    });
  } catch {
    // best-effort: never throw from emitter
  }
}
