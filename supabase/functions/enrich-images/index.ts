// supabase/functions/enrich-images/index.ts
//
// Phase 2: OG Image Enrichment Job
//
// Finds news_items with image_url = null, fetches HTML from news_items.url,
// extracts og:image / twitter:image, writes back to news_items.image_url.
//
// After enrichment, calls assign_draft_covers_batch() and
// assign_question_covers_batch() to propagate images to drafts/questions.
//
// Triggered by: POST with x-cron-secret header
// Env vars required:
//   CRON_SECRET                   — auth
//   SUPABASE_URL                  — your project URL
//   SUPABASE_SERVICE_ROLE_KEY     — service role key (writes to news_items)
//
// Deploy: supabase functions deploy enrich-images
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ─── Config ──────────────────────────────────────────────────────────────────
const BATCH_SIZE = 30; // news_items to process per run
const FETCH_TIMEOUT_MS = 8000; // per-article fetch timeout
const MAX_HTML_BYTES = 50_000; // ✅ stop streaming after 50KB — meta tags are always in <head>
const MAX_COVER_BATCH = 200; // max drafts/questions to assign covers to per run
// Domains that are redirect-only or block all bots — skip scraping, mark checked
const SKIP_DOMAINS = new Set([
  "news.google.com",
  "google.com",
  "t.co",
  "bit.ly",
  "ow.ly"
]);
// Googlebot UA gets through most bot checks and still returns og:image in meta
const USER_AGENT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
// ─── Handler ─────────────────────────────────────────────────────────────────
Deno.serve(async (req)=>{
  if (req.method.toUpperCase() !== "POST") {
    return json({
      ok: false,
      error: "Method Not Allowed"
    }, 405);
  }
  // Auth
  const incoming = req.headers.get("x-cron-secret") ?? "";
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (!expected || incoming !== expected) {
    return json({
      ok: false,
      error: "Unauthorized"
    }, 401);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json({
      ok: false,
      error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    }, 500);
  }
  const db = createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false
    }
  });
  const t0 = Date.now();
  log("info", "start", {
    batch_size: BATCH_SIZE
  });
  try {
    // ── Step 1: Fetch unchecked news_items ─────────────────────────────────
    const { data: rows, error: fetchErr } = await db.from("news_items").select("id, url").is("image_url", null).is("image_checked_at", null).order("created_at", {
      ascending: false
    }).limit(BATCH_SIZE);
    if (fetchErr) throw fetchErr;
    const items = rows ?? [];
    log("info", "fetched_batch", {
      count: items.length
    });
    if (items.length === 0) {
      // Nothing new to check — still run cover assignment in case it was missed
      const coverResult = await runCoverAssignment(db);
      return json({
        ok: true,
        enriched: 0,
        no_image: 0,
        skipped: 0,
        errors: 0,
        ...coverResult,
        elapsed_ms: Date.now() - t0
      });
    }
    // ── Step 2: Enrich all items concurrently ─────────────────────────────
    const results = await Promise.allSettled(items.map((item)=>enrichItem(item)));
    // ── Step 3: Write results back ─────────────────────────────────────────
    let enriched = 0; // found an image
    let no_image = 0; // fetched fine but article has no og:image (expected, not an error)
    let skipped = 0; // skip-domain or resolve_failed
    let errors = 0; // actual network/fetch errors only
    for (const settled of results){
      if (settled.status === "rejected") {
        errors++;
        continue;
      }
      const r = settled.value;
      const checkedAt = new Date().toISOString();
      const { error: updateErr } = await db.from("news_items").update({
        image_url: r.image_url,
        image_meta: {
          source: r.source,
          checked_at: checkedAt,
          ...r.error ? {
            detail: r.error
          } : {}
        },
        image_checked_at: checkedAt,
        // ✅ Persist resolved_url so future re-runs skip the redirect step
        ...r.resolved_url ? {
          resolved_url: r.resolved_url
        } : {}
      }).eq("id", r.id);
      if (updateErr) {
        log("warn", "update_failed", {
          id: r.id,
          error: updateErr.message
        });
        errors++;
        continue;
      }
      // ✅ Correct bucketing — "no_image" is not an error
      if (r.image_url) enriched++;
      else if (r.source === "no_image") no_image++;
      else if (r.source === "skip" || r.source === "resolve_failed") skipped++;
      else errors++;
    }
    log("info", "enrichment_done", {
      enriched,
      no_image,
      skipped,
      errors,
      elapsed_ms: Date.now() - t0
    });
    // ── Step 4: Assign covers now that we have fresh images ────────────────
    const coverResult = await runCoverAssignment(db);
    return json({
      ok: true,
      enriched,
      no_image,
      skipped,
      errors,
      ...coverResult,
      elapsed_ms: Date.now() - t0
    });
  } catch (err) {
    log("error", "exception", {
      error: err.message
    });
    return json({
      ok: false,
      error: err.message
    }, 500);
  }
});
// ─── Enrichment logic ─────────────────────────────────────────────────────────
async function enrichItem(item) {
  let targetUrl = item.url;
  let resolvedUrl;
  // Resolve Google News redirect URLs
  if (isGoogleNewsUrl(item.url)) {
    const resolved = await resolveRedirect(item.url);
    if (!resolved) {
      return {
        id: item.id,
        url: item.url,
        image_url: null,
        source: "resolve_failed"
      };
    }
    targetUrl = resolved;
    resolvedUrl = resolved; // ✅ will be saved back to news_items.resolved_url
  }
  // Skip known bot-blocking or redirect-only domains
  try {
    const hostname = new URL(targetUrl).hostname.replace(/^www\./, "");
    if (SKIP_DOMAINS.has(hostname)) {
      return {
        id: item.id,
        url: item.url,
        image_url: null,
        source: "skip"
      };
    }
  } catch  {
    return {
      id: item.id,
      url: item.url,
      image_url: null,
      source: "error",
      error: "invalid_url"
    };
  }
  // Fetch HTML with timeout
  let html;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html"
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (res.status >= 500) {
      // Server error — don't mark as checked_at so it gets retried next run
      return {
        id: item.id,
        url: item.url,
        image_url: null,
        source: "error",
        error: `http_${res.status}`
      };
    }
    // ✅ Stream read — stop after MAX_HTML_BYTES or </head> (whichever first)
    // Avoids buffering entire 500KB–2MB articles when og:image is in the first ~5KB
    const reader = res.body?.getReader();
    html = "";
    if (reader) {
      const decoder = new TextDecoder();
      let bytes = 0;
      while(bytes < MAX_HTML_BYTES){
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, {
          stream: true
        });
        bytes += value.length;
        if (html.includes("</head>")) break;
      }
      reader.cancel();
    } else {
      html = await res.text();
    }
  } catch (err) {
    const msg = err.message ?? "fetch_failed";
    return {
      id: item.id,
      url: item.url,
      image_url: null,
      source: "error",
      error: msg
    };
  }
  // Extract image from meta tags — try all attribute orderings
  const ogImage = extractMetaContent(html, [
    /property="og:image"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+property="og:image"/i,
    /property='og:image'\s+content='([^']+)'/i,
    /content='([^']+)'\s+property='og:image'/i
  ]);
  if (ogImage) {
    return {
      id: item.id,
      url: item.url,
      image_url: normalizeImageUrl(ogImage, targetUrl),
      source: "og:image",
      resolved_url: resolvedUrl
    };
  }
  const twitterImage = extractMetaContent(html, [
    /name="twitter:image"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+name="twitter:image"/i,
    /name='twitter:image'\s+content='([^']+)'/i,
    /property="twitter:image"\s+content="([^"]+)"/i
  ]);
  if (twitterImage) {
    return {
      id: item.id,
      url: item.url,
      image_url: normalizeImageUrl(twitterImage, targetUrl),
      source: "twitter:image",
      resolved_url: resolvedUrl
    };
  }
  // ✅ No image found — source is "no_image" not "error"
  return {
    id: item.id,
    url: item.url,
    image_url: null,
    source: "no_image",
    resolved_url: resolvedUrl
  };
}
// ─── Cover assignment after enrichment ───────────────────────────────────────
async function runCoverAssignment(db) {
  try {
    const { data: draftResult, error: de } = await db.rpc("assign_draft_covers_batch", {
      p_limit: MAX_COVER_BATCH
    });
    if (de) log("warn", "draft_cover_batch_error", {
      error: de.message
    });
    const { data: qResult, error: qe } = await db.rpc("assign_question_covers_batch", {
      p_limit: MAX_COVER_BATCH
    });
    if (qe) log("warn", "question_cover_batch_error", {
      error: qe.message
    });
    return {
      draft_covers: draftResult ?? null,
      question_covers: qResult ?? null
    };
  } catch (err) {
    log("warn", "cover_assignment_failed", {
      error: err.message
    });
    return {
      draft_covers: null,
      question_covers: null
    };
  }
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
function isGoogleNewsUrl(url) {
  try {
    const h = new URL(url).hostname;
    return h === "news.google.com" || h.endsWith(".google.com");
  } catch  {
    return false;
  }
}
async function resolveRedirect(url) {
  try {
    const controller = new AbortController();
    setTimeout(()=>controller.abort(), 5000);
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT
      },
      signal: controller.signal
    });
    return res.url !== url ? res.url : null;
  } catch  {
    return null;
  }
}
function extractMetaContent(html, patterns) {
  for (const pattern of patterns){
    const m = html.match(pattern);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}
function normalizeImageUrl(raw, baseUrl) {
  try {
    // Handle protocol-relative URLs
    if (raw.startsWith("//")) return "https:" + raw;
    // Handle relative URLs
    if (raw.startsWith("/")) return new URL(raw, baseUrl).href;
    // Decode HTML entities
    return raw.replace(/&amp;/g, "&").replace(/&#39;/g, "'");
  } catch  {
    return raw;
  }
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    func: "enrich-images",
    msg,
    ...extra
  }));
}
