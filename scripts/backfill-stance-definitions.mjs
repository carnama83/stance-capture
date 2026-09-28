#!/usr/bin/env node
// Epic Report R1 (RPT-01) — one-off backfill of question_stance_definitions.
//
// Calls generate-stance-definitions for every published rendition that does
// not yet have its five definitions. The function is idempotent, so re-running
// only fills gaps. Each generation is one gpt-4o-mini call.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=... \
//     node scripts/backfill-stance-definitions.mjs [--dry-run] [--concurrency=4]

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
const dryRun = process.argv.includes("--dry-run");
const concurrency = Number((process.argv.find((a) => a.startsWith("--concurrency=")) ?? "=4").split("=")[1]);

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_ANON_KEY");
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function getAll(path) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers: { ...headers, Range: `${from}-${from + 999}` } });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

const renditions = await getAll("question_renditions?lifecycle_status=eq.published&select=id,language_code");
const defined = await getAll("question_stance_definitions?select=rendition_id");
const counts = new Map();
for (const d of defined) counts.set(d.rendition_id, (counts.get(d.rendition_id) ?? 0) + 1);
const todo = renditions.filter((r) => (counts.get(r.id) ?? 0) < 5);

console.log(`published renditions: ${renditions.length}; missing definitions: ${todo.length}`);
if (dryRun || todo.length === 0) process.exit(0);

let done = 0;
const failures = [];
async function worker(queue) {
  for (let r = queue.shift(); r; r = queue.shift()) {
    try {
      const res = await fetch(`${url}/functions/v1/generate-stance-definitions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ rendition_id: r.id }),
        signal: AbortSignal.timeout(120_000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(body.definitions) || body.definitions.length !== 5) {
        failures.push({ id: r.id, lang: r.language_code, status: res.status, error: body.detail ?? body.error });
      }
    } catch (e) {
      failures.push({ id: r.id, lang: r.language_code, error: String(e) });
    }
    done++;
    if (done % 10 === 0) console.log(`${done}/${todo.length}`);
  }
}
const queue = [...todo];
await Promise.all(Array.from({ length: concurrency }, () => worker(queue)));

console.log(`done: ${done - failures.length} ok, ${failures.length} failed`);
for (const f of failures) console.log("FAILED", JSON.stringify(f));
process.exit(failures.length ? 2 : 0);
