// supabase/functions/ugq-screen/index.ts
// Epic UGQ — Build Step 2 of 8: Gate 1 AI pre-screen.
//
// Internal endpoint invoked by ugq-submit. Runs a Gate 1 pass that judges
// validity, safety, duplication (against live-question candidates from the
// existing full-text search_questions RPC) and a quality score, writes a
// terminal status, updates proposer reputation — generates a fast, UNVERIFIED
// preview of how the raw text might read as a polished stance question — AND
// (Aug 2026) now PUBLISHES that preview immediately when the proposal clears
// Gate 1, instead of parking it in the admin queue. Admin review still
// happens, but in parallel (via new ugq-moderate actions: confirm_published /
// edit_published / unpublish), never blocking the proposer from going live.
//
// Auth: internal only — requires x-cron-secret == CRON_SECRET, or a service-role
// Bearer token. Never called directly by browsers.
//
// Design notes (verified against the live schema, June 2026):
//   - questions has NO embedding column; duplicate candidates come from the
//     full-text search_questions(p_query,...) RPC (live = state in
//     new/active/dormant AND status='active'). The LLM picks duplicate_question_id
//     ONLY from that candidate set, so the id is always real.
//   - auto_topic_id is now set here (Aug 2026 update): the same LLM pass is
//     asked to match against get_parent_topics_for_classification()'s candidate
//     list (>= UGQ_TOPIC_MATCH_THRESHOLD, default 0.75 — same bar
//     classify-parent-topics uses). No confident match → reuse an existing
//     topic with the same suggested title, or create one as status='pending'.
//     A 'pending' topic does NOT hide its questions from feeds — verified
//     against get_for_you_feed / get_trending_questions_homepage, neither
//     joins on topics.status — so auto-publishing against a freshly-created
//     pending topic still surfaces normally.
//   - Notification writes are intentionally deferred to build step 8 (still
//     true for the rejection notice; the published notice is sent by
//     ugq-publish itself).
//   - is_valid_question re-scoped (Aug 2026 fix): judges SUBSTANCE (is there a
//     real, identifiable civic topic here?) not FORM (is it already a
//     proposition?). Phrasing/clarity issues show up in quality_score instead.
//   - preview_reframe added (Aug 2026): a SEPARATE, lightweight, single-shot
//     LLM call — no web search, no fact-sheet, no verification loop — run in
//     PARALLEL with the Gate 1 screening call (Promise.allSettled) so it adds
//     ~0 sequential latency. Explicitly a rough draft.
//   - AUTO-PUBLISH (Aug 2026, SUPERSEDED later same week): once Gate 1 clears
//     a proposal AND the preview reframe produced usable text AND a topic
//     was resolved AND quality_score clears UGQ_AUTOPUBLISH_MIN_QUALITY,
//     ugq-screen COULD call ugq-publish itself with auto_published=true —
//     OFF by default now (UGQ_AUTOPUBLISH_ENABLED defaults "false"). Publish
//     moved to being user-confirmed instead: the proposer sees the full
//     preview and clicks Publish themselves via the new ugq-confirm-publish
//     endpoint, which triggers this exact same code path/ugq-publish call,
//     just from the user's click instead of automatically here. This block
//     is left intact — flip UGQ_AUTOPUBLISH_ENABLED=true to go back to
//     silent instant-publish without a redeploy, if ever wanted again.
//   - CONTEXT (Aug 2026, NEW): the preview call now also runs web search
//     (web_search_20250305, max 3 uses) and returns context_summary +
//     supporting_links. This is explicitly NOT fact-checking the proposer's
//     framing — the prompt is told to ADD grounding (a real number, date,
//     name) and never contradict, hedge, or cast doubt on what the user
//     wrote. If search finds nothing clearly relevant, both fields come back
//     null/empty rather than inventing something. Stored on the published
//     question via the same columns editorial/news-sourced questions already
//     use (questions.context_summary, questions.supporting_links), so
//     QuestionDetailPage's existing rendering conventions apply once wired
//     up frontend-side.
//   - MULTI-BLOCK RESPONSE FIX (Aug 2026, NEW): confirmed via production logs
//     that Claude's web-search-enabled responses can split output across
//     SEVERAL separate `text` content blocks (observed: 5 blocks in one
//     response), not just one. The previous code picked only the LAST text
//     block on the theory that interim commentary comes before the final
//     JSON answer — but a real production case showed the opposite: the
//     last block was trailing self-critique commentary ("Slider framing
//     keeps both sides accountable...") and the actual JSON answer was in
//     an earlier block, causing preview_json_parse_error and a silent
//     fallback to the no-search pass (no context_summary, no
//     supporting_links, no cover image downstream). Neither "first" nor
//     "last" is a safe assumption about where the JSON lands. Fix:
//     concatenate ALL text blocks in order (callLLM), then extract the
//     first balanced {...} substring from the joined text
//     (extractJsonObject) rather than assuming the whole string is pure
//     JSON. This turned out to be unrelated to violence/death topics
//     specifically — a Canada-US trade test proposal hit the identical
//     failure — so that earlier hypothesis is retired in favor of this one.
//   - COVER IMAGE AT PREVIEW TIME (Aug 2026, NEW): og:image/twitter:image
//     scraping used to happen only in ugq-confirm-publish, AFTER the user
//     clicked Publish — meaning the "Here's how this looks" modal never
//     showed an image even when one was available, and the proposer was
//     effectively publishing blind on that front. Moved here (see
//     attachCoverImage, called from both the normal flow and the stuck-
//     proposal retry branch) so the modal can render cover_image_url before
//     Publish is ever clicked. Same scrape technique/helpers as
//     ugq-confirm-publish used (duplicated rather than shared — Deno edge
//     functions can't import across each other, same convention already
//     used elsewhere in this codebase). ugq-confirm-publish now reuses this
//     cached result instead of re-fetching from scratch when present.
//   - USER-INITIATED REFINE (Aug 2026, NEW): a proposer reviewing their
//     preview can add extra context and get it regenerated before ever
//     publishing — see the isUserRefineRequest branch. Called via the new
//     ugq-refine-preview (user-JWT-gated, verifies ownership + status, does
//     friendly validation) rather than directly — this endpoint stays
//     internal-only. additional_context is appended onto raw_question
//     itself rather than a new column, so repeated refines and any future
//     re-screen naturally see the full accumulated context.
//   - VIDEO FRAMING GATE (Epic X, NEW): for input_mode === "video" proposals
//     only, a THIRD concurrent LLM pass (checkVideoFraming) judges whether
//     video_raw_transcript — the UNEDITED transcript of the raw audio track,
//     NOT raw_question, which the proposer may have since edited — reads as
//     leading (e.g. "isn't it obvious the mayor is corrupt for...") rather
//     than a neutral question. This exists because Epic X publishes the raw
//     clip itself: a neutral overlay/reworded question can't undo what a
//     respondent hears if they choose to play the original audio, so leading
//     framing has to be caught before publish, not patched after. A "leading"
//     result overrides every other outcome of this pass — status becomes
//     "resubmit_requested" and the proposer is asked to re-record, never
//     silently published with a neutral overlay papering over spoken bias.
//     Scoped to the main fresh-screen flow ONLY (not isUserRefineRequest or
//     isStuckPreviewRetry) — refining only edits raw_question text, it can't
//     change what's in the audio track, so re-running this check on a refine
//     would just repeat the same judgment on the same audio for no reason.
//   - DEROGATORY-LANGUAGE RECOMMENDATION (Sep 2026, NEW): checkVideoFraming
//     also independently judges whether the transcript uses language that
//     could read as derogatory/insulting toward a named person, separate
//     from the leading/neutral judgment. Deliberately informational ONLY —
//     unlike "leading", it never changes `status` or blocks publish; it's
//     surfaced in the confirm-publish response for the proposer to see as a
//     recommendation with a Re-record shortcut (see VideoPublishChoice.tsx).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Reputation deltas (spec §4.3). Bonuses for 50/200 stances are awarded later by
// a pg_cron job (build step 7), not here. approvedPublish is actually applied
// by ugq-publish itself (kept here only for reference/consistency).
const REP = { approvedPublish: 10, rejectLowQuality: -2, rejectSafety: -15 };

// Aug 2026, NEW: ceiling for the user-supplied "add more context" text on
// the refine path (see the isUserRefineRequest branch below). Kept short —
// this is a quick nudge to the LLM, not a rewrite of the whole proposal.
// ugq-refine-preview enforces a friendlier, slightly different-messaged
// version of this same limit before ever calling here; this is the hard
// backstop.
const ADDITIONAL_CONTEXT_MAX_LEN = 500;

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// new (0-20) | trusted (21-75). 'verified' is admin-granted only (spec §4.3),
// so we never auto-promote into or out of 'verified' here.
function tierForScore(score: number, currentTier: string): string {
  if (currentTier === "verified") return "verified";
  return score >= 21 ? "trusted" : "new";
}

function stripFences(s: string): string {
  return s.replace(/```json/gi, "").replace(/```/g, "").trim();
}

// Pulls the first balanced {...} object out of a string, ignoring any prose
// before or after it. Needed because a concatenated multi-block response
// (see callLLM) can have commentary on either side of the real JSON answer —
// confirmed via logs where a trailing text block was self-critique, not
// JSON. Returns null if no balanced object is found, in which case callers
// fall back to attempting JSON.parse on the raw cleaned string.
function extractJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null; // unbalanced — no closing brace found
}

// ── Cover image extraction — ported verbatim from ugq-confirm-publish's
//    og:image/twitter:image scraping (same regex patterns, same Googlebot UA
//    trick, same stream-until-</head> byte cap), which itself was adapted
//    from enrich-images/index.ts. Deno edge functions can't import across
//    each other, hence the duplication — same convention already used for
//    small pieces elsewhere in this codebase. NOT mirrored to Supabase
//    Storage — stores the direct external URL, same accepted pattern
//    news_items.image_url already uses as a fallback. ─────────────────────

const IMAGE_FETCH_TIMEOUT_MS = 6000;
const IMAGE_MAX_HTML_BYTES = 50_000;
const IMAGE_USER_AGENT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

