// supabase/functions/embed/logic.ts
// v2.2 — Production-grade embedding function (boilerplate-safe).
//
// v2.2 changes (content-quality fixes):
//   1. CONTENT_KEYS reordered so the embed text is built from the full ARTICLE
//      CONTENT (normalized.content) instead of stopping at the short summary.
//      This is the change that lets the cleaner ingest content actually reach
//      the model.
//   2. stripTrackerNoise(): defensively removes analytics/tag-manager fragments
//      (GTM, dataLayer, gtag, etc.) that can survive HTML stripping on legacy rows.
//   3. Content cap is now env-tunable via EMBED_MAX_CONTENT_CHARS (default 3500).
//
// Responsibilities (single concern):
//   1. Select ingestion_queue rows that are missing embeddings
//   2. Generate embeddings via OpenAI text-embedding-3-small (or configured model)
//   3. Persist embedding + status/audit fields back to ingestion_queue
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";
// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------
function envInt(key, fallback) {
  const v = Deno.env.get(key);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function envStr(key, fallback) {
  return Deno.env.get(key) ?? fallback;
}
// Max chars of article body fed into the embedding. Kept moderate on purpose:
// for same-EVENT clustering, the headline + lede carry the shared signal, and
// long divergent bodies lower cross-source similarity. Tune via env if needed.
const MAX_CONTENT_CHARS = envInt("EMBED_MAX_CONTENT_CHARS", 3_500);
// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
function extractAny(obj, keys) {
  for (const k of keys){
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}
function clip(s, max) {
  if (!s) return "";
  const t = s.trim();
  return t.length > max ? t.slice(0, max) : t;
}
function stripHtml(s) {
  return (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function normalizeSpace(s) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}
function words(s) {
  const t = (s ?? "").toLowerCase();
  // keep unicode letters/digits, split others
  return t.split(/[^a-z0-9]+/g).filter((w)=>w.length >= 2);
}
function uniqueWordRatio(s) {
  const ws = words(s);
  if (!ws.length) return 0;
  const uniq = new Set(ws);
  return uniq.size / ws.length;
}
// Removes analytics / tag-manager noise that can survive HTML stripping.
// (node-html-parser exposes <noscript> contents as text, so legacy rows may
//  carry GoogleTagManager fragments even after tags are stripped.)
function stripTrackerNoise(s) {
  if (!s) return "";
  return s
    .replace(/https?:\/\/\S*googletagmanager\.com\S*/gi, " ")
    .replace(/\/\/(?:www\.)?googletagmanager\.com\S*/gi, " ")
    .replace(/\bGTM-[A-Z0-9]+\b/g, " ")
    .replace(/\b(?:dataLayer|gtag|fbq|_gaq)\b\S*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// Heuristics for paywalls / cookie walls / generic template text.
const BOILERPLATE_PATTERNS = [
  /subscribe\b/i,
  /\bsign\s*in\b/i,
  /\blog\s*in\b/i,
  /\bregister\b/i,
  /\bcreate\s+account\b/i,
  /\bsubscription\b/i,
  /\bpaywall\b/i,
  /\bcookie(s)?\b/i,
  /\bprivacy\s+policy\b/i,
  /\bterms\s+of\s+use\b/i,
  /\baccept\s+all\b/i,
  /\bmanage\s+cookies\b/i,
  /\benable\s+javascript\b/i,
  /\byour\s+ad\s+blocker\b/i,
  /\bturn\s+off\s+ad\s+blocker\b/i,
  /\bconsent\b/i,
  /\bcontinue\s+reading\b/i,
  /\bto\s+continue\b.*\bsubscribe\b/i
];
function removeChromeLikeText(s) {
  if (!s) return "";
  let t = s;
  const junkPhrases = [
    "privacy policy",
    "terms of use",
    "cookie policy",
    "subscribe",
    "sign in",
    "log in",
    "register",
    "advertisement",
    "all rights reserved"
  ];
  for (const p of junkPhrases){
    t = t.replace(new RegExp(`\\b${p.replace(/\s+/g, "\\s+")}\\b`, "gi"), " ");
  }
  t = normalizeSpace(t);
  return t;
}
function boilerplateScore(s) {
  if (!s) return 0;
  let score = 0;
  for (const re of BOILERPLATE_PATTERNS){
    if (re.test(s)) score++;
  }
  return score;
}
function isLowQualityContent(content) {
  const t = normalizeSpace(content);
  if (!t) return true;
  // Too short to be a real article body
  const wc = words(t).length;
  if (t.length < 300 || wc < 60) return true;
  // Highly repetitive / template-like
  const u = uniqueWordRatio(t);
  if (u > 0 && u < 0.35) return true;
  // Paywall/cookie wall signals
  const b = boilerplateScore(t);
  if (b >= 2) return true;
  // If it starts with classic wall language, treat as bad.
  if (/^(subscribe|sign in|log in|cookies|we use cookies)\b/i.test(t)) return true;
  return false;
}
// CONTENT KEYS — CONTENT FIRST, summary LAST.
// extractAny() returns the first matching key, so ordering decides what gets
// embedded. Previously "summary" was first, which meant the full article body
// in normalized.content was never used. Now content wins; summary is a fallback.
const CONTENT_KEYS = [
  "content",
  "content:encoded",
  "body",
  "full_text",
  "text",
  "description_html",
  "content_html",
  "excerpt",
  "description",
  "summary"
];
/**
 * Builds the text fed into the embedding model.
 * Order: title + summary + (clean article body).
 */ function buildEmbedText(row) {
  const title = clip(row.title ?? "", 300);
  const summary = clip(row.summary ?? "", 1_200);
  const normText = row.normalized ? extractAny(row.normalized, CONTENT_KEYS) : "";
  const rawText = row.raw ? extractAny(row.raw, CONTENT_KEYS) : "";
  // Strip HTML, remove chrome-like boilerplate, then defensively drop tracker noise.
  const rawContent = stripHtml(normText || rawText || "");
  const cleanedContent = stripTrackerNoise(removeChromeLikeText(rawContent));
  // Only include content if it looks like a real body.
  const contentOk = !isLowQualityContent(cleanedContent);
  const content = contentOk ? clip(cleanedContent, MAX_CONTENT_CHARS) : "";
  const text = [
    title,
    summary,
    content
  ].filter(Boolean).join("\n\n").trim();
  if (text.length >= 80) return text;
  // Fallback: title + summary or just the URL
  return `${title}\n${summary}`.trim() || (row.url ?? "");
}
// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------
async function openaiEmbed(texts, apiKey, model) {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: texts
    })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI embeddings failed: ${resp.status} ${err.slice(0, 400)}`);
  }
  const json = await resp.json();
  // Align by `index` rather than trusting array order — if OpenAI ever reorders
  // the data array, position-based mapping would assign vectors to wrong rows.
  const out = new Array(texts.length).fill(null);
  for (const d of json.data){
    if (typeof d?.index === "number") out[d.index] = d.embedding;
  }
  // Fallback for any unfilled slot (shouldn't happen, but be safe)
  for(let i = 0; i < out.length; i++){
    if (!out[i] && json.data[i]) out[i] = json.data[i].embedding;
  }
  return out;
}
// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------
function safeErr(s, max = 800) {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) : t;
}
// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export async function run(ctx) {
  const { log, shouldStop } = ctx;
  log("info", "🚀 EMBED START", {
    ts: new Date().toISOString()
  });
  // ── Step 1: Environment ────────────────────────────────────────────────────
  log("info", "📋 STEP 1: Loading environment", {});
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
  const WINDOW_HOURS = envInt("EMBED_WINDOW_HOURS", 72);
  const BATCH_LIMIT = envInt("EMBED_BATCH_LIMIT", 200);
  const OPENAI_BATCH = envInt("EMBED_OPENAI_BATCH", 20);
  const MAX_ATTEMPTS = envInt("EMBED_MAX_ATTEMPTS", 3);
  const EMBED_MODEL = envStr("OPENAI_EMBED_MODEL", "text-embedding-3-small");
  log("info", "✅ Configuration loaded", {
    windowHours: WINDOW_HOURS,
    batchLimit: BATCH_LIMIT,
    openAiBatch: OPENAI_BATCH,
    maxAttempts: MAX_ATTEMPTS,
    embedModel: EMBED_MODEL,
    maxContentChars: MAX_CONTENT_CHARS,
    hasSupabaseUrl: !!SUPABASE_URL,
    hasServiceRole: !!SERVICE_ROLE,
    hasOpenAiKey: !!OPENAI_API_KEY
  });
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    log("error", "❌ Missing SUPABASE_URL or SERVICE_ROLE", {});
    return {
      embedded: 0,
      attempted: 0,
      updated: 0,
      skipped: 0,
      failed: 1,
      errors: [
        "Missing SUPABASE_URL or SERVICE_ROLE"
      ]
    };
  }
  if (!OPENAI_API_KEY) {
    log("error", "❌ OPENAI_API_KEY not set", {});
    return {
      embedded: 0,
      attempted: 0,
      updated: 0,
      skipped: 0,
      failed: 1,
      errors: [
        "OPENAI_API_KEY not set"
      ]
    };
  }
  // ── Step 2: Supabase client ────────────────────────────────────────────────
  log("info", "📋 STEP 2: Connecting to Supabase", {});
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: {
      persistSession: false
    }
  });
  const errors = [];
  let failed = 0;
  let skipped = 0;
  let attempted = 0;
  let embedded = 0;
  // ── Step 3: Window inventory ───────────────────────────────────────────────
  log("info", "📋 STEP 3: Checking window inventory", {});
  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
  const inv = await supabaseAdmin.from("ingestion_queue").select("id", {
    count: "exact",
    head: true
  }).gte("created_at", sinceIso);
  log("info", "✅ Window inventory", {
    sinceIso,
    totalInWindow: inv.count ?? 0,
    error: inv.error?.message ?? null
  });
  // ── Step 4: Select candidates ──────────────────────────────────────────────
  log("info", "📋 STEP 4: Selecting rows missing embeddings", {});
  const selStart = performance.now();
  const { data: rows, error: selErr } = await supabaseAdmin.from("ingestion_queue").select("id, source_id, title, summary, raw, normalized, url, created_at, embed_attempts, embed_status").gte("created_at", sinceIso).is("embedding", null).lt("embed_attempts", MAX_ATTEMPTS).or("embed_status.is.null,embed_status.neq.running").order("created_at", {
    ascending: false
  }).limit(BATCH_LIMIT);
  log("info", selErr ? "❌ Select failed" : "✅ Select complete", {
    count: rows?.length ?? 0,
    error: selErr?.message ?? null,
    durationMs: Math.round(performance.now() - selStart)
  });
  if (selErr) {
    return {
      embedded: 0,
      attempted: 0,
      updated: 0,
      skipped: 0,
      failed: 1,
      errors: [
        `select_failed: ${selErr.message}`
      ]
    };
  }
  const candidates = rows ?? [];
  if (!candidates.length) {
    log("info", "✅ Nothing to embed — all rows already have embeddings or hit attempt cap", {});
    return {
      embedded: 0,
      attempted: 0,
      updated: 0,
      skipped: 0,
      failed: 0
    };
  }
  log("info", "📊 Candidate analysis", {
    count: candidates.length,
    attemptsBreakdown: candidates.reduce((acc, r)=>{
      const key = String(r.embed_attempts ?? 0);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    sampleTitles: candidates.slice(0, 3).map((r)=>r.title?.slice(0, 60))
  });
  // ── Step 5: Mark as "running" (best-effort — prevents duplicate work) ──────
  log("info", "📋 STEP 5: Marking rows as running", {});
  try {
    await supabaseAdmin.from("ingestion_queue").update({
      embed_status: "running"
    }).in("id", candidates.map((r)=>r.id));
  } catch (e) {
    log("warn", "⚠️ Could not mark rows as running (non-fatal)", {
      error: e?.message ?? String(e)
    });
  }
  // ── Step 6: Generate embeddings in batches ─────────────────────────────────
  log("info", "📋 STEP 6: Generating embeddings", {
    totalCandidates: candidates.length,
    openAiBatchSize: OPENAI_BATCH
  });
  let batchNum = 0;
  for(let i = 0; i < candidates.length; i += OPENAI_BATCH){
    if (shouldStop()) {
      const remaining = candidates.length - i;
      skipped += remaining;
      const unprocessedIds = candidates.slice(i).map((r)=>r.id);
      try {
        await supabaseAdmin.from("ingestion_queue").update({
          embed_status: null
        }).in("id", unprocessedIds);
      } catch  {
      // ignore
      }
      log("warn", "⏰ Budget exhausted — stopping early", {
        processedBatches: batchNum,
        skippedRows: remaining
      });
      break;
    }
    batchNum++;
    const batch = candidates.slice(i, i + OPENAI_BATCH);
    const texts = batch.map(buildEmbedText);
    attempted += batch.length;
    log("info", `🔄 Batch ${batchNum}`, {
      batchNum,
      size: batch.length,
      rangeStart: i,
      rangeEnd: i + batch.length,
      emptyTexts: texts.filter((t)=>!t || t.trim().length === 0).length
    });
    try {
      const apiStart = performance.now();
      const embeddings = await openaiEmbed(texts, OPENAI_API_KEY, EMBED_MODEL);
      const apiMs = Math.round(performance.now() - apiStart);
      log("info", `✅ OpenAI response for batch ${batchNum}`, {
        batchNum,
        embeddingsReturned: embeddings.length,
        durationMs: apiMs,
        avgMsPerItem: Math.round(apiMs / Math.max(1, embeddings.length))
      });
      // Persist each embedding individually so partial success is preserved
      for(let j = 0; j < batch.length; j++){
        const row = batch[j];
        const emb = embeddings[j];
        if (!emb || emb.length === 0) {
          log("warn", "⚠️ Empty embedding returned by OpenAI", {
            id: row.id,
            title: row.title?.slice(0, 60)
          });
          failed++;
          await supabaseAdmin.from("ingestion_queue").update({
            embed_status: "error",
            embed_error: safeErr("empty embedding returned"),
            embed_attempts: (row.embed_attempts ?? 0) + 1,
            embed_model: EMBED_MODEL
          }).eq("id", row.id);
          continue;
        }
        const { error: updErr } = await supabaseAdmin.from("ingestion_queue").update({
          embedding: emb,
          embed_status: "done",
          embed_error: null,
          embed_attempts: (row.embed_attempts ?? 0) + 1,
          embed_model: EMBED_MODEL,
          embedded_at: new Date().toISOString()
        }).eq("id", row.id);
        if (updErr) {
          failed++;
          errors.push(`update_failed:${row.id}:${updErr.message}`);
          log("warn", "⚠️ Failed to persist embedding", {
            id: row.id,
            error: updErr.message
          });
          await supabaseAdmin.from("ingestion_queue").update({
            embed_status: "error",
            embed_error: safeErr(`db_update_failed: ${updErr.message}`),
            embed_attempts: (row.embed_attempts ?? 0) + 1,
            embed_model: EMBED_MODEL
          }).eq("id", row.id).then(()=>{}).catch(()=>{});
        } else {
          embedded++;
        }
      }
      log("info", `✅ Batch ${batchNum} persisted`, {
        batchNum,
        runningTotalEmbedded: embedded
      });
    } catch (err) {
      const msg = err?.message ?? String(err);
      failed++;
      errors.push(`openai_batch_${batchNum}_failed: ${msg}`);
      log("error", `❌ OpenAI batch ${batchNum} failed`, {
        batchNum,
        error: msg,
        batchSize: batch.length
      });
      const now = new Date().toISOString();
      for (const row of batch){
        try {
          await supabaseAdmin.from("ingestion_queue").update({
            embed_status: "error",
            embed_error: safeErr(msg),
            embed_attempts: (row.embed_attempts ?? 0) + 1,
            embed_model: EMBED_MODEL,
            embedded_at: now
          }).eq("id", row.id);
        } catch  {
        // ignore — best effort
        }
      }
    }
  }
  log("info", "🎉 EMBED COMPLETE", {
    embedded,
    attempted,
    skipped,
    failed,
    errorsCount: errors.length
  });
  return {
    embedded,
    attempted,
    updated: embedded,
    skipped,
    failed,
    ...errors.length ? {
      errors
    } : {}
  };
}
