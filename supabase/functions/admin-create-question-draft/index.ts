// supabase/functions/admin-create-question-draft/index.ts
//
// v10 — Epic QF authoring merged into creation (single LLM call)
//   • v10.2: added open/definitional closes ("mean to you", "tell you about", etc.) to
//     FORBIDDEN_PHRASES — these aren't slider-compatible and the self-score can miss them.
//   • v10.1: a REJECTED existing draft no longer blocks re-creation — the idempotency
//     guard deletes it (+ audience_fit) and re-authors, so "Reject → Create again" works.
//
// WHAT CHANGED FROM v9.2:
//   • The question is now AUTHORED directly in the Epic QF house style — Context +
//     Tension + accountability-first stance trigger, slider-compatible — in ONE LLM call,
//     instead of producing a 7-template "raw" question that the reframe pass then rewrote.
//   • System prompt is loaded at runtime from ai_prompts (key "question_reframing") — the
//     SAME prompt the reframe function uses — so the two paths cannot drift. Hardcoded
//     QF prompt is the fallback. A small addendum tells the model it is AUTHORING from
//     news context (not rewriting) and to also emit scope, location_label, audience_fit.
//   • Ported reframe's deterministic gates (forbidden-phrase, word-count, slider labels)
//     and its quality_score; gate failures are flagged (qa_passed=false + quality_notes)
//     but NOT hard-rejected — every draft lands as status='needs_review' for a human pass.
//   • Replaced the old canned guardrail fallback (which itself listed options — a rule
//     violation) entirely.
//   • Provider abstraction (OpenAI | Anthropic) + maxRetries/timeout ported from reframe,
//     so framing can run on a stronger model and transient throttles don't drop to fallback.
//   • Writes the QF columns (framing_style, core_tension, primary/secondary_value,
//     slider_low/high_label, question_quality_score, quality_notes, raw_question) via a
//     follow-up UPDATE after the existing RPC insert. Status is left at the RPC default
//     ('draft') — no needs_review state, so the UPDATE can't trip a status constraint.
//
// Provider control (Edge Function secrets):
//   QGEN_MODEL_PROVIDER   "openai" (default) | "anthropic"
//   QGEN_MODEL_NAME       OpenAI:    "gpt-4o-mini" (default) | "gpt-4o"
//                         Anthropic: "claude-sonnet-4-20250514" (default for anthropic)
//
// Auth: admin user JWT via is_admin_me() (unchanged — single manual/bulk-per-item call)
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4.57.0";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.3";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
// ── Location label allowlist ──────────────────────────────────────────────────
const KNOWN_LOCATION_LABELS = new Set([
  "Global","United States","United Kingdom","UK","India","Canada","Australia","Germany",
  "France","Italy","Spain","Japan","China","Brazil","Mexico","South Africa","Nigeria",
  "Kenya","Pakistan","Bangladesh","Indonesia","Philippines","Vietnam","Thailand","Malaysia",
  "Singapore","Israel","Palestine","Ukraine","Russia","Turkey","Iran","Saudi Arabia","UAE",
  "Egypt","Argentina","Colombia","Chile","Peru","Poland","Netherlands","Belgium","Sweden",
  "Norway","Denmark","Finland","Switzerland","Austria","Portugal","Greece","Czech Republic",
  "Romania","Hungary","Ireland","New Zealand","California","Texas","New York","Florida",
  "Illinois","Pennsylvania","Ohio","Georgia","North Carolina","Michigan","Virginia",
  "Washington","Europe","Asia","Africa","Middle East","Latin America","Southeast Asia",
  "South Asia","East Asia","North America"
]);
function sanitizeLocationLabel(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (KNOWN_LOCATION_LABELS.has(trimmed)) return trimmed;
  for (const known of KNOWN_LOCATION_LABELS){
    if (known.toLowerCase() === trimmed.toLowerCase()) return known;
  }
  return null;
}
// ── v11: scope-gated location + audience from the event-based signal ───────────
// Reserve "Global" for genuinely multinational events. A global-scoped event whose
// dominant country owns >= 50% of the named-place mentions collapses to that country
// (bilateral / single-country foreign events); otherwise it stays Global.
const GLOBAL_OWNERSHIP_THRESHOLD = 0.5;
function normalizeCountryLabel(label) {
  if (!label) return label;
  const l = String(label).trim().toLowerCase();
  if (["usa","us","u.s.","u.s","united states of america","america"].includes(l)) return "United States";
  if (["uk","britain","great britain"].includes(l)) return "United Kingdom";
  if (["global","worldwide","international"].includes(l)) return "Global";
  return String(label).trim();
}
function resolveScopedLocation(scope, sigCountry, sigLocality, sigEntityCounts, proposedFallback) {
  // No signal (legacy draft) → keep the old proposed/fallback behavior.
  if (!sigCountry) {
    if (scope === "global") return "Global";
    if (scope === "national" && proposedFallback && proposedFallback.includes(",")) {
      const parts = proposedFallback.split(",").map((p)=>p.trim()).filter(Boolean);
      return parts.length ? parts[parts.length - 1] : proposedFallback;
    }
    return proposedFallback || null;
  }
  const country = normalizeCountryLabel(sigCountry);
  if (scope === "local") return sigLocality ? `${sigLocality}, ${country}` : country;
  if (scope === "national") return country;
  // scope === "global": Global only if the event is genuinely spread across countries.
  if (sigEntityCounts) {
    const total = Object.values(sigEntityCounts).reduce((a, b)=>a + b, 0) || 1;
    const share = (sigEntityCounts[sigCountry] ?? 0) / total;
    return share >= GLOBAL_OWNERSHIP_THRESHOLD ? country : "Global";
  }
  return "Global";
}
// audience_location is country-granular (the feed targets by country / Global): use the
// event's dominant country, or Global when the display location resolved to Global.
function audienceFromLocation(resolvedLabel, sigCountry) {
  if (resolvedLabel === "Global") return { audience_label: "Global", reason: "Multinational event; global relevance." };
  const c = normalizeCountryLabel(sigCountry ?? resolvedLabel);
  // If the resolved label is "Locality, Country", take the country for audience targeting.
  const country = c && c.includes(",") ? c.split(",").map((p)=>p.trim()).pop() : c;
  return { audience_label: country || "Global", reason: "Audience matches the country where the event occurred." };
}
// ── Audience location heuristic (legacy fallback for drafts with no location signal) ──
function inferAudienceLocation(questionText, summary, tags, originLabel) {
  const lower = [questionText, summary ?? "", (tags ?? []).join(" ")].join(" ").toLowerCase();
  const globalEntities = /(iran|israel|nato|united nations|worldwide|international|global|russia|china|ukraine|hamas|hezbollah|war between|conflict between|multinational)/;
  const usPresence = /(\bu\.?s\.?\b|united states|america|military|strike|sanction)/;
  if (globalEntities.test(lower) && usPresence.test(lower)) {
    return { audience_label: "Global", reason: "International conflict or multinational issue; global relevance." };
  }
  const federalKeywords = /(white house|congress|senate|supreme court|pentagon|federal government|president trump|president biden|immigration policy|federal law|national security|us military|department of\b|cabinet|executive order|sanctions|foreign policy)/;
  if (federalKeywords.test(lower)) {
    return { audience_label: "United States", reason: "Federal policy decision; national relevance." };
  }
  return { audience_label: originLabel ?? "Global", reason: "Local/regional issue; audience matches origin." };
}
// ── Epic QF: deterministic gates (ported from reframe) ─────────────────────────
const VALID_FRAMING_STYLES = new Set([
  "value_tradeoff","risk_vs_risk","boundary_line","trust_authority",
  "future_consequence","moral_consistency","personal_stake","evidence_threshold"
]);
const QUALITY_THRESHOLD = 8;
const MAX_WORDS = 65;
const FORBIDDEN_PHRASES = [
  "do you support","are you for","are you against","should the government","should we",
  "face a genuine bind","faces a genuine bind","the tension is real","how much should",
  "which approach do you trust","what principle guides","what matters more to you",
  "which matters most","what matters most to you","do you prioritise","do you prioritize",
  "a, b, or c","x or y",
  // v10.2 — open/definitional closes are not slider-compatible (caught even if self-score passes)
  "mean to you","tell you about","what does that tell you","what does this tell you","how do you define"
];
function checkForbidden(question) {
  const lower = question.toLowerCase();
  return FORBIDDEN_PHRASES.find((p)=>lower.includes(p)) ?? null;
}
function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
// ── Audience fit parsing (unchanged from v9.2) ─────────────────────────────────
const VALID_SEGMENT_KEYS = new Set([
  "general","college_students","recent_graduates","working_professionals","parents",
  "voters","first_time_voters","healthcare_workers","patients","taxpayers","local_residents"
]);
const VALID_TIERS = new Set(["direct","adjacent","general"]);
function parseAudienceFit(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [{ audience_key: "general", tier: "general", reason: "AI did not produce audience_fit — fallback general assigned." }];
  }
  const valid = [];
  for (const entry of raw){
    if (typeof entry !== "object" || entry === null) continue;
    const key = String(entry.audience_key ?? "").trim().toLowerCase();
    const tier = String(entry.tier ?? "").trim().toLowerCase();
    const reason = String(entry.reason ?? "").trim().slice(0, 500);
    if (!VALID_SEGMENT_KEYS.has(key)) { console.warn(`[audience_fit] Unknown segment key '${key}' — skipping`); continue; }
    if (!VALID_TIERS.has(tier)) {
      console.warn(`[audience_fit] Invalid tier '${tier}' for key '${key}' — defaulting to general`);
      valid.push({ audience_key: key, tier: "general", reason }); continue;
    }
    valid.push({ audience_key: key, tier, reason });
  }
  if (valid.length === 0) {
    return [{ audience_key: "general", tier: "general", reason: "All AI audience_fit entries were invalid — fallback general assigned." }];
  }
  const seen = new Set();
  return valid.filter((e)=>{ if (seen.has(e.audience_key)) return false; seen.add(e.audience_key); return true; }).slice(0, 5);
}
async function writeAudienceFitRows(supabaseAdmin, draftId, audienceFit) {
  if (audienceFit.length === 0) return;
  const keys = audienceFit.map((e)=>e.audience_key);
  const { data: segments, error: segErr } = await supabaseAdmin.from("audience_segments").select("id, key").in("key", keys).eq("status", "active");
  if (segErr) { console.warn("[audience_fit] Failed to resolve segment UUIDs (non-fatal):", segErr); return; }
  const keyToId = new Map((segments ?? []).map((s)=>[s.key, s.id]));
  const rows = audienceFit.map((e)=>{
    const segmentId = keyToId.get(e.audience_key);
    if (!segmentId) { console.warn(`[audience_fit] Segment key '${e.audience_key}' not found in DB — skipping`); return null; }
    return { question_draft_id: draftId, audience_segment_id: segmentId, relevance_tier: e.tier, reason: e.reason || null, source: "ai_pipeline", reviewed_by_admin: false };
  }).filter((r)=>r !== null);
  if (rows.length === 0) { console.warn("[audience_fit] No valid rows to insert after UUID resolution"); return; }
  const { error: insertErr } = await supabaseAdmin.from("question_draft_audience_fit").insert(rows);
  if (insertErr) console.warn("[audience_fit] Insert failed (non-fatal):", insertErr);
  else console.log(`[audience_fit] Wrote ${rows.length} row(s) for draft ${draftId}`);
}
// ── Hardcoded QF prompt (fallback when ai_prompts has no active question_reframing) ──
// Kept in sync with reframe/logic.ts HARDCODED_REFRAME_PROMPT. The OUTPUT_ADDENDUM below
// adapts it for first-pass authoring and adds scope/location_label/audience_fit.
const HARDCODED_QF_PROMPT = `You are a civic question framing specialist. Your job is to take a raw draft question and rewrite it so it reads like a genuine reflection prompt — the kind a smart friend would ask over coffee, not a policy exam or a briefing document.

CORE RULE:
Do not ask users to choose an action. Ask them to reveal the principle behind the action.

REQUIRED STRUCTURE — every question must have all three parts:
1. Context: ONE short concrete sentence — a specific number, name, or recent event. Not a general policy description. Must be specific enough that the user immediately knows what real situation this is about.
2. Tension: ONE sentence showing the mechanism — not just "risks X" but WHY action A leads to outcome B. If both options are obviously necessary, find the underlying failure, root cause, or accountability gap instead.
3. Stance trigger: ONE question ending with "you" — never "governments", "institutions", or "countries". Must resolve into a single spectrum. Always ask about accountability first: why did this happen, what could have prevented it, who was responsible, did they do their job.

LENGTH: Target 30–45 words. 65 words is the hard ceiling, not the goal. Every word must earn its place.

PROHIBITED:
- Do not end with "Should [actor] do A, B, or C?"
- Do not list policy options as a menu
- Do not use parenthetical risk disclaimers after options, e.g. "(risking escalation)"
- Do not use "Do you support", "Are you for/against", "Should the government", "Should we"
- Do not use "face a genuine bind", "faces a genuine bind", or "The tension is real" — these are canned phrases
- Do not use "How much should [actor/country/institution]..." — always close with "you"
- Do not use "Which approach do you trust most" or "What principle guides you" — too abstract
- Do not tell the user what the correct moral answer is
- Do not ask two questions at once
- Do not exceed 65 words total
- Do not start sentence 2 with "This raises", "This situation creates", "This presents", or "This creates"
- Do not call out a person's nationality or ethnicity unless it is directly relevant to the tension
- Do not use academic vocabulary — avoid "destabilization", "prosecution frameworks", "institutional disruption", "implementation errors", "unintended consequences" — say what you mean in plain words
- CRITICAL — SLIDER COMPATIBILITY: Do not ask the user to choose between named options or rank competing values. The stance trigger must always resolve into a single spectrum. Every question must be answerable with "I strongly oppose this direction" through "I strongly support this direction."
- CRITICAL — TOPIC QUALITY GATE: If the topic title provided is a generic category label (e.g. "Infrastructure Investment Policy", "Foreign Investment Policy") rather than a specific news event, set quality_score to 0 and quality_notes to "topic_too_generic — needs specific news headline before reframing". Do not attempt to reframe.

GROUNDING RULES:
- Always anchor to WHERE the event happened, not where the person involved came from
- A single human story is more powerful than a statistic alone — lead with the person, follow with the scale
- Check the actual state of play: if a decision has already been made, a law passed, or a court has ruled — start from that reality, not from an open question
- When a court or independent body has had to intervene, the real question is about political failure — why did it take this long
- When an incident is part of a repeated pattern, zoom out to the pattern — that is where the real stance lives
- Name the specific accountable person responsible for the location — never leave it as "senior officials" or "politicians"
- When something basic has been ignored by elected officials, frame it as a failure of duty

FRAMING STYLES — choose one that best fits the topic:
- value_tradeoff: Surface the competing values and ask what the user prioritises
- risk_vs_risk: Ask which of two genuine risks worries them more
- boundary_line: Ask where their personal limit sits on a spectrum
- trust_authority: Ask who they trust to make the call
- future_consequence: Ask which long-term outcome matters most
- moral_consistency: Ask what principle should carry the most weight
- personal_stake: Ask if their view changes when it affects them directly
- evidence_threshold: Ask what evidence would most shift their thinking

POLICY-TO-VALUE CONVERSION:
Ban it → Safety / consistency / moral boundary
Leave it to states → Local control / federalism / democratic choice
Increase military presence → Security / deterrence / stability
Impose sanctions → Accountability / economic leverage
Stay silent → Political caution / restraint
Condemn publicly → Moral clarity / social responsibility
Regulate → Oversight / public protection
Deregulate → Freedom / market efficiency

REGISTER:
Write as if explaining to a smart friend, not drafting a policy brief. Translate economic or technical concepts into what they mean for an ordinary person's daily life — jobs, prices, household budgets, safety. Replace vague phrases with what actually happened. If a simpler word exists, use it.

VARIETY REQUIREMENT:
Each question must feel distinctly written — not templated. Avoid repeating sentence structures across questions. The stance trigger must be phrased freshly each time.

OUTPUT — return ONLY valid JSON, no markdown, no backticks:
{
  "question": "Reframed question (target 30–45 words, max 65)",
  "framing_style": "one of the 8 styles above",
  "core_tension": "one sentence describing the competing values",
  "primary_value": "e.g. national_security",
  "secondary_value": "e.g. global_safety",
  "slider_low_label": "3-6 word noun phrase for the oppose end of the slider — e.g. 'Protect individuals from exploitation'. Never 'Strongly oppose'.",
  "slider_high_label": "3-6 word noun phrase for the support end of the slider — e.g. 'Accept security trade-offs'. Never 'Strongly support'.",
  "quality_score": <number 0-10>,
  "quality_notes": "brief reason for score"
}

QUALITY SCORING (0–10):
- Concrete, specific context (a real event, name, or number — not a category): 2 points
- Neutral plain language (no academic vocabulary, no loaded terms): 2 points
- Clear tension with visible mechanism (shows WHY, not just THAT): 2 points
- Slider-compatible stance trigger ending with "you" (single spectrum, not a menu): 2 points
- Concise — at or under 45 words scores full point, 46–65 words scores half: 1 point
- Variety — fresh phrasing, not templated: 1 point

HARD REQUIREMENT: A question scoring 0 on slider compatibility must be flagged regardless of total score. A question on a generic topic (quality_score = 0) must also be flagged.

Minimum acceptable score: 8. Flag anything below 8 in quality_notes.`;
// Addendum: adapts the QF prompt for first-pass AUTHORING and adds the fields this
// function needs that the QF prompt alone doesn't emit (scope, location_label, audience_fit).
const OUTPUT_ADDENDUM = `

────────────────────────────────────────────────────────
AUTHORING MODE (overrides the "rewrite a raw question" framing above):
You are AUTHORING a brand-new stance question directly from the news context provided in the user message. There is no prior draft to rewrite. Every structural rule, prohibition, grounding rule, framing style, register, and scoring rule above applies UNCHANGED to the question you author.

NAME GROUNDING (strict): Name only people, places, organisations, and numbers that appear in the provided context/summary/headline. Do NOT introduce any named individual from your own background knowledge. If the responsible official is not named in the context, refer to the office (e.g. "the state government") rather than guessing a name.

EXTRA OUTPUT FIELDS — in addition to the JSON keys specified above, your JSON object MUST also include:
  "scope": "global" | "national" | "local"   (global: climate/AI/tech/international/pandemics/space/human rights; national: federal/country-wide policy/elections; local: city/state/regional)
  "location_label": "Geographic label for the event"
  "audience_fit": [ { "audience_key": "...", "tier": "direct|adjacent|general", "reason": "..." } ]

AUDIENCE FIT RULES:
Use only these exact keys: general, college_students, recent_graduates, working_professionals, parents, voters, first_time_voters, healthcare_workers, patients, taxpayers, local_residents.
- direct: this audience finds the question centrally relevant to their life
- adjacent: peripheral interest
- general: broad public interest only
Always include "general" with tier "general" as the last entry. Maximum 4 entries total (3 specific + general). Only tag a segment as "direct" if the question genuinely affects their daily life.

Return ONLY the single valid JSON object with all keys (question, framing_style, core_tension, primary_value, secondary_value, slider_low_label, slider_high_label, quality_score, quality_notes, scope, location_label, audience_fit). No markdown, no backticks.`;
function parseQfResult(raw) {
  try {
    const clean = String(raw).replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!parsed.question || typeof parsed.question !== "string") return null;
    return {
      question: parsed.question.trim(),
      framing_style: parsed.framing_style?.trim() ?? "value_tradeoff",
      core_tension: parsed.core_tension?.trim() ?? "",
      primary_value: parsed.primary_value?.trim() ?? "",
      secondary_value: parsed.secondary_value?.trim() ?? "",
      slider_low_label: parsed.slider_low_label?.trim() ?? null,
      slider_high_label: parsed.slider_high_label?.trim() ?? null,
      quality_score: typeof parsed.quality_score === "number" ? Math.max(0, Math.min(10, parsed.quality_score)) : 0,
      quality_notes: parsed.quality_notes?.trim() ?? "",
      scope: parsed.scope?.toString().toLowerCase().trim() ?? "national",
      location_label: parsed.location_label?.toString().trim() ?? null,
      audience_fit: Array.isArray(parsed.audience_fit) ? parsed.audience_fit : null
    };
  } catch {
    return null;
  }
}
// ── Provider abstraction with retries (ported from reframe + maxRetries) ───────
async function callLLM(provider, modelName, systemPrompt, userPrompt, apiKey) {
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey, maxRetries: 4 });
    const message = await client.messages.create({
      model: modelName, max_tokens: 1024, temperature: 0.7,
      system: systemPrompt, messages: [{ role: "user", content: userPrompt }]
    });
    if (!message.content || message.content.length === 0) {
      throw new Error(`Anthropic returned empty content array. Check model name: "${modelName}". Stop reason: ${message.stop_reason ?? "unknown"}`);
    }
    const block = message.content[0];
    if (block.type !== "text") throw new Error(`Anthropic returned non-text content block: type="${block.type}"`);
    return block.text.trim();
  }
  // Default: OpenAI
  const client = new OpenAI({ apiKey, maxRetries: 4, timeout: 30_000 });
  const completion = await client.chat.completions.create({
    model: modelName, temperature: 0.7,
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]
    // NOTE: no response_format here — the Anthropic path can't use it and the QF prompt
    // already instructs strict JSON; parseQfResult strips any stray backticks defensively.
  });
  return completion.choices[0]?.message?.content?.trim() ?? "";
}
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
    const accessToken = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!supabaseUrl || !anonKey) return jsonResponse({ error: "Server misconfigured: Supabase env vars missing" }, 500);
    if (!serviceRoleKey) return jsonResponse({ error: "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing" }, 500);

    // Provider selection
    const rawProvider = (Deno.env.get("QGEN_MODEL_PROVIDER") ?? "openai").toLowerCase().trim();
    const provider = rawProvider === "anthropic" ? "anthropic" : "openai";
    const defaultModel = provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o-mini";
    const modelName = (Deno.env.get("QGEN_MODEL_NAME") ?? defaultModel).trim();
    const apiKey = provider === "anthropic" ? anthropicKey : openaiApiKey;

    const supabaseAuth = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    // 1) Verify admin
    const { data: isAdmin, error: adminError } = await supabaseAuth.rpc("is_admin_me");
    if (adminError) return jsonResponse({ error: "Failed to verify admin status" }, 500);
    if (!isAdmin) return jsonResponse({ error: "Forbidden" }, 403);

    // 2) Parse body
    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    if (!body?.topic_draft_id) return jsonResponse({ error: "topic_draft_id is required" }, 400);
    const topicDraftId = String(body.topic_draft_id);

    // 2b) Idempotency guard
    {
      const { data: existing, error: exErr } = await supabaseAdmin.from("question_drafts")
        .select("id, topic_draft_id, question, summary, tags, location_label, scope, status, guardrail_flags, qa_passed, created_at")
        .eq("topic_draft_id", topicDraftId).maybeSingle();
      if (exErr) {
        console.warn("Idempotency check failed (continuing):", exErr);
      } else if (existing?.id && existing.status === "rejected") {
        // Rejected → the admin wants a fresh question. Delete the old draft (and its
        // audience_fit children, in case there's no ON DELETE CASCADE) and fall through
        // to re-author. This is what lets a rejected draft be regenerated.
        await supabaseAdmin.from("question_draft_audience_fit").delete().eq("question_draft_id", existing.id);
        const { error: delErr } = await supabaseAdmin.from("question_drafts").delete().eq("id", existing.id);
        if (delErr) {
          console.error("Failed to delete rejected draft before re-create:", delErr);
          return jsonResponse({ error: "Failed to replace rejected draft", details: delErr.message }, 500);
        }
        console.log(`Replaced rejected question_draft ${existing.id} for topic ${topicDraftId} — re-authoring.`);
        // (fall through — no return — so a fresh draft is created below)
      } else if (existing?.id) {
        // Non-rejected existing draft → keep idempotent behavior (return it, backfill cover)
        const { error: coverErr } = await supabaseAdmin.rpc("assign_question_draft_cover", { p_draft_id: existing.id });
        if (coverErr) console.warn("assign_question_draft_cover (existing) failed:", coverErr);
        return jsonResponse({ ok: true, existing: true, draft: existing }, 200);
      }
    }

    // 3) Load topic_draft + news context
    const { data: topicDraft, error: tdError } = await supabaseAdmin.from("topic_drafts").select(`
        id, news_item_id, title, summary, tags, location_label, ai_input,
        news_items ( id, title, summary, url, published_at )
      `).eq("id", topicDraftId).single();
    if (tdError) return jsonResponse({ error: "Failed to load topic draft", details: tdError?.message ?? String(tdError), code: tdError?.code ?? null }, 500);
    if (!topicDraft) return jsonResponse({ error: "Topic draft not found" }, 404);

    const baseQuestionTitle = topicDraft.title ?? "Untitled topic";
    const baseSummary = topicDraft.summary ?? "Summary not available.";
    // v11: prefer the event-based location signal produced by create-topic-drafts (v6).
    // Its labels (e.g. "Tamil Nadu, India") are intentionally NOT in the allowlist, so we
    // trust the signal directly and only sanitize the raw label for legacy (pre-v6) drafts.
    const locSignal = (topicDraft.ai_input && topicDraft.ai_input.location_signal) || null;
    const sigCountry = locSignal?.country ?? null;
    const sigLocality = locSignal?.locality ?? null;
    const sigEntityCounts = locSignal?.country_entity_counts ?? null;
    const baseLocation = locSignal
      ? (sigLocality ? `${sigLocality}, ${sigCountry}` : sigCountry)
      : sanitizeLocationLabel(topicDraft.location_label ?? null);
    const baseTags = Array.isArray(topicDraft.tags) ? topicDraft.tags : [];
    const news = topicDraft.news_items ?? null;
    const newsHeadline = news?.title ?? "(none)";

    const aiInput = {
      topic_draft_id: topicDraft.id, topic_title: topicDraft.title, topic_summary: topicDraft.summary,
      topic_tags: topicDraft.tags, location_label: topicDraft.location_label, news_item: news,
      provider, model: modelName
    };
    const cleanTags = (arr)=>Array.from(new Set((arr ?? []).map((t)=>String(t ?? "").trim()).filter(Boolean))).slice(0, 8);
    const clampText = (s, max = 120)=>{ const str = String(s ?? "").trim(); return str.length > max ? str.slice(0, max).trim() : str; };
    const normalizeScope = (s)=>{ const v = String(s ?? "").toLowerCase().trim(); return (v === "global" || v === "national" || v === "local") ? v : "national"; };

    // Output state
    let question, summary, tags, locationLabel, scope = "national", aiOutput;
    let guardrailFlags = [], qaPassed = true;
    let framingStyle = null, coreTension = "", primaryValue = "", secondaryValue = "";
    let sliderLow = null, sliderHigh = null, qualityScore = null, qualityNotes = "";
    let audienceFitRaw = null;
    let audienceLocationLabel = "Global", audienceReason = "";

    if (!apiKey) {
      // No key → minimal fallback, flagged for review
      console.warn(`Missing API key for provider '${provider}', using fallback question.`);
      question = `${baseQuestionTitle}: Looking at what happened here, where do you land — and who do you think is responsible for getting it right?`;
      summary = baseSummary; tags = cleanTags(baseTags);
      locationLabel = baseLocation ? clampText(baseLocation, 80) : null;
      qaPassed = false; qualityNotes = "no_api_key — authored fallback, needs manual reframe";
      aiOutput = { skipped: `missing_${provider}_api_key` };
      const fb = inferAudienceLocation(question, summary, tags, locationLabel);
      audienceLocationLabel = fb.audience_label; audienceReason = fb.reason;
    } else {
      // Load house-style prompt from ai_prompts (same key reframe uses) + authoring addendum
      let activeSystemPrompt = HARDCODED_QF_PROMPT;
      let activePromptId = null;
      try {
        const { data: promptRow, error: promptErr } = await supabaseAdmin.from("ai_prompts")
          .select("id, system_prompt").eq("prompt_key", "question_reframing").eq("is_active", true).maybeSingle();
        if (promptErr) console.warn("ai_prompts.read_failed_using_hardcoded:", promptErr.message);
        else if (promptRow) { activeSystemPrompt = promptRow.system_prompt ?? HARDCODED_QF_PROMPT; activePromptId = promptRow.id ?? null; }
      } catch (e) { console.warn("ai_prompts.exception_using_hardcoded:", e?.message); }
      const systemPrompt = activeSystemPrompt + OUTPUT_ADDENDUM;

      const userPrompt =
        `Author a stance question from this news context.\n\n` +
        `Topic label: ${topicDraft.title ?? "(none)"}\n` +
        `News headline (the specific event): ${newsHeadline}\n` +
        `Context (synthesised from all cluster articles): ${topicDraft.summary ?? "(none)"}\n` +
        `Tags: ${JSON.stringify(topicDraft.tags ?? [])}\n` +
        `Location: ${topicDraft.location_label ?? "(none)"}\n\n` +
        `Instructions:\n` +
        `1. Use the news headline and context as your primary anchor — root the question in this specific event, not the general topic label.\n` +
        `2. If the topic label is a generic category (not a specific event), set quality_score = 0 and quality_notes = "topic_too_generic".\n` +
        `3. Check the state of play: if a decision has already been made or a court has ruled, start from that reality.\n` +
        `4. Name only people/places/numbers that appear in the context above — never introduce names from your own knowledge.\n` +
        `5. Use the Context + Tension + accountability-first stance trigger structure, ending with "you". Target 30–45 words.\n` +
        `6. Choose the single best framing style.\n` +
        `Return ONLY the JSON object with all required keys.`;

      try {
        const rawText = await callLLM(provider, modelName, systemPrompt, userPrompt, apiKey);
        const result = parseQfResult(rawText);
        if (!result) {
          // Parse failure → flagged fallback
          console.warn("QF parse failed; using fallback.");
          question = `${baseQuestionTitle}: Looking at what happened here, where do you land — and who do you think is responsible for getting it right?`;
          summary = baseSummary; tags = cleanTags(baseTags);
          locationLabel = baseLocation ? clampText(baseLocation, 80) : null;
          qaPassed = false; qualityNotes = "parse_failed — authored fallback, needs manual reframe";
          aiOutput = { rawText: String(rawText).slice(0, 2000), parse_failed: true, provider, model: modelName };
        } else {
          question = result.question;
          if (!question.endsWith("?")) question = `${question}?`;
          framingStyle = VALID_FRAMING_STYLES.has(result.framing_style) ? result.framing_style : "value_tradeoff";
          coreTension = result.core_tension; primaryValue = result.primary_value; secondaryValue = result.secondary_value;
          sliderLow = result.slider_low_label; sliderHigh = result.slider_high_label;
          qualityScore = result.quality_score; qualityNotes = result.quality_notes;
          scope = normalizeScope(result.scope);
          audienceFitRaw = result.audience_fit;

          // Tags: prefer topic tags (QF doesn't author tags)
          tags = cleanTags(baseTags);

          // Location: v11 scope gate on the event-based signal (falls back for legacy drafts).
          const proposedFallback = clampText(result.location_label ?? baseLocation ?? "", 80);
          locationLabel = clampText(
            resolveScopedLocation(scope, sigCountry, sigLocality, sigEntityCounts, proposedFallback) ?? "",
            80
          ) || null;

          // ── Deterministic gates (flag, do not hard-reject — drafts stay 'draft' for review) ──
          const notes = [];
          const forbidden = checkForbidden(question);
          if (forbidden) { guardrailFlags.push(`forbidden:${forbidden}`); notes.push(`forbidden phrase "${forbidden}"`); qaPassed = false; }
          const wc = countWords(question);
          if (wc > MAX_WORDS) { guardrailFlags.push("too_long"); notes.push(`${wc} words (max ${MAX_WORDS})`); qaPassed = false; }
          if (!sliderLow || !sliderHigh) { guardrailFlags.push("missing_slider_labels"); notes.push("missing slider labels"); qaPassed = false; }
          if ((qualityScore ?? 0) < QUALITY_THRESHOLD) { guardrailFlags.push("low_quality"); notes.push(`quality ${qualityScore} < ${QUALITY_THRESHOLD}`); qaPassed = false; }
          if (notes.length) qualityNotes = `${qualityNotes ? qualityNotes + " | " : ""}gate: ${notes.join("; ")}`;

          summary = clampText(result.core_tension || baseSummary, 500) || baseSummary;

          aiOutput = {
            rawText: String(rawText).slice(0, 4000), parsed: result, provider, model: modelName,
            prompt_id: activePromptId, word_count: wc, guardrail_flags: guardrailFlags,
            qa_passed: qaPassed, quality_score: qualityScore, audience_fit_raw: audienceFitRaw
          };
          const aud = sigCountry
            ? audienceFromLocation(locationLabel, sigCountry)
            : inferAudienceLocation(question, summary, tags, locationLabel);
          audienceLocationLabel = aud.audience_label; audienceReason = aud.reason;
        }
      } catch (err) {
        console.warn("LLM call failed; using fallback:", err);
        question = `${baseQuestionTitle}: Looking at what happened here, where do you land — and who do you think is responsible for getting it right?`;
        summary = baseSummary; tags = cleanTags(baseTags);
        locationLabel = baseLocation ? clampText(baseLocation, 80) : null;
        qaPassed = false; qualityNotes = "llm_error — authored fallback, needs manual reframe";
        aiOutput = { error: String(err), note: "fallback_used_due_to_llm_error", provider, model: modelName };
        const fb = inferAudienceLocation(question, summary, tags, locationLabel);
        audienceLocationLabel = fb.audience_label; audienceReason = fb.reason;
      }
    }

    // 4) Insert via existing RPC (13-param signature unchanged)
    const { data: draft, error: draftError } = await supabaseAdmin.rpc("admin_create_question_draft", {
      p_topic_draft_id: topicDraft.id,
      p_question: question,
      p_summary: summary,
      p_tags: tags,
      p_location_label: locationLabel,
      p_ai_version: "question-draft-v11-event-location",
      p_ai_input: aiInput,
      p_ai_output: aiOutput,
      p_scope: scope,
      p_guardrail_flags: guardrailFlags,
      p_qa_passed: qaPassed,
      p_audience_location_label: audienceLocationLabel,
      p_audience_reason: audienceReason
    });
    if (draftError || !draft) {
      console.error("admin_create_question_draft error:", draftError);
      return jsonResponse({ error: "Failed to create question draft", details: draftError?.message ?? String(draftError), code: draftError?.code ?? null }, 500);
    }

    // 4b) Write QF columns (RPC doesn't cover these). Status is LEFT at the RPC default
    // ('draft') — we deliberately do not set needs_review, so this UPDATE can't trip a
    // status constraint and the QF fields always persist.
    const { error: qfUpdErr } = await supabaseAdmin.from("question_drafts").update({
      raw_question: question,
      framing_style: framingStyle,
      core_tension: coreTension || null,
      primary_value: primaryValue || null,
      secondary_value: secondaryValue || null,
      slider_low_label: sliderLow,
      slider_high_label: sliderHigh,
      question_quality_score: qualityScore,
      quality_notes: qualityNotes || null
    }).eq("id", draft.id);
    if (qfUpdErr) console.warn("qf_columns_update_failed (non-fatal):", qfUpdErr.message);

    // 4c) Audience fit rows (non-fatal)
    const parsedAudienceFit = parseAudienceFit(audienceFitRaw);
    await writeAudienceFitRows(supabaseAdmin, draft.id, parsedAudienceFit);

    // 5) Cover image (non-fatal)
    const { error: coverErr } = await supabaseAdmin.rpc("assign_question_draft_cover", { p_draft_id: draft.id });
    if (coverErr) console.warn("assign_question_draft_cover failed (non-fatal):", coverErr);

    return jsonResponse({
      ok: true, existing: false, draft, status: "draft",
      framing_style: framingStyle, quality_score: qualityScore, qa_passed: qaPassed,
      guardrail_flags: guardrailFlags, audience_fit: parsedAudienceFit
    }, 200);
  } catch (err) {
    console.error("admin-create-question-draft error:", err);
    return jsonResponse({ error: "Unexpected error", details: err?.message ?? String(err), stack: err?.stack ?? null }, 500);
  }
});