function extractMetaContent(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function normalizeImageUrl(raw: string, baseUrl: string): string {
  try {
    if (raw.startsWith("//")) return "https:" + raw;
    if (raw.startsWith("/")) return new URL(raw, baseUrl).href;
    return raw.replace(/&amp;/g, "&").replace(/&#39;/g, "'");
  } catch {
    return raw;
  }
}

async function extractImageFromUrl(pageUrl: string): Promise<string | null> {
  let targetUrl: URL;
  try {
    targetUrl = new URL(pageUrl);
    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") return null;
  } catch {
    return null;
  }

  let html = "";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    const res = await fetch(targetUrl.href, {
      headers: { "User-Agent": IMAGE_USER_AGENT, "Accept": "text/html" },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    if (!res.ok) return null;

    const reader = res.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      let bytes = 0;
      while (bytes < IMAGE_MAX_HTML_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        bytes += value.length;
        if (html.includes("</head>")) break;
      }
      reader.cancel();
    } else {
      html = await res.text();
    }
  } catch {
    return null; // timeout, network error, etc. — best-effort, no image this time
  }

  const ogImage = extractMetaContent(html, [
    /property="og:image"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+property="og:image"/i,
    /property='og:image'\s+content='([^']+)'/i,
    /content='([^']+)'\s+property='og:image'/i,
  ]);
  if (ogImage) return normalizeImageUrl(ogImage, targetUrl.href);

  const twitterImage = extractMetaContent(html, [
    /name="twitter:image"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+name="twitter:image"/i,
    /name='twitter:image'\s+content='([^']+)'/i,
    /property="twitter:image"\s+content="([^"]+)"/i,
  ]);
  if (twitterImage) return normalizeImageUrl(twitterImage, targetUrl.href);

  return null;
}

