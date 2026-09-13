// supabase/functions/ingest-worker/index.ts
// Queue worker: ingestion_queue -> news_items
//
// Option B behavior:
// - Worker processes jobs from ingestion_queue into news_items
// - Retries jobs with status error/new/pending (via admin_claim_ingest_jobs update below)
// - Re-queues stale "running" jobs so they can be retried
//
// Auth:
// - Preferred: x-cron-secret (CRON_SECRET env)
// - Optional: Authorization Bearer admin JWT (calls is_admin_me)
import { XMLParser as FastXMLParser } from "https://esm.sh/fast-xml-parser@4.3.6";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    lvl: level,
    fn: "ingest-worker",
    msg,
    ...extra
  }));
}
function ensure(v, name) {
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
function sleep(ms) {
  return new Promise((r)=>setTimeout(r, ms));
}
function jitter(base) {
  return base + Math.floor(Math.random() * base);
}
function timeBudget(budgetMs) {
  const t0 = Date.now();
  return ()=>Date.now() - t0 >= budgetMs;
}
function normalizeUrl(u) {
  if (!u) return "";
  let url = u.trim();
  if (/^www\./i.test(url)) url = "https://" + url;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url;
}
/* ---------------- Parsing ---------------- */ const xmlParser = new FastXMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  allowBooleanAttributes: true,
  trimValues: true
});
function parseXmlFeed(xml) {
  let data;
  try {
    data = xmlParser.parse(xml);
  } catch  {
    return [];
  }
  // RSS 2.0
  const rssItem = data?.rss?.channel?.item;
  if (rssItem) {
    const items = Array.isArray(rssItem) ? rssItem : [
      rssItem
    ];
    return items.map((it)=>({
        title: it?.title ?? "",
        url: it?.link ?? "",
        published_at: it?.pubDate ?? it?.["dc:date"] ?? null,
        summary: it?.description ?? it?.["content:encoded"] ?? null
      })).filter((x)=>x.title && x.url);
  }
  // Atom
  const atomEntry = data?.feed?.entry;
  if (atomEntry) {
    const entries = Array.isArray(atomEntry) ? atomEntry : [
      atomEntry
    ];
    return entries.map((e)=>{
      const title = typeof e?.title === "object" ? e?.title?.["#text"] ?? e?.title?.["$text"] ?? "" : e?.title ?? "";
      let href = "";
      if (Array.isArray(e?.link)) {
        const alt = e.link.find((l)=>l?.["@rel"] === "alternate") ?? e.link[0];
        href = alt?.["@href"] ?? "";
      } else {
        href = e?.link?.["@href"] ?? "";
      }
      const summary = typeof e?.summary === "object" ? e?.summary?.["#text"] ?? null : e?.summary ?? null;
      const content = typeof e?.content === "object" ? e?.content?.["#text"] ?? null : e?.content ?? null;
      return {
        title,
        url: href,
        published_at: e?.updated ?? e?.published ?? null,
        summary: summary ?? content ?? null
      };
    }).filter((x)=>x.title && x.url);
  }
  return [];
}
function parseJsonFeed(json) {
  if (Array.isArray(json)) {
    return json.map((x)=>({
        title: x?.title ?? x?.headline ?? "",
        url: x?.url ?? x?.link ?? "",
        published_at: x?.published_at ?? x?.date ?? null,
        summary: x?.summary ?? x?.description ?? null
      })).filter((x)=>x.title && x.url);
  }
  if (json && Array.isArray(json.items)) return parseJsonFeed(json.items);
  return [];
}
/* ---------------- Fetch with retries ---------------- */ async function fetchWithRetry(url, attempts = 3) {
  let lastErr = null;
  for(let i = 0; i < attempts; i++){
    try {
      const resp = await fetch(url, {
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
          accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, application/json;q=0.8, text/*;q=0.7, */*;q=0.5",
          "accept-language": "en-US,en;q=0.9",
          referer: "https://news.google.com/",
          "cache-control": "no-cache"
        }
      });
      const ctype = resp.headers.get("content-type") || "";
      const body = await resp.text();
      return {
        ok: resp.ok,
        status: resp.status,
        ctype,
        body
      };
    } catch (e) {
      lastErr = e;
    }
    await sleep(jitter(400 * (i + 1)));
  }
  throw lastErr ?? new Error("network error");
}
/* ---------------- DB helpers ---------------- */ function safeIsoDate(input) {
  if (!input) return null;
  try {
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch  {
    return null;
  }
}
async function upsertItem(admin, source_id, it, conflictTarget) {
  const row = {
    source_id,
    title: String(it.title).slice(0, 512),
    url: String(it.url),
    published_at: safeIsoDate(it.published_at),
    summary: it.summary ?? null,
    lang: "en"
  };
  // Avoid `.single()` to reduce brittleness; we only care that it succeeds.
  const { error } = await admin.from("news_items").upsert(row, {
    onConflict: conflictTarget
  });
  if (error) throw error;
}
function adminCheckOk(adminCheck) {
  // supports: boolean, {is_admin:true}, [{is_admin:true}], etc.
  if (adminCheck === true) return true;
  if (adminCheck?.is_admin === true) return true;
  if (Array.isArray(adminCheck) && adminCheck[0]?.is_admin === true) return true;
  return false;
}
async function authorize(req, supabaseUrl, anonKey, cronSecret) {
  const incomingSecret = req.headers.get("x-cron-secret") || "";
  if (cronSecret && incomingSecret === cronSecret) return {
    ok: true,
    mode: "cron"
  };
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const sbUser = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader
        }
      },
      auth: {
        persistSession: false
      }
    });
    const { data, error } = await sbUser.rpc("is_admin_me");
    if (!error && adminCheckOk(data)) return {
      ok: true,
      mode: "jwt"
    };
  }
  return {
    ok: false,
    mode: "none"
  };
}
async function finishJob(admin, params) {
  const attempts = [
    {
      p_id: params.id,
      p_status: params.status,
      p_error: params.error
    },
    {
      p_job_id: params.id,
      p_status: params.status,
      p_error: params.error
    },
    {
      p_ingestion_id: params.id,
      p_status: params.status,
      p_error: params.error
    },
    {
      job_id: params.id,
      status: params.status,
      error: params.error
    }
  ];
  for (const a of attempts){
    const { error } = await admin.rpc("admin_finish_ingest_job", a);
    if (!error) return {
      ok: true
    };
  }
  // Fallback: at least unstick ingestion_queue status so UI doesn't show "running" forever.
  // (We keep it minimal to avoid column-name mismatches.)
  const { error: updErr } = await admin.from("ingestion_queue").update({
    status: params.status
  }).eq("id", params.id);
  if (updErr) {
    return {
      ok: false,
      error: updErr.message
    };
  }
  return {
    ok: true,
    warned: "admin_finish_ingest_job failed; used fallback update"
  };
}
async function requeueStaleRunning(admin, staleAfterMinutes) {
  // Best-effort: if columns exist, great. If not, ignore errors.
  try {
    // If started_at exists, requeue jobs older than threshold.
    const isoCutoff = new Date(Date.now() - staleAfterMinutes * 60_000).toISOString();
    await admin.from("ingestion_queue").update({
      status: "error"
    }).eq("status", "running")// @ts-ignore supabase-js typing
    .lt("started_at", isoCutoff);
  } catch (e) {
    log("warn", "requeue_stale_running_failed", {
      err: e?.message ?? String(e)
    });
  }
}
/* ---------------- Main handler ---------------- */ Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const SUPABASE_URL = ensure(Deno.env.get("SUPABASE_URL"), "SUPABASE_URL");
    const ANON_KEY = ensure(Deno.env.get("SUPABASE_ANON_KEY"), "SUPABASE_ANON_KEY");
    const SERVICE_ROLE = ensure(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY"), "SUPABASE_SERVICE_ROLE_KEY");
    const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
    const auth = await authorize(req, SUPABASE_URL, ANON_KEY, CRON_SECRET);
    if (!auth.ok) {
      return new Response(JSON.stringify({
        ok: false,
        error: "forbidden"
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "content-type": "application/json"
        }
      });
    }
    const JOB_BATCH = Number(Deno.env.get("WORKER_CLAIM_BATCH") ?? 3);
    const BUDGET_MS = Number(Deno.env.get("WORKER_BUDGET_MS") ?? 5000);
    const STALE_AFTER_MINUTES = Number(Deno.env.get("STALE_AFTER_MINUTES") ?? 15);
    const CONFLICT_TARGET = String(Deno.env.get("NEWS_ITEMS_CONFLICT_TARGET") ?? "source_id,url");
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: {
        persistSession: false
      }
    });
    // Unstick any stale running jobs so they can be retried
    await requeueStaleRunning(admin, STALE_AFTER_MINUTES);
    const overBudget = timeBudget(BUDGET_MS);
    let processed = 0;
    let done = 0;
    let failed = 0;
    let finishWarnings = 0;
    while(!overBudget()){
      await sleep(150 + Math.floor(Math.random() * 100));
      const { data: jobs, error: claimErr } = await admin.rpc("admin_claim_ingest_jobs", {
        p_limit: Math.max(1, JOB_BATCH)
      });
      if (claimErr) throw claimErr;
      const list = Array.isArray(jobs) ? jobs : [];
      if (!list.length) break;
      for (const job of list){
        if (overBudget()) break;
        processed++;
        const id = job.id;
        const source_id = job.source_id;
        const safeUrl = normalizeUrl(String(job.url || ""));
        try {
          if (!safeUrl) throw new Error("Invalid URL");
          const res = await fetchWithRetry(safeUrl, 3);
          if (!res.ok) {
            const preview = res.body.slice(0, 280).replace(/\s+/g, " ");
            throw new Error(`fetch ${res.status} for ${safeUrl} :: ${preview}`);
          }
          let items = [];
          const bodyTrim = res.body.trim();
          if (res.ctype.includes("xml") || bodyTrim.startsWith("<")) {
            items = parseXmlFeed(bodyTrim);
          } else {
            try {
              items = parseJsonFeed(JSON.parse(bodyTrim));
            } catch  {
              items = [];
            }
          }
          for (const it of items.slice(0, 50)){
            await upsertItem(admin, source_id, it, CONFLICT_TARGET);
            if (overBudget()) break;
          }
          const fin = await finishJob(admin, {
            id,
            status: "done",
            error: null
          });
          if (fin?.warned) finishWarnings++;
          done++;
        } catch (e) {
          const msg = (e?.message ?? String(e)).slice(0, 1000);
          const fin = await finishJob(admin, {
            id,
            status: "error",
            error: msg
          });
          if (fin?.warned) finishWarnings++;
          failed++;
        }
      }
    }
    log("info", "worker_done", {
      processed,
      done,
      failed,
      finishWarnings,
      budget_ms: BUDGET_MS,
      auth_mode: auth.mode
    });
    return new Response(JSON.stringify({
      ok: true,
      processed,
      done,
      failed,
      finishWarnings
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "application/json"
      }
    });
  } catch (e) {
    log("error", "worker_exception", {
      err: e?.message ?? String(e)
    });
    return new Response(JSON.stringify({
      ok: false,
      error: e?.message ?? String(e)
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "content-type": "application/json"
      }
    });
  }
});
