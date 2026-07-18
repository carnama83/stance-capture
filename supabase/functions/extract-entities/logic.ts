// supabase/functions/extract-entities/logic.ts
// v1.3 — Standalone entity extraction pipeline step.
//
// v1.3 changes:
//   1. buildArticleText now drops PAYWALL / COOKIE-WALL boilerplate before it
//      reaches the model (e.g. The Hindu "Subscribed with another email…"
//      interstitials), so those rows no longer yield spurious entities.
//      IMPORTANT: this ports ONLY the boilerplate detection from embed/logic.ts
//      v2.2 — NOT its length/uniqueness gates. embed drops short bodies because
//      a 200-char lede barely changes an embedding; for entity extraction a
//      short clean lede is exactly where the key entities are, so dropping it
//      would be counter-productive (it would force title-only extraction on
//      ~23%% of a typical batch: The Hill, NDTV, Indian Express, NPR, etc.).
//      When content IS rejected as boilerplate, extraction falls back to
//      title (+ summary if present).
//
// v1.2 changes:
//   4. Prompt now excludes bylines/authors, reporter names, photo credits, and names
//      from related-article links / sidebars — these were inflating spurious entity
//      overlap between unrelated articles from the same outlet.
//
// v1.1 changes:
//   1. CONTENT_KEYS reordered CONTENT-FIRST so buildArticleText feeds the model the
//      full article body, not the short summary. (Same fix as embed/logic.ts v2.2.)
//   2. Canonicalization prompt: instructs the model to emit STABLE, full-form entity
//      strings so cluster's exact-match Jaccard overlap actually fires across outlets.
//   3. extractEntities retries on 429/5xx with backoff instead of immediately burning
//      an attempt — protects against transient rate limits at higher concurrency.
//
// Pipeline position: embed → extract-entities (this file) → cluster
//
// Responsibilities:
//   1. Select ingestion_queue rows that have embeddings but no entities yet
//   2. Call OpenAI GPT-4o-mini to extract structured entities per article
//   3. Write entities back to ingestion_queue
//
// Env vars (set in Supabase Edge Function Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)
//   OPENAI_API_KEY
//   ENTITY_BUDGET_MS          — default 45000
//   ENTITY_WINDOW_HOURS       — default 72
//   ENTITY_BATCH_LIMIT        — default 300 (max rows to process per run)
//   ENTITY_CONCURRENCY        — default 10
//   ENTITY_MAX_ATTEMPTS       — default 3
//   ENTITY_MODEL              — default "gpt-4o-mini"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";
// ─────────────────────────────────────────────────────────────────────────────
// Env helpers
// ─────────────────────────────────────────────────────────────────────────────
function envInt(key, fallback) {
  const v = Deno.env.get(key);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function envStr(key, fallback) {
  return Deno.env.get(key) ?? fallback;
}
const sleep = (ms)=>new Promise((r)=>setTimeout(r, ms));
// ─────────────────────────────────────────────────────────────────────────────
// Text helpers (mirrors cluster/logic.ts)
// ─────────────────────────────────────────────────────────────────────────────
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
// ─────────────────────────────────────────────────────────────────────────────
// Paywall / cookie-wall guard.
// Ports the BOILERPLATE detection from embed/logic.ts v2.2 (identical patterns),
// but deliberately omits embed's length/uniqueness gates: for entity extraction
// a short, clean lede is worth keeping — only paywall/consent boilerplate is junk.
// ─────────────────────────────────────────────────────────────────────────────
function normalizeSpace(s) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}
// Removes analytics / tag-manager noise that can survive HTML stripping.
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
// True only for paywall / cookie-wall interstitials — NOT for merely short text.
function isBoilerplateContent(content) {
  const t = normalizeSpace(content);
  if (!t) return false;
  if (boilerplateScore(t) >= 2) return true;
  if (/^(subscribe|sign in|log in|cookies|we use cookies)\b/i.test(t)) return true;
  return false;
}
// CONTENT FIRST, summary LAST — extractAny returns the first matching key, so this
// ordering is what makes the model see the article body instead of the summary.
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
function buildArticleText(row) {
  const title = clip(row.title ?? "", 300);
  const summary = clip(row.summary ?? "", 1_200);
  const normText = row.normalized ? extractAny(row.normalized, CONTENT_KEYS) : "";
  const rawText = row.raw ? extractAny(row.raw, CONTENT_KEYS) : "";
  // Clean the body the same way embed does (strip HTML, chrome text, trackers)...
  const rawContent = stripHtml(normText || rawText || "");
  const cleanedContent = stripTrackerNoise(removeChromeLikeText(rawContent));
  // ...but only DROP it if it's paywall/cookie-wall boilerplate. Short but clean
  // ledes are kept — they carry the entities we want. Falls back to title
  // (+ summary) when the body is rejected.
  const content = isBoilerplateContent(cleanedContent) ? "" : clip(cleanedContent, 2_000);
  return [
    title,
    summary,
    content
  ].filter(Boolean).join("\n\n").trim() || `${title}\n${summary}`.trim() || (row.url ?? "");
}
// ─────────────────────────────────────────────────────────────────────────────
// Concurrency helper
// ─────────────────────────────────────────────────────────────────────────────
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({
    length: Math.min(limit, items.length)
  }, async ()=>{
    while(true){
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}
// ─────────────────────────────────────────────────────────────────────────────
// Entity extraction
//   - Canonicalization prompt for stable cross-article entity strings
//   - Retries on 429 / 5xx with backoff so transient throttling doesn't burn attempts
// ─────────────────────────────────────────────────────────────────────────────
const ENTITY_SYSTEM_PROMPT = "Extract named entities from a news article so that articles about the SAME event can be matched. " + "Return a JSON object with these keys: " + "people (array of full canonical names — drop titles/honorifics like 'PM', 'Mr', 'Dr'; use the most complete " + "commonly-used name, e.g. 'Narendra Modi' not 'Modi' or 'PM Modi'), " + "organizations (array, expanded to a consistent canonical form, e.g. 'Central Bureau of Investigation (CBI)'), " + "locations (array of specific place names — city, state, and/or country), " + "events (array of short canonical event descriptors, e.g. 'Air India AI-171 crash'), " + "mainTopic (one short string). " + "Use identical spelling for the same entity across articles so they match exactly. " + "Extract ONLY entities that are actual subjects or participants of THIS news event. " + "Do NOT include the article's author or byline, reporter or correspondent names, photo credits, " + "or any names that appear only in related-article links, 'read more' lists, navigation, or sidebars. " + "If a person is mentioned only as the journalist reporting the story, exclude them. " + "Only include entities actually present in the article body. Use [] for empty categories.";
async function extractEntities(article, apiKey, model, log) {
  const text = buildArticleText(article).slice(0, 2_000);
  const body = JSON.stringify({
    model,
    temperature: 0,
    response_format: {
      type: "json_object"
    },
    messages: [
      {
        role: "system",
        content: ENTITY_SYSTEM_PROMPT
      },
      {
        role: "user",
        content: `Article:\n${text}`
      }
    ]
  });
  const MAX_RETRIES = 2;
  for(let attempt = 0; attempt <= MAX_RETRIES; attempt++){
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body
      });
      // Retryable: rate limit or transient server error
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 500 * Math.pow(2, attempt);
        if (attempt < MAX_RETRIES) {
          log("warn", "OpenAI throttled/transient — retrying", {
            status: response.status,
            attempt,
            waitMs
          });
          await sleep(waitMs);
          continue;
        }
        log("warn", "OpenAI entity extraction failed after retries", {
          status: response.status
        });
        return null;
      }
      if (!response.ok) {
        log("warn", "OpenAI entity extraction failed", {
          status: response.status,
          error: (await response.text()).slice(0, 200)
        });
        return null;
      }
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;
      const entities = JSON.parse(content);
      return {
        people: Array.isArray(entities.people) ? entities.people : [],
        organizations: Array.isArray(entities.organizations) ? entities.organizations : [],
        locations: Array.isArray(entities.locations) ? entities.locations : [],
        events: Array.isArray(entities.events) ? entities.events : [],
        mainTopic: entities.mainTopic || ""
      };
    } catch (err) {
      // Network/parse error — retry a couple of times, then give up
      if (attempt < MAX_RETRIES) {
        const waitMs = 500 * Math.pow(2, attempt);
        log("warn", "Entity extraction error — retrying", {
          error: err?.message ?? String(err),
          attempt,
          waitMs
        });
        await sleep(waitMs);
        continue;
      }
      log("error", "Entity extraction exception", {
        error: err?.message ?? String(err)
      });
      return null;
    }
  }
  return null;
}
// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
export async function run(ctx) {
  const { log, shouldStop } = ctx;
  log("info", "🚀 EXTRACT-ENTITIES START", {
    ts: new Date().toISOString()
  });
  // ── Step 1: Environment ────────────────────────────────────────────────────
  log("info", "📋 STEP 1: Loading environment", {});
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
  const WINDOW_HOURS = envInt("ENTITY_WINDOW_HOURS", 72);
  const BATCH_LIMIT = envInt("ENTITY_BATCH_LIMIT", 300);
  const CONCURRENCY = envInt("ENTITY_CONCURRENCY", 10);
  const MAX_ATTEMPTS = envInt("ENTITY_MAX_ATTEMPTS", 3);
  const ENTITY_MODEL = envStr("ENTITY_MODEL", "gpt-4o-mini");
  log("info", "✅ Configuration loaded", {
    windowHours: WINDOW_HOURS,
    batchLimit: BATCH_LIMIT,
    concurrency: CONCURRENCY,
    maxAttempts: MAX_ATTEMPTS,
    model: ENTITY_MODEL,
    hasOpenAI: !!OPENAI_API_KEY,
    hasSupabaseUrl: !!SUPABASE_URL,
    hasServiceRole: !!SERVICE_ROLE
  });
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    log("error", "❌ Missing SUPABASE_URL or SERVICE_ROLE", {});
    return {
      extracted: 0,
      attempted: 0,
      skipped: 0,
      failed: 1,
      errors: [
        "Missing env vars"
      ]
    };
  }
  if (!OPENAI_API_KEY) {
    log("error", "❌ OPENAI_API_KEY not set", {});
    return {
      extracted: 0,
      attempted: 0,
      skipped: 0,
      failed: 1,
      errors: [
        "OPENAI_API_KEY not set"
      ]
    };
  }
  // ── Step 2: Supabase client ────────────────────────────────────────────────
  log("info", "📋 STEP 2: Connecting to Supabase", {});
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: {
      persistSession: false
    }
  });
  const errors = [];
  let failed = 0, skipped = 0, attempted = 0, extracted = 0;
  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
  // ── Step 3: Window inventory ───────────────────────────────────────────────
  log("info", "📋 STEP 3: Window inventory", {});
  const { count: totalInWindow } = await sb.from("ingestion_queue").select("*", {
    count: "exact",
    head: true
  }).gte("created_at", sinceIso).not("embedding", "is", null).eq("embed_status", "done");
  log("info", "✅ Window inventory", {
    sinceIso,
    totalEmbedded: totalInWindow ?? 0
  });
  // ── Step 4: Select candidates ──────────────────────────────────────────────
  // Only rows with embeddings but missing entities, within attempt cap
  log("info", "📋 STEP 4: Selecting rows missing entities", {});
  const { data: rows, error: selErr } = await sb.from("ingestion_queue").select("id, title, summary, raw, normalized, url, entity_attempts").gte("created_at", sinceIso).not("embedding", "is", null).eq("embed_status", "done").is("entities", null).lt("entity_attempts", MAX_ATTEMPTS).order("created_at", {
    ascending: false
  }).limit(BATCH_LIMIT);
  if (selErr) {
    log("error", "❌ Select failed", {
      error: selErr.message
    });
    return {
      extracted: 0,
      attempted: 0,
      skipped: 0,
      failed: 1,
      errors: [
        `select_failed: ${selErr.message}`
      ]
    };
  }
  const candidates = rows ?? [];
  log("info", candidates.length === 0 ? "✅ Nothing to extract" : "✅ Candidates loaded", {
    count: candidates.length
  });
  if (candidates.length === 0) {
    return {
      extracted: 0,
      attempted: 0,
      skipped: 0,
      failed: 0
    };
  }
  // ── Step 5: Extract entities concurrently ─────────────────────────────────
  log("info", "📋 STEP 5: Extracting entities", {
    total: candidates.length,
    concurrency: CONCURRENCY
  });
  await mapLimit(candidates, CONCURRENCY, async (row)=>{
    if (shouldStop()) {
      skipped++;
      return;
    }
    attempted++;
    const entities = await extractEntities(row, OPENAI_API_KEY, ENTITY_MODEL, log);
    // Always increment attempt counter, even on failure
    const patch = {
      entity_attempts: (row.entity_attempts ?? 0) + 1
    };
    if (entities) {
      patch.entities = entities;
    } else {
      failed++;
      errors.push(`entity_extraction_failed:${row.id}`);
    }
    const { error: updErr } = await sb.from("ingestion_queue").update(patch).eq("id", row.id);
    if (updErr) {
      log("warn", "⚠️ Failed to save entities", {
        id: row.id,
        error: updErr.message
      });
      failed++;
      errors.push(`update_failed:${row.id}:${updErr.message}`);
      return;
    }
    if (entities) {
      extracted++;
      if (extracted % 20 === 0) {
        log("info", "🔄 Extraction progress", {
          extracted,
          attempted,
          remaining: candidates.length - attempted
        });
      }
    }
  });
  log("info", "🎉 EXTRACT-ENTITIES COMPLETE", {
    extracted,
    attempted,
    skipped,
    failed,
    errorsCount: errors.length
  });
  return {
    extracted,
    attempted,
    skipped,
    failed,
    ...errors.length ? {
      errors
    } : {}
  };
}