// Tries up to 3 links CONCURRENTLY (not sequentially — bounds total added
// latency to ~IMAGE_FETCH_TIMEOUT_MS regardless of how many links there
// are), returns the first successful result in the ORIGINAL link order
// (i.e. deterministic preference for the search results' own ranking, not
// just whichever network response happened to land first).
async function findCoverImageFromLinks(links: string[]): Promise<string | null> {
  const candidates = links.slice(0, 3);
  if (candidates.length === 0) return null;
  try {
    const results = await Promise.allSettled(candidates.map((url) => extractImageFromUrl(url)));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) return r.value;
    }
  } catch (e) {
    console.error(JSON.stringify({ tag: "ugq-screen.cover_image_exception", message: (e as Error).message }));
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
  // Screening LLM is provider-configurable; defaults to Anthropic.
  //   UGQ_SCREEN_PROVIDER = "anthropic" (default) | "openai"
  //   UGQ_SCREEN_MODEL    = model id (defaults per provider)
  const SCREEN_PROVIDER =
    (Deno.env.get("UGQ_SCREEN_PROVIDER") ?? "anthropic").toLowerCase().trim() === "openai"
      ? "openai" : "anthropic";
  const MODEL = (Deno.env.get("UGQ_SCREEN_MODEL") ??
    (SCREEN_PROVIDER === "anthropic" ? "claude-sonnet-4-6" : "gpt-4o-mini")).trim();
  const SCREEN_API_KEY = SCREEN_PROVIDER === "anthropic" ? ANTHROPIC_API_KEY : OPENAI_API_KEY;
  // Preview reframe can run on a separate (typically cheaper/faster) model —
  // defaults to the same one screening uses so no extra config is required.
  const PREVIEW_MODEL = (Deno.env.get("UGQ_PREVIEW_MODEL") ?? MODEL).trim();
  console.log(JSON.stringify({
    tag: "ugq-screen.config",
    provider: SCREEN_PROVIDER,
    model: MODEL,
    preview_model: PREVIEW_MODEL,
    api_key_present: !!SCREEN_API_KEY,
    api_key_length: SCREEN_API_KEY.length, // length only — never logs the key itself
  }));
  // Fast-track for Trusted/Verified proposers — legacy, largely superseded by
  // auto-publish below (which applies regardless of tier). Left intact/off by
  // default in case auto-publish is ever disabled and this path is wanted again.
  const FASTTRACK = (Deno.env.get("FEATURE_UGQ_FASTTRACK") ?? "false") === "true";
  // Confidence floor for auto-assigning topic_match_id to auto_topic_id.
  // Matches CLASSIFY_THRESHOLD's default in classify-parent-topics for
  // consistency — same 0.75 bar for "confident enough to auto-assign."
  const TOPIC_MATCH_THRESHOLD = Number(Deno.env.get("UGQ_TOPIC_MATCH_THRESHOLD") ?? "0.75");
  // OFF switch for the preview call, in case it ever needs to be pulled
  // quickly without a full redeploy/rollback.
  const PREVIEW_ENABLED = (Deno.env.get("UGQ_PREVIEW_ENABLED") ?? "true") === "true";
  // Master switch + quality floor for instant auto-publish.
  // Aug 2026 (superseded): silent auto-publish is now OFF by default.
  // Publishing moved to being user-confirmed — the proposer sees the full
  // preview (question, both slider labels, web-search context) and clicks
  // Publish themselves, via the new ugq-confirm-publish endpoint, which
  // reuses this exact code path (calls ugq-publish with auto_published=true)
  // just triggered by the user instead of automatically here. The code below
  // is left intact and still works — flip UGQ_AUTOPUBLISH_ENABLED=true in a
  // given environment's secrets to go back to silent instant-publish without
  // a redeploy, if that's ever wanted again.
  const AUTOPUBLISH_ENABLED = (Deno.env.get("UGQ_AUTOPUBLISH_ENABLED") ?? "false") === "true";
  const AUTOPUBLISH_MIN_QUALITY = Number(Deno.env.get("UGQ_AUTOPUBLISH_MIN_QUALITY") ?? "0");

  // ── Internal auth ──────────────────────────────────────────────────────────────
  const incomingCron = req.headers.get("x-cron-secret") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const isCron = CRON_SECRET && incomingCron === CRON_SECRET;
  const isService = authHeader === `Bearer ${SERVICE_KEY}`;
  if (!isCron && !isService) return json(401, { ok: false, error: "UNAUTHORIZED" });

  const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Shared LLM caller (used for both the screening pass and the preview
  //    reframe pass — same provider plumbing, different prompt/model/tokens). ──
  async function callLLM(
    label: string, provider: "anthropic" | "openai", model: string,
    systemPrompt: string, userPrompt: string, maxTokens: number,
    enableWebSearch = false,
  ): Promise<string> {
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": SCREEN_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          // CONTEXT (Aug 2026): only the preview call passes enableWebSearch —
          // Gate 1 screening itself never needs it. max_uses=3 keeps latency
          // and cost bounded; this is a quick grounding pass, not research.
          ...(enableWebSearch ? {
            tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
          } : {}),
        }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.error(JSON.stringify({
          tag: `ugq-screen.llm_error.${label}`, provider: "anthropic",
          status: res.status, body: errBody.slice(0, 500),
        }));
        return "";
      }
      const data = await res.json();
      const blocks: Array<{ type?: string; text?: string }> = Array.isArray(data?.content) ? data.content : [];
      // CONCATENATE all text blocks, not just the last one: with web search
      // enabled, Claude can split its answer across several text blocks —
      // confirmed via logs where the LAST block was trailing commentary and
      // the real JSON answer was in an earlier one. Joining everything and
      // letting extractJsonObject() (called by the parse sites below) pull
      // out just the {...} substring is robust regardless of which block(s)
      // hold the answer. No-op for the non-search screening call (always
      // exactly one text block there).
      const textBlocks = blocks.filter((b) => b?.type === "text");
      const rawContent = textBlocks.map((b) => b?.text ?? "").join("\n");
      console.log(JSON.stringify({
        tag: `ugq-screen.anthropic_response_meta.${label}`,
        stop_reason: data?.stop_reason,
        usage: data?.usage,
        block_types: blocks.map((b) => b?.type),
        text_block_count: textBlocks.length,
      }));
      if (!rawContent) {
        console.error(JSON.stringify({
          tag: `ugq-screen.unexpected_response_shape.${label}`, provider: "anthropic",
          stop_reason: data?.stop_reason,
          raw: JSON.stringify(data).slice(0, 800),
        }));
      }
      return rawContent;
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SCREEN_API_KEY}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(JSON.stringify({
        tag: `ugq-screen.llm_error.${label}`, provider: "openai",
        status: res.status, body: errBody.slice(0, 500),
      }));
      return "";
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }

  // ── Preview generation (Aug 2026, extracted) ──────────────────────────────
  // Was inline in the main flow; pulled out so it can be: (a) tried once WITH
  // web search, (b) retried once WITHOUT search if that fails, and (c) reused
  // by the stuck-proposal recovery branch below.
  //
  // Why the fallback exists: observed real cases where Gate 1 screening
  // (sys/usr below, no search) succeeds cleanly — safety_flag='clean',
  // is_valid_question=true — on a genuine, serious civic topic, but the
  // web-search-enabled preview call for the EXACT SAME text comes back
  // empty/unparseable. ROOT CAUSE CONFIRMED (Aug 2026): Claude's web-search-
  // enabled responses can split output across several separate `text`
  // content blocks, and the JSON answer isn't reliably in any particular
  // position among them — picking only one block (first or last) can grab
  // commentary instead of the answer. This is NOT specific to any topic
  // category — reproduced on an unrelated Canada-US trade proposal too. Fix
  // is in callLLM (concatenate all text blocks) + extractJsonObject (pull
  // the balanced {...} out of the joined text) above. This fallback path is
  // left in place regardless, as defense-in-depth for genuine empty/refused
  // responses, which are a different failure mode than the parse bug.
  type PreviewReframe = {
    question: string;
    slider_low_label: string | null;
    slider_high_label: string | null;
    context_summary: string | null;
    supporting_links: string[];
    quality_notes: string;
    // Aug 2026, NEW: set by attachCoverImage AFTER generatePreviewOnce
    // returns — the LLM never produces this field itself, so it's always
    // initialized null here and overwritten (or left null) below.
    cover_image_url: string | null;
    // Sep 2026, NEW — see the language-handling instructions added to
    // generatePreviewOnce/generateRefinedPreview's prompts below. question/
    // slider_*_label above are now ALWAYS guaranteed English regardless of
    // what language the proposer wrote in (previously undefined — the model
    // just defaulted however it liked, see decision log). detected_language
    // is the ISO 639-1 code of the proposer's actual input language; the
    // _native fields are only populated when that's not "en" — the same
    // reframed question, natively phrased, for showing the proposer THEIR
    // OWN preview in their own language instead of the English canonical
    // they can't necessarily judge for accuracy.
    detected_language: string;
    question_native: string | null;
    slider_low_label_native: string | null;
    slider_high_label_native: string | null;
    // Sep 2026, NEW: context_summary above is ALWAYS English (grounding text
    // from web search, same as question/slider labels before the _native
    // fields existed) — it had no native counterpart at all, so a non-English
    // proposer's published question kept showing an English "Background"
    // section forever (get_question_localized falls back to q.context_summary
    // when the rendition's own context_summary is null, and the native-seed
    // shortcut in ugq-publish marks the rendition 'published' immediately,
    // so the async generate-question-renditions translator — which DOES
    // handle context_summary — never gets a chance to backfill it). Same
    // null-unless-non-English convention as the other _native fields.
    context_summary_native: string | null;
  };

  // Shared parse tail for any LLM call that's supposed to return a
  // PreviewReframe-shaped JSON object — used by both generatePreviewOnce
  // (fresh preview) and generateRefinedPreview (Aug 2026, NEW — see below).
  // Pulled out so both paths parse identically rather than risking drift
  // between two copies of the same logic.
  function parsePreviewJson(rawContent: string, label: string): PreviewReframe | null {
    try {
      const cleaned = stripFences(rawContent);
      // Pull the balanced {...} substring out of the (possibly multi-block,
      // possibly commentary-flanked) cleaned text; fall back to attempting
      // the raw cleaned string if no balanced object is found, so behavior
      // is unchanged for the common single-block case.
      const jsonStr = extractJsonObject(cleaned) ?? cleaned;
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      const q = typeof parsed.question === "string" ? parsed.question.trim() : "";
      if (!q) return null;
      const links = Array.isArray(parsed.supporting_links)
        ? parsed.supporting_links.filter((u): u is string => typeof u === "string" && u.trim().length > 0).slice(0, 3)
        : [];
      const detectedLanguage = typeof parsed.detected_language === "string" && parsed.detected_language.trim()
        ? parsed.detected_language.trim().toLowerCase().slice(0, 10) : "en";
      return {
        question: q,
        slider_low_label: typeof parsed.slider_low_label === "string" ? parsed.slider_low_label.trim() : null,
        slider_high_label: typeof parsed.slider_high_label === "string" ? parsed.slider_high_label.trim() : null,
        context_summary: typeof parsed.context_summary === "string" && parsed.context_summary.trim()
          ? parsed.context_summary.trim() : null,
        supporting_links: links,
        quality_notes: typeof parsed.quality_notes === "string" ? parsed.quality_notes.trim() : "",
        cover_image_url: null, // set afterward by attachCoverImage, once we know the final supporting_links
        detected_language: detectedLanguage,
        question_native: detectedLanguage !== "en" && typeof parsed.question_native === "string" && parsed.question_native.trim()
          ? parsed.question_native.trim() : null,
        slider_low_label_native: detectedLanguage !== "en" && typeof parsed.slider_low_label_native === "string" && parsed.slider_low_label_native.trim()
          ? parsed.slider_low_label_native.trim() : null,
        slider_high_label_native: detectedLanguage !== "en" && typeof parsed.slider_high_label_native === "string" && parsed.slider_high_label_native.trim()
          ? parsed.slider_high_label_native.trim() : null,
        context_summary_native: detectedLanguage !== "en" && typeof parsed.context_summary_native === "string" && parsed.context_summary_native.trim()
          ? parsed.context_summary_native.trim() : null,
      };
    } catch (parseErr) {
      // Full raw_text logged (not truncated) — a parse failure here means we
      // need to see exactly what the model actually returned to know why,
      // same reasoning as the json_parse_error logging elsewhere in this file.
      console.error(JSON.stringify({
        tag: `ugq-screen.${label}_json_parse_error`,
        message: (parseErr as Error).message,
        raw_length: rawContent.length,
        raw_text: rawContent,
      }));
      return null;
    }
  }

  // Sep 2026, NEW — shared by generatePreviewOnce and generateRefinedPreview.
  // Root cause of the bug this closes: neither prompt ever said anything
  // about output language, so "question"/slider labels came back in
  // whatever language the model defaulted to given an English system prompt
  // + (possibly non-English) user content — not controlled by any code, and
  // this text goes on to become the CANONICAL questions.question at publish
  // time (ugq-publish) with no verification. Making English explicit here
  // is what makes "canonical is English" an actual guarantee instead of a
  // lucky accident. The _native fields are the other half of the fix — the
  // proposer should see THEIR OWN preview in a language they can judge for
  // accuracy, not a coin flip.
  const LANGUAGE_HANDLING_INSTRUCTIONS =
    "LANGUAGE HANDLING (critical, read carefully): the raw proposal may be written in any language, or a mix " +
    "(e.g. Hindi in Devanagari, Hindi transliterated into Latin script, or Hinglish code-switching). Detect that " +
    "language. Regardless of what it is, the \"question\"/\"slider_low_label\"/\"slider_high_label\" fields you " +
    "return MUST always be written in ENGLISH — translate the meaning faithfully, then apply the structure/tone " +
    "rules above; never leave them in the original language, never mix languages within them, and never skip " +
    "translation just because the input is already mostly readable. If, and only if, the detected language is " +
    "NOT English, ALSO return \"question_native\"/\"slider_low_label_native\"/\"slider_high_label_native\": the " +
    "SAME question and slider labels, but natively phrased the way a fluent speaker of that language would " +
    "actually write it — not a stiff word-for-word back-translation — following the exact same structure/tone " +
    "rules above. If the detected language IS English, leave all three _native fields null. Separately, if " +
    "\"context_summary\" is non-null AND the detected language is not English, ALSO return " +
    "\"context_summary_native\": the same background text, natively phrased (not a stiff back-translation) — this " +
    "is the only version of the background a non-English proposer's audience will ever see, so it must stand on " +
    "its own, not read as a translation. Leave it null whenever context_summary is null or the language is English. ";

  async function generatePreviewOnce(raw: string, withWebSearch: boolean): Promise<PreviewReframe | null> {
    if (!SCREEN_API_KEY) return null;

    const previewSys = withWebSearch
      ? "You write a QUICK preview of how a user's raw civic-question proposal might read once turned into a " +
        "polished stance question, AND use web search to add real supporting context — a specific number, date, " +
        "name, or recent development related to what they raised. CRITICAL: your job is to ADD grounding, never to " +
        "contradict, hedge, or cast doubt on the user's framing, and never to flag their claim as unverified inside " +
        "the question text itself — this may be published as-is, and the goal is to make the proposer feel their " +
        "question was taken seriously, not struck down. If search turns up nothing clearly relevant, leave " +
        "context_summary null and supporting_links empty — never invent facts either way. " +
        "Structure of the question itself: one short concrete context clause, one clause on the underlying tension " +
        "or accountability question, then ONE question ending in 'you', answerable on a single -2..+2 oppose/support " +
        "spectrum (never a menu of options, never 'A, B, or C', never 'Do you support' / 'Should the government'). " +
        "Target 30–45 words, 65 max. Plain everyday language, no jargon. " +
        LANGUAGE_HANDLING_INSTRUCTIONS +
        "Return ONLY JSON: {\"question\":\"... (English, per the language rule above)\",\"slider_low_label\":\"3-6 " +
        "word noun phrase for the oppose end, English\",\"slider_high_label\":\"3-6 word noun phrase for the " +
        "support end, English\",\"context_summary\":\"1-2 sentence grounded background from search, or null\"," +
        "\"supporting_links\":[\"url\",\"...\"] (0-3 URLs backing context_summary, [] if none),\"quality_notes\":" +
        "\"one short sentence\",\"detected_language\":\"ISO 639-1 code of the INPUT text's language, e.g. en, hi\"," +
        "\"question_native\":\"same question natively phrased in detected_language, or null if detected_language " +
        "is en\",\"slider_low_label_native\":\"... or null if detected_language is en\"," +
        "\"slider_high_label_native\":\"... or null if detected_language is en\"," +
        "\"context_summary_native\":\"context_summary natively phrased in detected_language, or null if " +
        "context_summary is null or detected_language is en\"}. " +
        "If the raw text has no usable civic topic at all, return {\"question\":null,\"slider_low_label\":null," +
        "\"slider_high_label\":null,\"context_summary\":null,\"supporting_links\":[],\"quality_notes\":\"no usable topic\"}."
      : "You write a QUICK, ROUGH preview of how a user's raw civic-question proposal might read once turned into a " +
        "polished stance question. You do NOT have web search on this pass — write using ONLY what's in the raw " +
        "text, keep any factual claim framed as the proposer's own claim ('as this suggests', 'reportedly') rather " +
        "than asserting it outright, and never invent specific facts, numbers, or names the raw text didn't " +
        "mention. Leave context_summary null and supporting_links empty — you have no sources to cite this pass. " +
        "Structure: one short concrete context clause, one clause on the underlying tension or accountability " +
        "question, then ONE question ending in 'you', answerable on a single -2..+2 oppose/support spectrum (never " +
        "a menu of options, never 'A, B, or C', never 'Do you support' / 'Should the government'). Target 30–45 " +
        "words, 65 max. Plain everyday language, no jargon. " +
        LANGUAGE_HANDLING_INSTRUCTIONS +
        "Return ONLY JSON: {\"question\":\"... (English, per the language rule above)\",\"slider_low_label\":\"3-6 " +
        "word noun phrase for the oppose end, English\",\"slider_high_label\":\"3-6 word noun phrase for the " +
        "support end, English\",\"context_summary\":null,\"supporting_links\":[],\"quality_notes\":\"one short " +
        "sentence\",\"detected_language\":\"ISO 639-1 code of the INPUT text's language, e.g. en, hi\"," +
        "\"question_native\":\"same question natively phrased in detected_language, or null if detected_language " +
        "is en\",\"slider_low_label_native\":\"... or null if detected_language is en\"," +
        "\"slider_high_label_native\":\"... or null if detected_language is en\"," +
        "\"context_summary_native\":null}. " +
        "If the raw text has no usable civic topic at all, return {\"question\":null,\"slider_low_label\":null," +
        "\"slider_high_label\":null,\"context_summary\":null,\"supporting_links\":[],\"quality_notes\":\"no usable topic\"}.";

    const previewUsr = `Raw proposal:\n"${raw}"\n\nWrite the preview now.`;
    const label = withWebSearch ? "preview" : "preview_nosearch";

    let rawContent = "";
    try {
      // 4096: sized for the web-search variant (tool-use turns + search
      // result content share the same output budget) — kept the same for
      // the no-search fallback too rather than a separate smaller constant,
      // since there's no cost to an unused ceiling and it keeps this one
      // function simple.
      rawContent = await callLLM(label, SCREEN_PROVIDER, PREVIEW_MODEL, previewSys, previewUsr, 4096, withWebSearch);
    } catch (e) {
      console.error(JSON.stringify({ tag: `ugq-screen.${label}_threw`, message: (e as Error).message }));
      return null;
    }
    if (!rawContent) return null;

    return parsePreviewJson(rawContent, label);
  }

  // ── Continuity-aware refine generation (Aug 2026, NEW) ──────────────────
  // FIXES A REAL BUG: the first version of the refine feature called
  // generatePreviewOnce(raw + additional_context, ...) — i.e. regenerated
  // from scratch with a fresh, independent web search. Because search
  // results aren't deterministic and the added context naturally pulls
  // toward a different angle, this could (and in production, did) produce
  // a COMPLETELY different question with different sources, discarding
  // specific facts/framing from the draft the proposer was just looking
  // at, instead of building on it — confirmed via a real case where "add
  // that the US requested India buy Russian oil in 2022" replaced the
  // entire original $7/barrel-discount/25%-tariff framing and sources
  // rather than layering onto them.
  //
  // Fix: show the model the CURRENT draft (question, both slider labels,
  // background) explicitly and instruct it to treat that as the baseline
  // to preserve, only weaving in the new context — not a blank slate to
  // re-research. Web search here is scoped to verifying/supporting the NEW
  // addition specifically, not redoing the whole topic from scratch.
  async function generateRefinedPreview(
    currentPreview: PreviewReframe, raw: string, additionalContext: string, withWebSearch: boolean,
  ): Promise<PreviewReframe | null> {
    if (!SCREEN_API_KEY) return null;

    const currentDraftBlock =
      `Question: ${currentPreview.question}\n` +
      `Oppose end of the slider: ${currentPreview.slider_low_label ?? "(none set)"}\n` +
      `Support end of the slider: ${currentPreview.slider_high_label ?? "(none set)"}\n` +
      `Background: ${currentPreview.context_summary ?? "(none)"}`;

    const refineSys = withWebSearch
      ? "You are REVISING an existing draft preview of a civic stance question based on new context the proposer " +
        "just added — you are NOT starting over. You'll be shown the CURRENT draft (question, both slider-end " +
        "labels, background) below: treat it as your starting point. KEEP everything in it that's still accurate " +
        "and relevant — do not discard existing facts, numbers, dates, or framing just because you're doing a new " +
        "search pass, UNLESS the proposer's new context directly conflicts with or supersedes something in the " +
        "current draft, in which case the new context wins. Your job is to WEAVE IN the new context, not replace " +
        "the whole thing with a different angle or different sources. Use web search only to verify or support the " +
        "NEW information being added, or to fill a specific gap the new context creates — not to redo the research " +
        "from scratch. Same neutrality rules as always: never contradict, hedge on, or cast doubt on either the " +
        "existing framing or the proposer's new context. If search turns up nothing new worth adding, that's " +
        "fine — keep the existing context_summary/supporting_links as they were rather than replacing them with " +
        "something less relevant. IF YOU'RE TIGHT ON ROOM anywhere, cut generic or redundant PHRASING before you " +
        "cut a specific fact, number, date, or existing source — those specifics are what make this read as a " +
        "genuine update rather than a rewrite, and losing them is the most common way this goes wrong. " +
        "CRITICAL FOR THE QUESTION FIELD SPECIFICALLY: the current draft's question already established a central " +
        "tension (e.g. 'keep buying despite pressure' vs. 'comply with sanctions') — that tension is the ANCHOR " +
        "and must stay the question's primary structure. Add the new context as a QUALIFYING CLAUSE layered onto " +
        "that existing tension (e.g. '...even though the U.S. itself had asked for this in 2022...'), not as a " +
        "reason to re-derive a new central tension built around the new fact instead. This applies even when the " +
        "new context would make a compelling standalone question on its own — a more interesting angle is not, by " +
        "itself, a reason to replace the existing one. Only replace the existing tension entirely if the new " +
        "context makes it factually WRONG or clearly obsolete, never merely because a different framing would " +
        "also work. If fitting both makes the sentence run long, trim connecting words and generic phrasing first " +
        "— not the reference to either the old tension or the new context. " +
        "Structure of the question itself: one short concrete context clause, one clause on the underlying tension " +
        "or accountability question, then ONE question ending in 'you', answerable on a single -2..+2 oppose/support " +
        "spectrum (never a menu of options, never 'A, B, or C', never 'Do you support' / 'Should the government'). " +
        "Target 30–45 words, 65 max — this limit is fixed and doesn't change for a refine pass. Plain everyday " +
        "language, no jargon. " +
        LANGUAGE_HANDLING_INSTRUCTIONS +
        "Return ONLY JSON: {\"question\":\"... (English, per the language rule above)\",\"slider_low_label\":\"3-6 " +
        "word noun phrase for the oppose end, English\",\"slider_high_label\":\"3-6 word noun phrase for the " +
        "support end, English\",\"context_summary\":\"2-3 sentences " +
        "(this field has MORE room than the question itself — don't compress it down to match the old draft's " +
        "length just because it was shorter; use the extra room to keep the existing draft's specific facts AND " +
        "add the new context, rather than swapping one set of facts for another), or null\"," +
        "\"supporting_links\":[\"url\",\"...\"] (0-3 URLs — KEEP the current draft's links that are still relevant " +
        "AND add a new one for the new context if it needs its own source; only drop an existing link if you " +
        "genuinely have no room left for it and it's less relevant than the new one, [] if none apply)," +
        "\"quality_notes\":\"one short sentence\",\"detected_language\":\"ISO 639-1 code of the ORIGINAL raw " +
        "proposal's language, e.g. en, hi\",\"question_native\":\"same question natively phrased in " +
        "detected_language, or null if detected_language is en\",\"slider_low_label_native\":\"... or null if " +
        "detected_language is en\",\"slider_high_label_native\":\"... or null if detected_language is en\"," +
        "\"context_summary_native\":\"context_summary natively phrased in detected_language, or null if " +
        "context_summary is null or detected_language is en\"}."
      : "You are REVISING an existing draft preview of a civic stance question based on new context the proposer " +
        "just added — you are NOT starting over, and you do NOT have web search on this pass. You'll be shown the " +
        "CURRENT draft below: keep everything in it that's still accurate and relevant, and weave in the " +
        "proposer's new context using ONLY what they wrote (frame any new claim as 'as the proposer notes' rather " +
        "than asserting it outright) — never invent facts. IF YOU'RE TIGHT ON ROOM, cut generic phrasing before " +
        "cutting a specific fact, number, date, or existing source — only drop something if the new context " +
        "directly contradicts it, never just to make space. " +
        "CRITICAL FOR THE QUESTION FIELD: the current draft's central tension is the ANCHOR and must stay the " +
        "question's primary structure — add the new context as a qualifying clause layered onto it, not as a " +
        "reason to re-center the question around a different angle, even if the new context would make a " +
        "compelling standalone question on its own. Only replace the existing tension if the new context makes " +
        "it factually wrong. " +
        "Structure: one short concrete context clause, one clause on the underlying tension or accountability " +
        "question, then ONE question ending in 'you', answerable on a single -2..+2 oppose/support spectrum (never " +
        "a menu of options, never 'A, B, or C', never 'Do you support' / 'Should the government'). Target 30–45 " +
        "words, 65 max — this limit is fixed and doesn't change for a refine pass. Plain everyday language, no jargon. " +
        LANGUAGE_HANDLING_INSTRUCTIONS +
        "Return ONLY JSON: {\"question\":\"... (English, per the language rule above)\",\"slider_low_label\":\"3-6 " +
        "word noun phrase for the oppose end, English\",\"slider_high_label\":\"3-6 word noun phrase for the " +
        "support end, English\",\"context_summary\":\"2-3 sentences — " +
        "more room than the old draft had, so keep its existing facts AND fold in the new context rather than " +
        "compressing, or null\",\"supporting_links\":[...] (reuse the current draft's links, or [] if it had none)," +
        "\"quality_notes\":\"one short sentence\",\"detected_language\":\"ISO 639-1 code of the ORIGINAL raw " +
        "proposal's language, e.g. en, hi\",\"question_native\":\"same question natively phrased in " +
        "detected_language, or null if detected_language is en\",\"slider_low_label_native\":\"... or null if " +
        "detected_language is en\",\"slider_high_label_native\":\"... or null if detected_language is en\"," +
        "\"context_summary_native\":\"context_summary natively phrased in detected_language, or null if " +
        "context_summary is null or detected_language is en\"}.";

    const refineUsr =
      `Original raw proposal (for reference only — the current draft below is the actual starting point):\n"${raw}"\n\n` +
      `CURRENT DRAFT:\n${currentDraftBlock}\n\n` +
      `Proposer's new context to incorporate:\n"${additionalContext}"\n\n` +
      `Write the UPDATED preview now, building on the current draft above — do not start from a blank slate.`;

    const label = withWebSearch ? "refine" : "refine_nosearch";

    let rawContent = "";
    try {
      rawContent = await callLLM(label, SCREEN_PROVIDER, PREVIEW_MODEL, refineSys, refineUsr, 4096, withWebSearch);
    } catch (e) {
      console.error(JSON.stringify({ tag: `ugq-screen.${label}_threw`, message: (e as Error).message }));
      return null;
    }
    if (!rawContent) return null;

    return parsePreviewJson(rawContent, label);
  }

  // ── Video framing gate (Epic X, NEW) ────────────────────────────────────
  // Judges video_raw_transcript — the unedited transcript of the raw audio
  // track — for leading framing. Deliberately separate from Gate 1 screening
  // above: safety_flag judges hate speech/doxxing/incitement, this judges a
  // narrower and different thing — does the wording itself suggest the
  // "correct" answer rather than asking neutrally — which safety screening
  // isn't designed to catch and shouldn't be overloaded to catch. A single
  // conservative pass, no retry-without-search (no search involved at all;
  // this is a pure wording judgment, not a factual one). Returns null on
  // any failure (empty response / parse error) rather than guessing — a
  // failed framing check falls back to "clean" at the call site, same
  // fail-open reasoning as a failed safety_flag defaulting to "review" (an
  // outage here shouldn't silently block every video submission).
  type FramingCheck = {
    flag: "clean" | "leading" | "rejected";
    reason: string;
    // Sep 2026, NEW: independent of flag/reason above — see the sys prompt
    // below. Informational only: never changes `status` the way "leading"
    // does, just surfaces as a recommendation in the confirm-publish UI
    // (VideoPublishChoice.tsx) alongside a Re-record shortcut, Publish stays
    // clickable regardless.
    derogatory: boolean;
    derogatory_reason: string | null;
  };

  async function checkVideoFraming(transcript: string): Promise<FramingCheck | null> {
    if (!SCREEN_API_KEY) return null;

    const sys =
      "You judge whether a spoken civic-question transcript is asked NEUTRALLY or is LEADING — i.e. the wording " +
      "itself suggests the 'correct' answer rather than asking neutrally. This is a stance-capture platform: " +
      "respondents will hear this exact audio before answering on a -2..+2 scale, so leading wording biases the " +
      "response before the question is even fully asked. Judge WORDING ONLY (loaded adjectives, rhetorical " +
      "'isn't it obvious', a built-in premise the respondent isn't allowed to reject, sarcasm implying the answer) " +
      "— NOT the underlying opinion or topic, which the proposer is fully entitled to hold and raise. A person " +
      "can ask about a topic they clearly feel strongly about in a neutral way; that is 'clean', not 'leading'. " +
      "SEPARATELY, also judge whether the transcript contains language that could reasonably be seen as " +
      "derogatory, insulting, or demeaning toward a specific named person or group — e.g. name-calling, or " +
      "stating an accusation (corruption, criminal wrongdoing) as established fact rather than as the proposer's " +
      "own claim or question. This is independent of the leading/neutral judgment above — a question can be " +
      "neutrally framed while still using derogatory language, or vice versa. This is informational ONLY: it " +
      "never blocks publishing, it is shown to the proposer as a recommendation before they publish, alongside " +
      "an option to re-record instead. " +
      "Return ONLY JSON: {\"flag\":\"clean\"|\"leading\"|\"rejected\",\"reason\":\"one short, PLAIN-LANGUAGE " +
      "sentence a proposer would understand and act on, e.g. 'Try asking without assuming the answer — for " +
      "example, ask what should happen next rather than saying it's obviously wrong.'\",\"derogatory\":true|false," +
      "\"derogatory_reason\":\"one short, PLAIN-LANGUAGE recommendation naming the specific phrase and a neutral " +
      "alternative, or null if derogatory is false\"}. " +
      "Use 'leading' for wording that steers toward an answer but is otherwise a legitimate civic question — this " +
      "is the expected outcome for a rephrase-and-resubmit prompt. Reserve 'rejected' ONLY for content that safety " +
      "screening would also reject (hate speech, harassment, incitement) — 'rejected' here should be rare; when in " +
      "doubt between 'leading' and 'rejected', choose 'leading'.";
    const usr = `Spoken transcript (raw, unedited — exactly what's in the video's audio track):\n"${transcript}"\n\nJudge it now.`;

    let rawContent = "";
    try {
      rawContent = await callLLM("framing", SCREEN_PROVIDER, MODEL, sys, usr, 512);
    } catch (e) {
      console.error(JSON.stringify({ tag: "ugq-screen.framing_threw", message: (e as Error).message }));
      return null;
    }
    if (!rawContent) return null;

    try {
      const cleaned = stripFences(rawContent);
      const jsonStr = extractJsonObject(cleaned) ?? cleaned;
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      const flag = ["clean", "leading", "rejected"].includes(parsed.flag as string)
        ? (parsed.flag as "clean" | "leading" | "rejected") : null;
      if (!flag) return null;
      const reason = typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim().slice(0, 300)
        : "Try rephrasing this more neutrally, without suggesting an answer.";
      const derogatory = parsed.derogatory === true;
      const derogatoryReason = derogatory && typeof parsed.derogatory_reason === "string" && parsed.derogatory_reason.trim()
        ? parsed.derogatory_reason.trim().slice(0, 300)
        : null;
      return { flag, reason, derogatory, derogatory_reason: derogatoryReason };
    } catch (parseErr) {
      console.error(JSON.stringify({
        tag: "ugq-screen.framing_json_parse_error",
        message: (parseErr as Error).message,
        raw_text: rawContent,
      }));
      return null;
    }
  }

  // ── Cover image (Aug 2026, NEW) ─────────────────────────────────────────
  // Ports the og:image/twitter:image scrape that used to run ONLY inside
  // ugq-confirm-publish, AFTER the user clicked Publish — the "Here's how
  // this looks" modal never showed an image even when one was available,
  // so the proposer was effectively publishing blind on that front. Runs
  // here instead, once the preview text is finalized, against the preview's
  // own supporting_links plus the proposer's optional source_url (preferred
  // first — same ordering ugq-confirm-publish used, on the theory that a
  // source the proposer deliberately chose should win over an AI-found one).
  // ugq-confirm-publish now reuses this cached result at publish time
  // instead of re-fetching from scratch. Best-effort and additive: adds up
  // to ~IMAGE_FETCH_TIMEOUT_MS (6s) to this function's total runtime, which
  // ugq-submit's existing ~20s wait + up-to-30s poll window already
  // absorbs comfortably — never blocks the preview itself from returning.
  async function attachCoverImage(preview: PreviewReframe, proposalSourceUrl: string | null): Promise<PreviewReframe> {
    const candidates = [
      ...(proposalSourceUrl ? [proposalSourceUrl] : []),
      ...preview.supporting_links,
    ];
    const coverImageUrl = await findCoverImageFromLinks(candidates);
    // Aug 2026, NEW: previously only exceptions were logged here — a clean
    // "found nothing" result was silent, which made it impossible to tell
    // from logs alone whether a missing modal image meant "no og:image
    // found on any candidate" vs. "one was found but failed to load in the
    // browser" (e.g. a hotlink block — same class of issue as the known
    // NDTV gap). candidates_tried lets you cross-check against how many
    // supporting_links + source_url were actually available.
    console.log(JSON.stringify({
      tag: "ugq-screen.cover_image_result",
      candidates_tried: candidates.length,
      found: !!coverImageUrl,
      cover_image_url: coverImageUrl,
    }));
    return { ...preview, cover_image_url: coverImageUrl };
  }

  // ── Language pre-detection for duplicate/topic matching (Sep 2026, NEW) ──
  // ROOT CAUSE FIXED: search_questions hardcodes websearch_to_tsquery
  // ('english', p_query) — non-English raw_question text gets starved of
  // real full-text-search candidates before the Gate-1 LLM ever gets a
  // chance to compare it against anything. This is a small, fast, NO-search
  // call (cheap: short output, no web search tool) whose only job is to
  // hand search_questions something it can actually match against — it is
  // NOT the creative reframe (that stays generatePreviewOnce's job) and its
  // output is never shown to anyone or persisted as the canonical text.
  // Fails open to "already English" so a detection hiccup degrades back to
  // today's (English-only-safe) behavior rather than blocking screening.
  type LangDetectResult = { language: string; english_query: string };

  async function detectAndTranslateForSearch(rawText: string): Promise<LangDetectResult> {
    if (!SCREEN_API_KEY) return { language: "en", english_query: rawText };
    const sys =
      "Detect the language of the given text and produce a literal English translation of it — accuracy for " +
      "search-matching purposes only, not a polished rewrite. If the text is already English, set english_query " +
      "to the text unchanged. Return ONLY JSON: {\"language\":\"ISO 639-1 code, e.g. en, hi\",\"english_query\":\"...\"}.";
    const usr = `Text:\n"${rawText}"`;
    let rawContent = "";
    try {
      rawContent = await callLLM("lang_detect", SCREEN_PROVIDER, MODEL, sys, usr, 1024);
    } catch (e) {
      console.error(JSON.stringify({ tag: "ugq-screen.lang_detect_threw", message: (e as Error).message }));
      return { language: "en", english_query: rawText };
    }
    if (!rawContent) return { language: "en", english_query: rawText };
    try {
      const cleaned = stripFences(rawContent);
      const jsonStr = extractJsonObject(cleaned) ?? cleaned;
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      const language = typeof parsed.language === "string" && parsed.language.trim()
        ? parsed.language.trim().toLowerCase().slice(0, 10) : "en";
      const englishQuery = typeof parsed.english_query === "string" && parsed.english_query.trim()
        ? parsed.english_query.trim() : rawText;
      return { language, english_query: englishQuery };
    } catch (parseErr) {
      console.error(JSON.stringify({
        tag: "ugq-screen.lang_detect_json_parse_error", message: (parseErr as Error).message, raw_text: rawContent,
      }));
      return { language: "en", english_query: rawText };
    }
  }

  try {
    const body = await req.json().catch(() => ({}));
    const proposalId = typeof body.proposal_id === "string" ? body.proposal_id : "";
    // Screen freshly-submitted proposals as normal — OR recover a proposal
    // stuck at 'in_review' with a real ai_screen_result but no preview (see
    // generatePreviewOnce's comment for why this happens). Everything else
    // (approved/reframing/reframed/published/rejected) is left alone.
    const { data: proposal } = await adminSb.from("user_question_proposals")
      .select("id, user_id, raw_question, status, ai_screen_result, preview_reframe, auto_topic_id, source_url, input_mode, video_raw_transcript, video_resubmit_count, video_recording_path, video_duration_seconds, video_publish_choice")
      .eq("id", proposalId).maybeSingle();
    if (!proposal) return json(404, { ok: false, error: "NOT_FOUND" });

    const raw = proposal.raw_question as string;
    // Epic X, NEW: only video proposals with a transcript to check get the
    // framing gate — everything else (text, voice, or a video row somehow
    // missing its transcript) behaves exactly as before this change.
    const isVideoSubmission = proposal.input_mode === "video" &&
      typeof proposal.video_raw_transcript === "string" && proposal.video_raw_transcript.trim().length > 0;
    // Aug 2026, NEW: same proposer-supplied "Source link" ugq-confirm-publish
    // already used as its top image candidate — read once here so both the
    // normal flow and the stuck-retry branch below can pass it into
    // attachCoverImage.
    const proposalSourceUrl = typeof proposal.source_url === "string" && proposal.source_url.trim()
      ? proposal.source_url.trim() : null;

    // ── USER-INITIATED REFINE (Aug 2026, NEW) ────────────────────────────────
    // Lets a proposer, while still reviewing their own not-yet-published
    // preview (the "Here's how this looks" modal), add extra context — "it
    // happened in March", "this is about UP specifically" — and get a fresh
    // preview generated from raw_question + that addition, so they can
    // course-correct before committing to Publish rather than publishing
    // something that missed the mark or abandoning the proposal outright.
    // Reuses generatePreviewOnce + attachCoverImage exactly as the normal
    // flow does (same with-search-then-without-search fallback) — does NOT
    // re-run Gate 1 or re-derive the topic match, same reasoning as the
    // stuck-proposal retry branch just below. Takes priority over that
    // branch: a refine request should always regenerate, even when a
    // perfectly good preview already exists, whereas stuck-retry only fires
    // when preview_reframe is MISSING.
    //
    // additional_context is appended onto raw_question itself (not stored in
    // a separate column) — reuses the existing TEXT column rather than
    // adding new schema, and means any FUTURE refine or re-screen
    // automatically sees everything added so far. The fixed "---" delimiter
    // keeps it human-readable if anyone reads raw_question later (e.g. the
    // admin queue). Called via ugq-refine-preview, a user-JWT-gated wrapper
    // that does friendlier validation before ever reaching here — same
    // "wrapper verifies, internal function executes" split
    // ugq-confirm-publish/ugq-publish already use.
    const additionalContext = typeof body.additional_context === "string" ? body.additional_context.trim() : "";
    const isUserRefineRequest = additionalContext.length > 0 && proposal.status === "in_review";

    const isStuckPreviewRetry = !isUserRefineRequest &&
      proposal.status === "in_review" && !proposal.preview_reframe && !!proposal.ai_screen_result;

    if (proposal.status !== "proposed" && !isStuckPreviewRetry && !isUserRefineRequest) {
      return json(200, { ok: true, skipped: true, status: proposal.status });
    }

    if (isUserRefineRequest) {
      if (additionalContext.length > ADDITIONAL_CONTEXT_MAX_LEN) {
        return json(400, {
          ok: false, error: "CONTEXT_TOO_LONG",
          message: `Keep additional context under ${ADDITIONAL_CONTEXT_MAX_LEN} characters.`,
        });
      }
      const newRaw = `${raw}\n\n---\nAdditional context from proposer: ${additionalContext}`;

      // Aug 2026, FIXED: this used to call generatePreviewOnce(newRaw, ...) —
      // i.e. regenerate from scratch with a brand new, independent web
      // search. Confirmed in production that this could silently discard
      // the specific facts/sources/framing already in the current draft
      // whenever the new search happened to surface different sources
      // (search results aren't deterministic, and the added context pulls
      // toward a different angle by design). Now anchors on the CURRENT
      // preview via generateRefinedPreview so the model treats it as a
      // baseline to preserve and build on, not a blank slate — only falls
      // back to the old from-scratch behavior if, unexpectedly, there's no
      // existing preview to anchor on at all (shouldn't happen via the
      // normal UI flow, which only offers refine once a preview exists).
      const existingPreviewRaw = proposal.preview_reframe as Record<string, unknown> | null;
      const existingPreview: PreviewReframe | null =
        existingPreviewRaw && typeof existingPreviewRaw.question === "string" && existingPreviewRaw.question.trim()
          ? {
              question: existingPreviewRaw.question,
              slider_low_label: typeof existingPreviewRaw.slider_low_label === "string" ? existingPreviewRaw.slider_low_label : null,
              slider_high_label: typeof existingPreviewRaw.slider_high_label === "string" ? existingPreviewRaw.slider_high_label : null,
              context_summary: typeof existingPreviewRaw.context_summary === "string" ? existingPreviewRaw.context_summary : null,
              context_summary_native: typeof existingPreviewRaw.context_summary_native === "string" ? existingPreviewRaw.context_summary_native : null,
              supporting_links: Array.isArray(existingPreviewRaw.supporting_links)
                ? existingPreviewRaw.supporting_links.filter((u): u is string => typeof u === "string")
                : [],
              quality_notes: typeof existingPreviewRaw.quality_notes === "string" ? existingPreviewRaw.quality_notes : "",
              cover_image_url: typeof existingPreviewRaw.cover_image_url === "string" ? existingPreviewRaw.cover_image_url : null,
            }
          : null;

      let refined: PreviewReframe | null = null;
      if (PREVIEW_ENABLED) {
        refined = existingPreview
          ? await generateRefinedPreview(existingPreview, raw, additionalContext, true)
          : await generatePreviewOnce(newRaw, true);
      }
      if (!refined && PREVIEW_ENABLED) {
        console.error(JSON.stringify({ tag: "ugq-screen.refine_websearch_failed_retrying_without_search", proposal_id: proposalId }));
        refined = existingPreview
          ? await generateRefinedPreview(existingPreview, raw, additionalContext, false)
          : await generatePreviewOnce(newRaw, false);
      }
      if (refined) {
        refined = await attachCoverImage(refined, proposalSourceUrl);
      }
      const persisted = refined
        ? { ...refined, model: PREVIEW_MODEL, generated_at: new Date().toISOString() }
        : null;

      if (!persisted) {
        // Regeneration failed outright (both attempts) — leave the
        // proposal's existing, still-good preview_reframe (and
        // raw_question) untouched rather than wiping it out over a failed
        // refine attempt. The frontend keeps showing the old preview and
        // surfaces a "couldn't regenerate" message instead.
        console.error(JSON.stringify({ tag: "ugq-screen.refine_failed", proposal_id: proposalId }));
        return json(200, {
          ok: true, proposal_id: proposalId, status: "in_review",
          refined: false, preview_reframe: proposal.preview_reframe ?? null,
        });
      }

      await adminSb.from("user_question_proposals")
        .update({
          raw_question: newRaw,
          preview_reframe: persisted,
          // Sep 2026, NEW — see the stuck-retry branch above for why this is conditional.
          ...(persisted ? { proposal_language: persisted.detected_language } : {}),
        })
        .eq("id", proposalId);

      console.log(JSON.stringify({ tag: "ugq-screen.refine_result", proposal_id: proposalId, succeeded: true }));

      return json(200, {
        ok: true, proposal_id: proposalId, status: "in_review",
        preview_reframe: persisted, refined: true,
      });
    }

    // ── STUCK-PROPOSAL PREVIEW RETRY (Aug 2026) ─────────────────────────────
    // Recovers a proposal stuck at 'in_review' with a real ai_screen_result
    // but no preview_reframe (the admin queue's "Re-screen" button used to
    // silently no-op on these — the old guard only allowed reprocessing
    // status='proposed' rows). Retries ONLY the preview, reusing the
    // existing screen result and topic assignment rather than re-running
    // Gate 1 from scratch. Only reached when isUserRefineRequest is false —
    // a real refine request always takes the branch above instead, even on
    // a proposal that happens to also be missing its preview.
    if (isStuckPreviewRetry) {
      let retried: PreviewReframe | null = PREVIEW_ENABLED ? await generatePreviewOnce(raw, true) : null;
      if (!retried && PREVIEW_ENABLED) {
        console.error(JSON.stringify({ tag: "ugq-screen.stuck_retry_websearch_failed_retrying_without_search", proposal_id: proposalId }));
        retried = await generatePreviewOnce(raw, false);
      }
      if (retried) {
        retried = await attachCoverImage(retried, proposalSourceUrl);
      }
      const persisted = retried
        ? { ...retried, model: PREVIEW_MODEL, generated_at: new Date().toISOString() }
        : null;

      await adminSb.from("user_question_proposals")
        .update({
          preview_reframe: persisted,
          // Sep 2026, NEW: only touch this if the retry actually produced a
          // result — a failed retry shouldn't clear a language already
          // recorded from the original screening pass.
          ...(retried ? { proposal_language: retried.detected_language } : {}),
        }).eq("id", proposalId);

      console.log(JSON.stringify({ tag: "ugq-screen.stuck_retry_result", proposal_id: proposalId, succeeded: !!persisted }));

      return json(200, {
        ok: true, proposal_id: proposalId, status: "in_review",
        preview_reframe: persisted, retried: true,
      });
    }

    const proposerId = proposal.user_id as string;

    // Sep 2026, NEW: detect the proposer's language and get a literal
    // English query for matching BEFORE fetching duplicate candidates — see
    // detectAndTranslateForSearch's header comment for the bug this closes.
    const langDetect = await detectAndTranslateForSearch(raw);

    // ── Retrieve live-question candidates for duplicate adjudication ────────────
    // Pass ALL params explicitly: this codebase's PostgREST setup can fail to
    // resolve RPCs when defaulted params are omitted.
    const { data: candidates } = await adminSb.rpc("search_questions", {
      p_query: langDetect.english_query, p_user_id: null, p_limit: 8, p_offset: 0,
    });
    const candList = (candidates ?? []).map((c: { question_id: string; question: string }) => ({
      id: c.question_id, question: c.question,
    }));

    // ── Retrieve candidate parent topics for topic matching ─────────────────────
    // Same RPC classify-parent-topics uses for topic_drafts — reused here so UGQ
    // proposals are classified against the exact same approved-topic pool.
    const { data: parentTopicsRaw } = await adminSb.rpc("get_parent_topics_for_classification");
    const parentTopics = (parentTopicsRaw ?? []) as { id: string; title: string }[];

    // Proposer tier (for fast-track + final routing).
    const { data: rep } = await adminSb.from("user_proposal_reputation")
      .select("score, tier, total_published, total_rejected")
      .eq("user_id", proposerId).maybeSingle();
    const tier = rep?.tier ?? "new";

    // ── Gate 1 LLM pass ─────────────────────────────────────────────────────────
    let screen = {
      is_valid_question: true,
      is_duplicate: false,
      duplicate_question_id: null as string | null,
      safety_flag: "review" as "clean" | "review" | "reject",
      quality_score: 50,
      topic_suggestion: "",
      topic_match_id: null as string | null,
      topic_match_confidence: 0,
      reason: "",
    };

    // Preview reframe result (separate, lightweight, unverified) — generated
    // via generatePreviewOnce (defined above, before the try block) so it
    // shares the with-search-then-without-search fallback logic with the
    // stuck-proposal retry branch above.
    let previewReframe: PreviewReframe | null = null;

    // Epic X, NEW: stays "clean" for every non-video proposal (text/voice) —
    // the framing gate only ever downgrades this for isVideoSubmission rows.
    let videoFraming: {
      flag: "clean" | "leading" | "rejected"; reason: string;
      derogatory: boolean; derogatory_reason: string | null;
    } = { flag: "clean", reason: "", derogatory: false, derogatory_reason: null };

    if (SCREEN_API_KEY) {
      const sys =
        "You screen user-submitted civic questions for a stance platform where users answer on a -2..+2 agree/disagree scale. " +
        "Users write casually — rants, run-on observations, questions starting with 'why', or even explicit requests like " +
        "'help me frame a question about X' are ALL normal, valid raw material at this stage. A separate editorial step " +
        "(not you) rewrites the raw text into a polished agree/disagree question afterward, so do NOT reject something " +
        "just because it isn't already phrased as a clean proposition. " +
        "Return ONLY a JSON object with keys: is_valid_question (boolean — TRUE for any text that names a real, " +
        "identifiable civic, political, policy, or social topic, however messily or informally phrased; FALSE ONLY for " +
        "spam, gibberish, pure personal messages, or text with no discernible topic at all), " +
        "is_duplicate (boolean), duplicate_question_id (string id chosen ONLY from the provided candidates, or null), " +
        "safety_flag ('clean' | 'review' | 'reject' — 'reject' for hate speech, doxxing, personal attacks, incitement; 'review' if unsure), " +
        "quality_score (integer 0-100 — clarity, specificity, civic relevance; phrasing/clarity problems belong HERE, not in is_valid_question), " +
        "topic_match_id (string id chosen ONLY from the provided topic candidates if one clearly fits this question's subject, or null if none fit well), " +
        "topic_match_confidence (number 0.0-1.0 — your confidence that topic_match_id is the right broad category for this question; 0 if topic_match_id is null), " +
        "topic_suggestion (a short NEW broad category name for this question, 2-5 words, e.g. 'Public Safety' or " +
        "'Housing Policy' — not a restatement of the question itself. ALWAYS provide this, even when you also set " +
        "topic_match_id — it's used as a fallback if your match turns out not confident enough to use, so an empty " +
        "topic_suggestion alongside a low-confidence topic_match_id means this question ends up with NO topic at " +
        "all, which blocks it from being published), " +
        "reason (one short sentence). No prose outside the JSON.";
      const usr =
        `Proposed question:\n"${raw}"\n\n` +
        `Existing live questions (candidates for duplicate match):\n` +
        (candList.length
          ? candList.map((c) => `- id=${c.id} :: ${c.question}`).join("\n")
          : "(none)") +
        `\n\nIf the proposed question is essentially the same as one candidate, set is_duplicate=true and duplicate_question_id to that candidate's id.\n\n` +
        `Existing broad topic categories (candidates for topic_match_id):\n` +
        (parentTopics.length
          ? parentTopics.map((t) => `- id=${t.id} :: ${t.title}`).join("\n")
          : "(none yet — always propose a new topic_suggestion)") +
        `\n\nPick the topic that this question's subject matter clearly belongs to. Only set topic_match_id if you are genuinely confident (this drives an automatic assignment); when in doubt, leave it null and provide topic_suggestion instead.`;

      // Run screening + preview concurrently — preview adds ~0 sequential
      // latency this way instead of doubling the round-trip time. Web search
      // (enabled on the preview call only) adds its own latency on top of
      // that, though — see ugq-submit's timeout comment.
      const screenPromise = callLLM("screen", SCREEN_PROVIDER, MODEL, sys, usr, 2048);
      const previewPromise = PREVIEW_ENABLED ? generatePreviewOnce(raw, true) : Promise.resolve(null);
      // Epic X, NEW: third concurrent pass, video submissions only. Adds ~0
      // sequential latency for the same reason preview already runs
      // concurrently rather than after — see the file header note.
      const framingPromise = isVideoSubmission
        ? checkVideoFraming(proposal.video_raw_transcript as string)
        : Promise.resolve(null);

      const [screenSettled, previewSettled, framingSettled] = await Promise.allSettled([screenPromise, previewPromise, framingPromise]);

      try {
        const rawContent = screenSettled.status === "fulfilled" ? screenSettled.value : "";
        if (rawContent) {
          const cleaned = stripFences(rawContent);
          // Same balanced-{...} extraction as generatePreviewOnce — this
          // call never uses web search, so in practice it's always a single
          // clean block, but the extractor is a no-op safety net here and
          // keeps both parse sites consistent.
          const jsonStr = extractJsonObject(cleaned) ?? cleaned;
          let parsed: Record<string, unknown>;
          try {
            parsed = JSON.parse(jsonStr);
          } catch (parseErr) {
            console.error(JSON.stringify({
              tag: "ugq-screen.json_parse_error",
              message: (parseErr as Error).message,
              raw_length: rawContent.length,
              cleaned_length: cleaned.length,
              cleaned_text: cleaned,
            }));
            throw parseErr;
          }
          screen = {
            is_valid_question: parsed.is_valid_question !== false,
            is_duplicate: parsed.is_duplicate === true,
            duplicate_question_id: typeof parsed.duplicate_question_id === "string" ? parsed.duplicate_question_id : null,
            safety_flag: ["clean", "review", "reject"].includes(parsed.safety_flag as string) ? parsed.safety_flag as "clean" | "review" | "reject" : "review",
            quality_score: Math.max(0, Math.min(100, Number(parsed.quality_score ?? 50) | 0)),
            topic_suggestion: typeof parsed.topic_suggestion === "string" ? parsed.topic_suggestion.slice(0, 80) : "",
            topic_match_id: typeof parsed.topic_match_id === "string" ? parsed.topic_match_id : null,
            topic_match_confidence: Math.max(0, Math.min(1, Number(parsed.topic_match_confidence ?? 0))),
            reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "",
          };
          console.log(JSON.stringify({
            tag: "ugq-screen.llm_ok",
            quality_score: screen.quality_score,
            topic_match_id: screen.topic_match_id,
            topic_match_confidence: screen.topic_match_confidence,
            topic_suggestion: screen.topic_suggestion,
          }));
        } else {
          console.error(JSON.stringify({ tag: "ugq-screen.empty_response", provider: SCREEN_PROVIDER }));
        }
      } catch (e) {
        console.error(JSON.stringify({
          tag: "ugq-screen.exception", message: (e as Error).message, stack: (e as Error).stack?.slice(0, 500),
        }));
        // Leave default screen (valid + safety 'review') → routes to admin review.
      }

      previewReframe = previewSettled.status === "fulfilled" ? previewSettled.value : null;
      if (previewSettled.status === "rejected") {
        console.error(JSON.stringify({ tag: "ugq-screen.preview_promise_rejected", reason: String(previewSettled.reason) }));
      }

      // Aug 2026: if the web-search attempt failed, retry once without
      // search rather than leaving the proposal with no preview at all —
      // see generatePreviewOnce's comment for the observed failure pattern
      // this guards against.
      if (!previewReframe && PREVIEW_ENABLED) {
        console.error(JSON.stringify({ tag: "ugq-screen.preview_websearch_failed_retrying_without_search", proposal_id: proposalId }));
        previewReframe = await generatePreviewOnce(raw, false);
      }

      // Aug 2026, NEW: cover image scrape, now that supporting_links (and
      // therefore the final candidate list) is settled — see
      // attachCoverImage's comment above for why this moved here from
      // ugq-confirm-publish.
      if (previewReframe) {
        previewReframe = await attachCoverImage(previewReframe, proposalSourceUrl);
      }

      console.log(JSON.stringify({ tag: "ugq-screen.preview_final_result", has_preview: !!previewReframe }));

      // Epic X, NEW: fail-open to "clean" on any failure (empty response,
      // parse error, promise rejection) — same reasoning as safety_flag
      // defaulting to "review" on a screening failure: an LLM outage
      // shouldn't silently block every video submission from ever
      // publishing. This is deliberately NOT the same fail-open direction
      // as a hard safety check would use; framing is a softer, correctable
      // judgment (worst case a slightly leading question gets published),
      // not an irreversible harm, so failing open here is the right
      // tradeoff — unlike safety_flag, which fails to 'review' (a human
      // gate) rather than 'clean' (no gate at all).
      if (isVideoSubmission) {
        const framingResult = framingSettled.status === "fulfilled" ? framingSettled.value : null;
        if (framingSettled.status === "rejected") {
          console.error(JSON.stringify({ tag: "ugq-screen.framing_promise_rejected", reason: String(framingSettled.reason) }));
        }
        videoFraming = framingResult ?? { flag: "clean", reason: "", derogatory: false, derogatory_reason: null };
        console.log(JSON.stringify({ tag: "ugq-screen.framing_final_result", flag: videoFraming.flag }));
      }
    } else {
      console.error(JSON.stringify({ tag: "ugq-screen.no_api_key", provider: SCREEN_PROVIDER }));
    }

    // Guard: only honour a duplicate id that is actually in the candidate set.
    const validDupId = screen.is_duplicate && screen.duplicate_question_id &&
      candList.some((c) => c.id === screen.duplicate_question_id)
      ? screen.duplicate_question_id : null;

    // Guard: only honour a topic match that is actually in the candidate set
    // and clears the confidence bar.
    const validTopicMatchId = screen.topic_match_id &&
      screen.topic_match_confidence >= TOPIC_MATCH_THRESHOLD &&
      parentTopics.some((t) => t.id === screen.topic_match_id)
      ? screen.topic_match_id : null;

    // ── Resolve auto_topic_id ────────────────────────────────────────────────
    // 1. Confident match against an existing approved topic → use it directly.
    // 2. No match, but the model proposed a new category name → check for an
    //    existing topic with that exact title first (avoids near-duplicate
    //    pending topics piling up for the same category), then fall back to
    //    creating a new 'pending' topic — same status classify-parent-topics
    //    uses for its own proposed themes, so it goes through the same
    //    /admin/topics approval queue rather than silently becoming a target
    //    for future auto-matching. Confirmed this does NOT block feed
    //    visibility (neither feed RPC filters on topics.status).
    // 3. Neither → leave null; admin picks or creates manually, and — since
    //    ugq-publish requires a topic_id — auto-publish is skipped below
    //    (falls back to in_review) rather than erroring out.
    let autoTopicId: string | null = validTopicMatchId;

    if (!autoTopicId && screen.topic_suggestion && screen.topic_suggestion.length >= 8) {
      try {
        const { data: existing, error: selectErr } = await adminSb.from("topics")
          .select("id").ilike("title", screen.topic_suggestion).maybeSingle();
        if (selectErr) {
          console.error(JSON.stringify({
            tag: "ugq-screen.topic_select_error", message: selectErr.message,
            code: selectErr.code, topic_suggestion: screen.topic_suggestion,
          }));
        }

        if (existing?.id) {
          autoTopicId = existing.id;
        } else {
          const { data: created, error: insertErr } = await adminSb.from("topics").insert({
            title: screen.topic_suggestion,
            tier: "global",
            status: "pending",
            sources: [{ type: "auto_generated", trigger_proposal: proposalId }],
          }).select("id").single();
          // supabase-js does NOT throw on constraint violations — it returns
          // {data: null, error: {...}} — a prior version of this code
          // destructured only `data`, silently discarding `error` entirely,
          // so a genuine DB error (e.g. a CHECK constraint miss) produced no
          // log line anywhere and just left autoTopicId null. Logging error
          // explicitly now instead of relying on the catch block below,
          // which supabase-js rarely triggers for this class of failure.
          if (insertErr) {
            console.error(JSON.stringify({
              tag: "ugq-screen.topic_insert_error", message: insertErr.message,
              code: insertErr.code, details: insertErr.details, hint: insertErr.hint,
              topic_suggestion: screen.topic_suggestion,
            }));
          }
          if (created?.id) autoTopicId = created.id;
        }
      } catch (e) {
        console.error(JSON.stringify({
          tag: "ugq-screen.topic_resolution_exception", message: (e as Error).message,
          topic_suggestion: screen.topic_suggestion,
        }));
        // Never let topic auto-assignment block screening — falls through to
        // manual assignment in Gate 2 if this fails for any reason.
      }
    }

    if (!autoTopicId) {
      // Visible marker for exactly the failure mode you hit: preview looked
      // fine, but nothing here could resolve a topic (no confident match AND
      // either no topic_suggestion or its creation/lookup failed above).
      // ugq-confirm-publish blocks publish with NO_TOPIC in this case.
      console.error(JSON.stringify({
        tag: "ugq-screen.no_topic_resolved",
        had_topic_match_id: !!screen.topic_match_id,
        topic_match_confidence: screen.topic_match_confidence,
        topic_suggestion: screen.topic_suggestion || "(empty)",
      }));
    }

    // ── Decide terminal status + reputation delta ──────────────────────────────
    let status = "in_review";
    let rejection_reason: string | null = null;
    let duplicate_of_question_id: string | null = null;
    let repDelta = 0;
    let rejectedInc = 0;

    if (screen.safety_flag === "reject" || videoFraming.flag === "rejected") {
      // Epic X, NEW: a "rejected" framing verdict (reserved for content that
      // would also fail safety screening — see checkVideoFraming's prompt)
      // is treated identically to safety_flag === "reject", including the
      // same reputation penalty. This is NOT the "leading" case (handled
      // separately below) — "rejected" is meant to be rare.
      status = "rejected"; rejection_reason = "safety"; repDelta = REP.rejectSafety; rejectedInc = 1;
    } else if (!screen.is_valid_question) {
      status = "rejected"; rejection_reason = "not_a_question"; repDelta = REP.rejectLowQuality; rejectedInc = 1;
    } else if (validDupId) {
      status = "rejected"; rejection_reason = "duplicate"; duplicate_of_question_id = validDupId; // +0, no penalty
    } else if (videoFraming.flag === "leading") {
      // Epic X, NEW: overrides FASTTRACK/auto-publish and the normal
      // in_review routing below — a leading video question never goes
      // straight to review or publish, regardless of tier or quality_score.
      // No reputation penalty (repDelta stays 0): re-recording isn't a
      // quality failure the way low-quality/safety rejections are, it's a
      // normal part of the video flow, same as any other unpublished draft.
      status = "resubmit_requested";
    } else if (FASTTRACK && (tier === "trusted" || tier === "verified") && screen.safety_flag === "clean") {
      // Legacy fast-track path — off by default, superseded by auto-publish
      // below for the common case. Left intact as a fallback toggle.
      status = "approved";
    } else {
      status = "in_review";
    }

    // ── AUTO-PUBLISH (Aug 2026, NEW) ─────────────────────────────────────
    // Fires whenever the proposal cleared every rejection gate above (status
    // is still the baseline "in_review") AND we have everything ugq-publish
    // needs: a topic and usable preview text. Publishes the EXACT text shown
    // to the proposer — no divergence between preview and live.
    let published = false;
    let publishedQuestionId: string | null = null;

    if (
      status === "in_review" &&
      AUTOPUBLISH_ENABLED &&
      autoTopicId &&
      previewReframe?.question &&
      screen.quality_score >= AUTOPUBLISH_MIN_QUALITY
    ) {
      try {
        const pubResp = await fetch(`${SUPABASE_URL}/functions/v1/ugq-publish`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-cron-secret": CRON_SECRET },
          body: JSON.stringify({
            proposal_id: proposalId,
            reframed_question: previewReframe.question,
            topic_id: autoTopicId,
            slider_low_label: previewReframe.slider_low_label,
            slider_high_label: previewReframe.slider_high_label,
            context_summary: previewReframe.context_summary,
            supporting_links: previewReframe.supporting_links,
            // Aug 2026, NEW: pass through the cover image already found
            // during preview — this direct auto-publish path never shows a
            // modal, but there's no reason to leave the image behind now
            // that it's computed anyway.
            cover_image_url: previewReframe.cover_image_url,
            auto_published: true,
            // Sep 2026, NEW — see PreviewReframe's comment. Lets ugq-publish
            // seed the proposer's own-language rendition directly instead of
            // waiting on the async rendition pipeline; a no-op for English
            // proposals (question_native stays null).
            detected_language: previewReframe.detected_language,
            question_native: previewReframe.question_native,
            slider_low_label_native: previewReframe.slider_low_label_native,
            slider_high_label_native: previewReframe.slider_high_label_native,
            // Sep 2026, NEW: see PreviewReframe's context_summary_native
            // comment — without this, ugq-publish's native-rendition seed
            // left context_summary null on the rendition, and
            // get_question_localized fell back to the English
            // questions.context_summary forever (that rendition is marked
            // 'published' immediately, so the async translator never
            // revisits it to backfill).
            context_summary_native: previewReframe.context_summary_native,
            // Epic X, NEW: only meaningful when isVideoSubmission — undefined
            // fields are simply omitted from the JSON body for text/voice.
            ...(isVideoSubmission ? {
              video_recording_path: proposal.video_recording_path,
              video_duration_seconds: proposal.video_duration_seconds,
              // No human confirm step in the auto-publish path (off by
              // default) to ask the proposer raw_only vs. raw_plus_overlay —
              // that choice is normally made at ugq-confirm-publish time.
              // Default to the recommended raw_plus_overlay rather than
              // leaving it null. ("raw_plus_avatar" dropped Sep 2026 — no
              // TTS/avatar synthesis backend exists.)
              video_publish_choice: "raw_plus_overlay",
            } : {}),
          }),
        });
        const pubJson = await pubResp.json().catch(() => ({}));
        if (pubResp.ok && pubJson?.ok) {
          published = true;
          publishedQuestionId = typeof pubJson.question_id === "string" ? pubJson.question_id : null;
          status = "published"; // ugq-publish already set this on the proposal row too — kept in sync here for the metadata update below and the response payload.
          console.log(JSON.stringify({ tag: "ugq-screen.autopublish_ok", question_id: publishedQuestionId }));
        } else {
          console.error(JSON.stringify({ tag: "ugq-screen.autopublish_failed", body: pubJson }));
          // Falls through: stays 'in_review' for the normal admin pipeline —
          // the proposer still gets a preview, just not an instant publish.
        }
      } catch (e) {
        console.error(JSON.stringify({ tag: "ugq-screen.autopublish_exception", message: (e as Error).message }));
      }
    }

    // Preview is only meaningful for proposals that are actually headed
    // somewhere (in_review / approved / published) — discard it for anything
    // rejected. Still returned/persisted even when published=true, so the
    // proposer's confirmation screen and the admin parallel-review queue can
    // both show exactly what went live.
    const persistedPreview = (status === "in_review" || status === "approved" || status === "published")
      ? previewReframe : null;

    await adminSb.from("user_question_proposals").update({
      status,
      rejection_reason,
      duplicate_of_question_id,
      auto_topic_id: autoTopicId,
      ai_screen_result: screen,
      quality_score: screen.quality_score,
      // Sep 2026, NEW — see detectAndTranslateForSearch above.
      proposal_language: langDetect.language,
      preview_reframe: persistedPreview
        ? { ...persistedPreview, model: PREVIEW_MODEL, generated_at: new Date().toISOString() }
        : null,
      // Epic X, NEW: framing_flag/framing_flag_reason are set for every
      // video submission (including "clean" ones — useful for the admin
      // queue to see a check actually ran), left untouched (both stay
      // column-default null) for text/voice.
      ...(isVideoSubmission ? {
        framing_flag: videoFraming.flag,
        framing_flag_reason: videoFraming.reason || null,
        // Sep 2026, NEW: independent of framing_flag/status — see
        // checkVideoFraming's type comment.
        derogatory_flag: videoFraming.derogatory,
        derogatory_flag_reason: videoFraming.derogatory_reason,
        ...(status === "resubmit_requested" ? { video_resubmit_count: (proposal.video_resubmit_count ?? 0) + 1 } : {}),
      } : {}),
    }).eq("id", proposalId);

    // ── Reputation update (read-modify-write, service role) ────────────────────
    // NOTE: the +10 publish reward is applied inside ugq-publish itself when
    // published=true, not here — avoid double-awarding.
    if (repDelta !== 0 || rejectedInc !== 0) {
      const newScore = (rep?.score ?? 0) + repDelta;
      await adminSb.from("user_proposal_reputation").update({
        score: newScore,
        tier: tierForScore(newScore, tier),
        total_rejected: (rep?.total_rejected ?? 0) + rejectedInc,
      }).eq("user_id", proposerId);
    }

    // TODO(step 8): emit proposer notification for terminal states
    // (rejected → in-app; published handled by ugq-publish itself).
    if (status === "rejected") {
      await adminSb.from("user_notifications").insert({
        user_id: proposerId,
        notification_type: "ugq_rejected",
        title: "Your question wasn't published",
        body: `Reason: ${rejection_reason}. You can try rephrasing.`,
        metadata: { proposal_id: proposalId, reason: rejection_reason },
      });
    } else if (status === "resubmit_requested") {
      // Epic X, NEW: ugq-submit's response already carries framing_flag_reason
      // for the proposer's immediate in-flow re-record prompt — this
      // notification is the same message for anyone who navigates away
      // before re-recording.
      await adminSb.from("user_notifications").insert({
        user_id: proposerId,
        notification_type: "ugq_resubmit_requested",
        title: "Please re-record your question",
        body: videoFraming.reason || "Try asking this more neutrally, without suggesting an answer.",
        metadata: { proposal_id: proposalId },
      });
    }

    return json(200, {
      ok: true,
      proposal_id: proposalId,
      status,
      rejection_reason,
      quality_score: screen.quality_score,
      duplicate_of_question_id,
      auto_topic_id: autoTopicId,
      preview_reframe: persistedPreview,
      published,
      question_id: publishedQuestionId,
      // Epic X, NEW: populated only when isVideoSubmission and status is
      // "resubmit_requested" — relayed by ugq-submit to the client.
      framing_flag_reason: status === "resubmit_requested" ? (videoFraming.reason || null) : null,
      // Sep 2026, NEW: independent of status/framing_flag — always
      // populated for video submissions (even "clean"/in_review ones) so
      // the confirm-publish step can show the recommendation regardless of
      // whether framing itself came back clean or leading. Never blocks
      // publish — see checkVideoFraming's prompt / VideoPublishChoice.tsx.
      derogatory_flag: isVideoSubmission ? videoFraming.derogatory : null,
      derogatory_flag_reason: isVideoSubmission ? videoFraming.derogatory_reason : null,
    });
  } catch (err) {
    return json(500, { ok: false, error: "INTERNAL_ERROR", message: (err as Error).message });
  }
});
