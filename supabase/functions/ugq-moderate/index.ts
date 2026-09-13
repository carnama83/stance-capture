// supabase/functions/ugq-moderate/index.ts
// Epic UGQ — Gate 2 admin action endpoint. v6 (2026-08-23): PARALLEL REVIEW for
// auto-published questions.
//
// Background: ugq-screen now auto-publishes proposals that clear Gate 1
// (valid, safe, not duplicate) using the fast unverified preview reframe —
// see ugq-screen for the full rationale. Those questions go live immediately
// with questions.auto_published=true, admin_reviewed_at=null. This version
// adds three admin actions to review them AFTER the fact, without blocking
// the proposer:
//   confirm_published  — admin looked at it, text is fine as published. Sets
//                         admin_reviewed_at/by, no content change.
//   edit_published      — admin tweaks the live question text/slider labels
//                         in place (no unpublish/republish cycle) and marks
//                         it reviewed in the same call.
//   unpublish            — admin takes it down. questions.status only allows
//                         'active'/'archived' and both feed RPCs
//                         (get_for_you_feed, get_trending_questions_homepage)
//                         filter strictly on status='active', so flipping to
//                         'archived' reliably removes it from every feed.
//                         Uses the existing archived_at/archive_reason columns.
// All three look the question up via the proposal's reframed_question_id, so
// they take the same {proposal_id} shape as every other action here.
//
// v5.1: FACT-SHEET PIPELINE (handoff spec 2026-07-06)
// v5.2 (2026-07-08): Stage C verdict-regex fallback — malformed verifier JSON
// (unescaped quotes in verbose sheet_says, run 6) salvages the verdict instead
// of degrading to UNAVAILABLE; a salvaged fail parks without retry (no
// violations to feed back). Pairs with question_verification v7 format contract.
// + QUALITY GATE (2026-07-08): Stage B output is gated on the writer's own
// quality_score against UGQ_MIN_QUALITY (default 8 — the prompt's stated
// minimum). The single B-retry is spent on whichever comes FIRST: a
// below-threshold self-score (fed the writer's own quality_notes as
// deficiencies) or a Stage C fail verdict (fed the violations). Max 1 retry
// total. Better-scoring candidate of the two attempts is kept.
// verification.retry_reason records which gate spent the budget.
//
// Phase 1 — action "approve" (or "edit_and_approve") is now THREE stages:
//   STAGE A  fact_extraction     grounded (web search ON), temp 0. Builds a
//            structured per-case fact sheet. The ONLY stage that touches the web.
//   STAGE B  question_reframing  v6, temp 0.2, web search OFF. Writes the
//            question using ONLY the sheet as its factual source.
//   STAGE C  question_verification v2, temp 0, web search OFF, VERIFY-ONLY.
//            Compares candidate against the sheet; pass|fail; CANNOT rewrite.
//   LOOP: on C fail → ONE retry of B with the violations appended as feedback
//         → re-check → PARK REGARDLESS with the final verdict + violations in
//         reframe_result.verification (admin sees exactly what failed).
//   Result parked on the proposal (reframe_result jsonb, status='reframed').
//   NOTHING IS PUBLISHED in Phase 1.
//
// Failure semantics (design decision, see handoff §graceful degradation):
//   A or B infra/parse failure → nothing usable to park → status back to
//   in_review with a specific error; the admin just clicks Generate again.
//   C infra/parse failure → the candidate is good as far as we know → park it
//   marked verdict:"unavailable" / UNVERIFIED. An outage at the check stage
//   never discards a candidate and never blocks moderation.
//
// Phase 2 — action "publish_reframed": UNCHANGED. Admin-reviewed (possibly
//   edited) text handed to ugq-publish. "discard_reframe" → back to in_review.
// Unchanged: rescreen, reject, flag_proposer; admin auth; checkpoint logging.
//
// Internal fetches authenticate with x-cron-secret ONLY (v3 fix, 2026-07-06):
// runtime-injected legacy Authorization/apikey headers are rejected at the
// platform gateway on this project. Callees must be deployed verify_jwt=false.
//
// Env:
//   UGQ_REFRAME_WEBSEARCH   "true" (default) — enable web_search on STAGE A.
//   UGQ_REFRAME_MAX_SEARCHES  max tool uses for Stage A (default 5).
//   UGQ_REFRAME_VERIFY      "true" (default) — run Stage C. Off = park unverified.
//   UGQ_CORPUS_SEARCH_RPC   optional SQL RPC (p_query text, p_limit int) whose
//                           rows are fed to STAGE A as extra corpus context.
//                           Unset → corpus step skipped gracefully.
//
// Model/temperature are read from each stage's ai_prompts row (fact_extraction,
// question_reframing, question_verification) — prompt calibration and sampling
// config travel together. Compact fallbacks below are degraded safety nets only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

globalThis.addEventListener("unhandledrejection", (e) => {
  console.error("[ugq-moderate] unhandledrejection:", (e as PromiseRejectionEvent).reason);
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Reputation deltas (spec §4.3).
const REJECT_DELTA: Record<string, number> = {
  duplicate: 0, low_quality: -2, not_a_question: -2, guidelines: -2, safety: -15,
};
const FLAG_DELTA = -25;
const FLAG_RATE_LIMIT_DAYS = 7;

// ── Compact fallbacks — used only if the ai_prompts row is missing/inactive ──

const FALLBACK_FACT_PROMPT =
  "You are a forensic fact extractor. Identify each distinct real-world case the proposal " +
  "references, research each with web search, and return ONLY JSON: " +
  '{"cases":[{"case_label":"...","victim_name":null,"victim_place_of_event":null,' +
  '"accused":[{"name_or_role":"...","custody_status":null,"bail_status":null}],' +
  '"event_date":null,"initial_reporting":null,"chargesheet_status":null,"trial_status":null,' +
  '"key_rulings":[],"fast_track_status":null,"source_urls":[]}],' +
  '"shared_features_verified":[],"differences":[]}. ' +
  "Every field sourced or null — never guessed. shared_features_verified only for features " +
  "independently true of EVERY case. No cross-case aggregation anywhere.";

const FALLBACK_REFRAME_PROMPT =
  "You are a civic question framing specialist. You receive a raw question and a structured " +
  "fact sheet; the sheet is your ONLY source of facts — no factual claim may appear unless it " +
  "is in the sheet under the SAME case; cross-case claims only from shared_features_verified; " +
  "if the sheet lacks a fact, omit it. Rewrite the raw question as a single reflection prompt " +
  "answerable on a -2..+2 oppose/support spectrum: one concrete context sentence, one tension " +
  "sentence, one stance question ending in 'you'. 30-45 words, 65 max. Never introduce a " +
  "tradeoff the raw text did not raise. Never name an un-convicted suspect as the doer. Keep " +
  "the proposer's actor. Return ONLY JSON: {\"question\":\"...\",\"framing_style\":\"...\"," +
  "\"core_tension\":\"...\",\"slider_low_label\":\"3-6 word noun phrase\"," +
  "\"slider_high_label\":\"3-6 word noun phrase\",\"quality_score\":<0-10>,\"quality_notes\":\"...\"}.";

const FALLBACK_VERIFY_PROMPT =
  "You are a mechanical checker with NO web access. Compare the candidate question against the " +
  "fact sheet and raw proposal: (1) every factual claim must be in the sheet under the SAME " +
  "case; (2) cross-case claims only from shared_features_verified; (3) the actor must match the " +
  "proposer's actor; (4) form: one question, ends with 'you', <=65 words, no invented pole, " +
  "victims+places named, no guilt presumption. You CANNOT rewrite. Return ONLY JSON: " +
  '{"verdict":"pass|fail","violations":[{"type":"fact|shared|actor|form","claim":"...",' +
  '"sheet_says":"..."}],"summary":"one line"}';

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function tierForScore(score: number, currentTier: string): string {
  if (currentTier === "verified") return "verified";
  return score >= 21 ? "trusted" : "new";
}

// ── LLM call ───────────────────────────────────────────────────────────
async function callReframeLLM(
  provider: string, modelName: string, systemPrompt: string, userPrompt: string,
  apiKey: string, webSearch: boolean, maxSearches: number, temperature: number,
): Promise<{ text: string; sources: string[] }> {
  if (provider === "anthropic") {
    const reqBody: Record<string, unknown> = {
      model: modelName,
      // Was 4096 — hit stop_reason=max_tokens on a genuine 6-case grounded
      // fact sheet (Stage A: multi-incident proposals need victim, accused,
      // custody/bail, chargesheet, trial status, rulings, and source URLs
      // PER case). Raising the ceiling costs nothing when unused — you only
      // pay/wait for tokens actually generated, this just stops truncating
      // legitimately large outputs mid-JSON.
      max_tokens: 8192,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    };
    if (webSearch) {
      reqBody.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches }];
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(reqBody),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Anthropic HTTP ${res.status} (model "${modelName}"): ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    const blocks: Array<Record<string, unknown>> = Array.isArray(data?.content) ? data.content : [];
    console.log(`[ugq-moderate] llm response: stop_reason=${data?.stop_reason} blocks=${blocks.length}`);
    if (data?.stop_reason === "max_tokens") {
      console.error("[ugq-moderate] llm response TRUNCATED at max_tokens — JSON likely incomplete");
    }
    const text = blocks
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n").trim();
    if (!text) throw new Error(`Anthropic returned no text blocks (model "${modelName}")`);
    const sources: string[] = [];
    for (const b of blocks) {
      if (b?.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content as Array<Record<string, unknown>>) {
          if (typeof r?.url === "string" && !sources.includes(r.url)) sources.push(r.url);
        }
      }
    }
    return { text, sources: sources.slice(0, 15) };
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: modelName,
      temperature,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${res.status} (model "${modelName}"): ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return { text: data?.choices?.[0]?.message?.content?.trim() ?? "", sources: [] };
}

function parseJsonLoose(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch { return null; }
  }
  return null;
}

async function loadPrompt(
  adminSb: ReturnType<typeof createClient>, key: string,
  fallbackSystem: string, fallbackModel: string, fallbackTemp: number,
): Promise<{ system: string; model: string; temperature: number; fromRow: boolean }> {
  const { data: row } = await adminSb.from("ai_prompts")
    .select("system_prompt, model, temperature")
    .eq("prompt_key", key).eq("is_active", true).maybeSingle();
  const system = row?.system_prompt && typeof row.system_prompt === "string"
    ? row.system_prompt : fallbackSystem;
  const model = row?.model && typeof row.model === "string" && row.model.trim()
    ? row.model.trim() : fallbackModel;
  const temperature = typeof row?.temperature === "number" && row.temperature >= 0 && row.temperature <= 1
    ? Number(row.temperature) : fallbackTemp;
  return { system, model, temperature, fromRow: !!row?.system_prompt };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

  const provider = (Deno.env.get("REFRAME_MODEL_PROVIDER") ?? "openai").toLowerCase().trim() === "anthropic" ? "anthropic" : "openai";
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const webSearchEnabled = (Deno.env.get("UGQ_REFRAME_WEBSEARCH") ?? "true") === "true";
  const verifyEnabled = (Deno.env.get("UGQ_REFRAME_VERIFY") ?? "true") === "true";
  const maxSearches = Math.max(1, Math.min(8, Number(Deno.env.get("UGQ_REFRAME_MAX_SEARCHES") ?? "5") | 0));
  const corpusRpc = (Deno.env.get("UGQ_CORPUS_SEARCH_RPC") ?? "").trim();

  console.log("[ugq-moderate] env check:", JSON.stringify({
    hasSupabaseUrl: !!SUPABASE_URL,
    hasServiceKey: !!SERVICE_KEY,
    hasAnonKey: !!ANON_KEY,
    hasCronSecret: !!CRON_SECRET,
    hasAnthropicKey: !!anthropicKey,
    provider, webSearchEnabled, verifyEnabled, corpusRpc: corpusRpc || "(none)",
  }));

  try {
    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const proposalId = typeof body.proposal_id === "string" ? body.proposal_id : "";
    const action = typeof body.action === "string" ? body.action : "";
    if (!proposalId || !action) return json(400, { ok: false, error: "MISSING_FIELDS" });

    // Sep 2026, NEW: system-triggered fact-check for voice/video UGQ
    // submissions (see ugq-verify-preview) reuses this EXACT Stage A/B/C
    // pipeline via a service-to-service call instead of duplicating ~300
    // lines of fact-extraction/reframe/verify logic in a second place.
    // Deliberately scoped to action==="approve" ONLY — every other action
    // here (reject, unpublish, flag_proposer, authority tagging,
    // publish_reframed, edit_and_approve...) stays admin-JWT-only; a system
    // caller has no business doing any of those, and edit_and_approve in
    // particular implies a human editing text, which a system call never does.
    const incomingCron = req.headers.get("x-cron-secret") ?? "";
    const isSystemCall = !!CRON_SECRET && incomingCron === CRON_SECRET;

    let adminId: string | null = null;
    if (isSystemCall) {
      if (action !== "approve") {
        return json(403, { ok: false, error: "FORBIDDEN", message: "System calls may only trigger 'approve'." });
      }
    } else {
      const authHeader = req.headers.get("Authorization") ?? "";
      if (!authHeader.startsWith("Bearer ")) return json(401, { ok: false, error: "UNAUTHORIZED" });
      const userSb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await userSb.auth.getUser();
      if (!user) return json(401, { ok: false, error: "UNAUTHORIZED" });
      const { data: adminRow } = await adminSb.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
      if (!adminRow) return json(403, { ok: false, error: "FORBIDDEN" });
      adminId = user.id;
    }

    console.log(`[ugq-moderate] action="${action}" proposal=${proposalId} admin=${adminId ?? "(system)"}`);

    const { data: proposal } = await adminSb.from("user_question_proposals")
      .select("id, user_id, raw_question, admin_edited_question, suggested_topic_id, location_label, status, reframe_result, reframed_question_id")
      .eq("id", proposalId).maybeSingle();
    if (!proposal) return json(404, { ok: false, error: "NOT_FOUND" });

    const { data: rep } = await adminSb.from("user_proposal_reputation")
      .select("score, tier, total_published, total_rejected").eq("user_id", proposal.user_id).maybeSingle();
    const curTier = rep?.tier ?? "new";

    if (action === "rescreen") {
      if (proposal.status !== "proposed") {
        return json(200, {
          ok: true, skipped: true, status: proposal.status,
          message: `Already resolved (status: ${proposal.status}); nothing to re-screen.`,
        });
      }
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 45000);
      try {
        console.log(`[ugq-moderate] rescreen: invoking ugq-screen for ${proposalId}`);
        const screenResp = await fetch(`${SUPABASE_URL}/functions/v1/ugq-screen`, {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            "content-type": "application/json",
            "x-cron-secret": CRON_SECRET,
          },
          body: JSON.stringify({ proposal_id: proposalId }),
        });
        console.log(`[ugq-moderate] rescreen: ugq-screen HTTP ${screenResp.status}`);
        const screenJson = await screenResp.json().catch(() => ({}));
        if (!screenResp.ok || screenJson?.ok === false) {
          console.error("[ugq-moderate] rescreen: SCREEN_FAILED body:", JSON.stringify(screenJson).slice(0, 500));
          return json(502, {
            ok: false, error: "SCREEN_FAILED",
            message: screenJson?.error ?? `ugq-screen returned HTTP ${screenResp.status}`,
          });
        }
        console.log(`[ugq-moderate] rescreen: success, status=${screenJson.status ?? "proposed"}`);
        return json(200, {
          ok: true,
          status: screenJson.status ?? "proposed",
          skipped: screenJson.skipped ?? false,
        });
      } catch (e) {
        console.error("[ugq-moderate] rescreen: fetch threw:", (e as Error).message);
        return json(504, {
          ok: false, error: "SCREEN_TIMEOUT",
          message: (e as Error).message ?? "ugq-screen did not respond in time",
        });
      } finally {
        clearTimeout(t);
      }
    }

    if (action === "reject") {
      const reason = typeof body.reason_code === "string" ? body.reason_code : "guidelines";
      if (!(reason in REJECT_DELTA)) return json(400, { ok: false, error: "BAD_REASON" });
      await adminSb.from("user_question_proposals").update({
        status: "rejected", rejection_reason: reason,
        rejection_note: typeof body.note === "string" ? body.note.slice(0, 1000) : null,
        reviewed_by: adminId, reviewed_at: new Date().toISOString(),
      }).eq("id", proposalId);

      const newScore = (rep?.score ?? 0) + (REJECT_DELTA[reason] ?? -2);
      await adminSb.from("user_proposal_reputation").update({
        score: newScore, tier: tierForScore(newScore, curTier),
        total_rejected: (rep?.total_rejected ?? 0) + 1,
      }).eq("user_id", proposal.user_id);
      await adminSb.from("user_notifications").insert({
        user_id: proposal.user_id,
        notification_type: "ugq_rejected",
        title: "Your question wasn't published",
        body: `Reason: ${reason}. You can try rephrasing.`,
        metadata: { proposal_id: proposalId, reason },
      });
      return json(200, { ok: true, status: "rejected", rejection_reason: reason });
    }

    if (action === "flag_proposer") {
      const newScore = (rep?.score ?? 0) + FLAG_DELTA;
      await adminSb.from("user_proposal_reputation").upsert({
        user_id: proposal.user_id, score: newScore, tier: tierForScore(newScore, curTier),
        flagged: true,
        rate_limited_until: new Date(Date.now() + FLAG_RATE_LIMIT_DAYS * 86400 * 1000).toISOString(),
      }, { onConflict: "user_id" });
      await adminSb.from("user_notifications").insert({
        user_id: proposal.user_id,
        notification_type: "ugq_flagged",
        title: "Your proposal privileges have been restricted",
        body: "Proposing is temporarily paused on your account.",
      });
      return json(200, { ok: true, flagged: true });
    }

    // ── NEW (Aug 2026): parallel-review actions for auto-published questions ──
    // All three act on the live `questions` row via proposal.reframed_question_id
    // (set by ugq-publish regardless of which path — admin or auto — published
    // it). Guard: only meaningful once a question actually exists.
    if (action === "confirm_published" || action === "edit_published" || action === "unpublish") {
      if (proposal.status !== "published" || !proposal.reframed_question_id) {
        return json(409, {
          ok: false, error: "NOT_PUBLISHED",
          message: `Proposal is '${proposal.status}' with no linked question — nothing to review.`,
        });
      }
      const questionId = proposal.reframed_question_id as string;

      if (action === "confirm_published") {
        await adminSb.from("questions").update({
          admin_reviewed_at: new Date().toISOString(),
          admin_reviewed_by: adminId,
        }).eq("id", questionId);
        console.log(`[ugq-moderate] confirm_published: ${questionId} reviewed by ${adminId}`);
        return json(200, { ok: true, question_id: questionId, admin_reviewed: true });
      }

      if (action === "edit_published") {
        const editedQuestion = typeof body.edited_question === "string" ? body.edited_question.trim() : "";
        const sliderLow = typeof body.slider_low_label === "string" ? body.slider_low_label.trim() : undefined;
        const sliderHigh = typeof body.slider_high_label === "string" ? body.slider_high_label.trim() : undefined;
        if (!editedQuestion) return json(400, { ok: false, error: "MISSING_QUESTION" });

        const updatePayload: Record<string, unknown> = {
          question: editedQuestion,
          admin_reviewed_at: new Date().toISOString(),
          admin_reviewed_by: adminId,
        };
        if (sliderLow !== undefined) updatePayload.slider_low_label = sliderLow || null;
        if (sliderHigh !== undefined) updatePayload.slider_high_label = sliderHigh || null;

        await adminSb.from("questions").update(updatePayload).eq("id", questionId);
        // Mirror the edit back onto the proposal for audit, same convention
        // edit_and_approve uses for the fact-checked path.
        await adminSb.from("user_question_proposals").update({
          admin_edited_question: editedQuestion,
        }).eq("id", proposalId);
        console.log(`[ugq-moderate] edit_published: ${questionId} edited + reviewed by ${adminId}`);
        return json(200, { ok: true, question_id: questionId, admin_reviewed: true, question: editedQuestion });
      }

      // action === "unpublish"
      const reasonNote = typeof body.note === "string" ? body.note.slice(0, 1000) : "Removed by admin review";
      await adminSb.from("questions").update({
        status: "archived",
        archived_at: new Date().toISOString(),
        archive_reason: reasonNote,
        admin_reviewed_at: new Date().toISOString(),
        admin_reviewed_by: adminId,
      }).eq("id", questionId);
      console.log(`[ugq-moderate] unpublish: ${questionId} archived by ${adminId} — ${reasonNote}`);
      // No reputation penalty by default — the proposal cleared Gate 1
      // legitimately; a reframing/quality miss isn't necessarily the
      // proposer's fault. Use flag_proposer separately for actual abuse.
      return json(200, { ok: true, question_id: questionId, archived: true });
    }

    // ── NEW (Aug 2026): confirm/reject a proposer-tagged authority ───────────
    // Mirrors the pending_authority_suggestions pattern for the news pipeline:
    // nothing the PROPOSER does writes to the real, publicly-read
    // question_authority_map directly. This is the admin gate that actually
    // makes a tag public — confirm inserts the real mapping; reject just
    // marks the suggestion closed, no public-facing change either way.
    if (action === "confirm_authority_tag" || action === "reject_authority_tag") {
      const suggestionId = typeof body.suggestion_id === "string" ? body.suggestion_id : "";
      if (!suggestionId) return json(400, { ok: false, error: "MISSING_SUGGESTION_ID" });

      const { data: suggestion } = await adminSb.from("user_authority_suggestions")
        .select("id, question_id, authority_id, status").eq("id", suggestionId).maybeSingle();
      if (!suggestion) return json(404, { ok: false, error: "SUGGESTION_NOT_FOUND" });
      if (suggestion.status !== "user_tagged") {
        return json(409, {
          ok: false, error: "NOT_PENDING",
          message: `Suggestion is '${suggestion.status}' — only 'user_tagged' suggestions can be confirmed/rejected.`,
        });
      }

      if (action === "confirm_authority_tag") {
        // confidence_level='confirmed': a human (proposer) picked it AND an
        // admin approved it — same bar the existing admin-only write path
        // already implies for anything landing in this table.
        const { error: mapErr } = await adminSb.from("question_authority_map").upsert({
          question_id: suggestion.question_id,
          authority_id: suggestion.authority_id,
          confidence_level: "confirmed",
          assigned_by: adminId,
        }, { onConflict: "question_id,authority_id" });
        if (mapErr) {
          console.error(JSON.stringify({ tag: "ugq-moderate.confirm_authority_tag_failed", message: mapErr.message }));
          return json(500, { ok: false, error: "MAP_INSERT_FAILED", message: mapErr.message });
        }
        await adminSb.from("user_authority_suggestions").update({
          status: "approved", reviewed_by: adminId, reviewed_at: new Date().toISOString(),
        }).eq("id", suggestionId);
        console.log(`[ugq-moderate] confirm_authority_tag: ${suggestionId} -> question_authority_map by ${adminId}`);
        return json(200, { ok: true, suggestion_id: suggestionId, status: "approved" });
      }

      // action === "reject_authority_tag"
      await adminSb.from("user_authority_suggestions").update({
        status: "rejected", reviewed_by: adminId, reviewed_at: new Date().toISOString(),
      }).eq("id", suggestionId);
      console.log(`[ugq-moderate] reject_authority_tag: ${suggestionId} rejected by ${adminId}`);
      return json(200, { ok: true, suggestion_id: suggestionId, status: "rejected" });
    }

    if (action === "approve" || action === "edit_and_approve") {
      const edited = action === "edit_and_approve" && typeof body.edited_question === "string"
        ? body.edited_question.trim() : null;
      const questionText = edited || proposal.admin_edited_question || proposal.raw_question;

      const topicId = (typeof body.topic_id === "string" && body.topic_id) ? body.topic_id : proposal.suggested_topic_id;
      if (!topicId) return json(400, { ok: false, error: "TOPIC_REQUIRED", message: "Assign a topic before generating." });

      if (!anthropicKey) return json(500, { ok: false, error: "NO_LLM_KEY", message: "ANTHROPIC_API_KEY is required for the fact-sheet pipeline." });
      const stageBKey = provider === "anthropic" ? anthropicKey : openaiKey;
      if (!stageBKey) return json(500, { ok: false, error: "NO_LLM_KEY" });

      await adminSb.from("user_question_proposals").update({
        status: "reframing",
        admin_edited_question: edited ?? proposal.admin_edited_question,
        reviewed_by: adminId, reviewed_at: new Date().toISOString(),
      }).eq("id", proposalId);

      async function backToReview(status: number, error: string, message: string, extra?: Record<string, unknown>) {
        await adminSb.from("user_question_proposals").update({ status: "in_review" }).eq("id", proposalId);
        return json(status, { ok: false, error, message, ...(extra ?? {}) });
      }

      const factP = await loadPrompt(adminSb, "fact_extraction", FALLBACK_FACT_PROMPT, "claude-sonnet-4-6", 0);
      const framP = await loadPrompt(adminSb, "question_reframing", FALLBACK_REFRAME_PROMPT,
        provider === "anthropic" ? "claude-sonnet-4-6" : "gpt-4o-mini", 0.2);
      const verP = await loadPrompt(adminSb, "question_verification", FALLBACK_VERIFY_PROMPT, "claude-sonnet-4-6", 0);
      console.log(`[ugq-moderate] prompts: fact=${factP.fromRow ? "row" : "FALLBACK"} reframe=${framP.fromRow ? "row" : "FALLBACK"} verify=${verP.fromRow ? "row" : "FALLBACK"}`);

      const { data: topicRow } = await adminSb.from("topics").select("title").eq("id", topicId).maybeSingle();
      const topicTitle = topicRow?.title ?? "(none)";

      let corpusDigest = "";
      if (corpusRpc) {
        try {
          const { data: hits, error: rpcErr } = await adminSb.rpc(corpusRpc, {
            p_query: questionText, p_limit: 5,
          });
          if (!rpcErr && Array.isArray(hits) && hits.length) {
            corpusDigest = hits
              .map((h: Record<string, unknown>, i: number) =>
                `[corpus ${i + 1}] ${JSON.stringify(h).slice(0, 700)}`)
              .join("\n");
            console.log(`[ugq-moderate] stageA: corpus hits=${hits.length}`);
          } else if (rpcErr) {
            console.error("[ugq-moderate] stageA: corpus RPC error:", rpcErr.message);
          }
        } catch (e) {
          console.error("[ugq-moderate] stageA: corpus step threw:", (e as Error).message);
        }
      }

      const factUser =
        `Raw proposal:\n"${questionText}"\n\n` +
        `Topic title: ${topicTitle}\n` +
        `Location: ${proposal.location_label ?? "(none)"}\n\n` +
        (corpusDigest ? `Additional corpus context (verify before use, cite the URLs you rely on):\n${corpusDigest}\n\n` : "") +
        `Extract the per-case fact sheet for every real-world case this proposal references. ` +
        (webSearchEnabled ? `Use web search to verify the CURRENT state of each case. ` : `No web search is available; fill only what the provided context supports and leave the rest null. `) +
        `Return ONLY the JSON object specified in the system prompt.`;

      console.log(`[ugq-moderate] stageA: extracting (webSearch=${webSearchEnabled}, model=${factP.model}, temp=${factP.temperature})`);
      let sheetRaw: { text: string; sources: string[] };
      try {
        sheetRaw = await callReframeLLM("anthropic", factP.model, factP.system, factUser,
          anthropicKey, webSearchEnabled, maxSearches, factP.temperature);
      } catch (e) {
        console.error("[ugq-moderate] stageA: LLM failed:", (e as Error).message);
        return await backToReview(502, "FACT_EXTRACTION_FAILED", (e as Error).message);
      }
      const factSheet = parseJsonLoose(sheetRaw.text);
      if (!factSheet || !Array.isArray(factSheet.cases)) {
        console.error("[ugq-moderate] stageA: unparseable sheet. head:", sheetRaw.text.slice(0, 400));
        return await backToReview(502, "FACT_EXTRACTION_FAILED", "Fact sheet was not valid JSON. Generate again.");
      }
      const sheetJson = JSON.stringify(factSheet);
      console.log(`[ugq-moderate] stageA: sheet cases=${(factSheet.cases as unknown[]).length} shared=${Array.isArray(factSheet.shared_features_verified) ? (factSheet.shared_features_verified as unknown[]).length : 0} sources=${sheetRaw.sources.length}`);

      function buildStageBUser(violationsFeedback: string): string {
        return (
          `Raw question to reframe:\n"${questionText}"\n\n` +
          `Topic context:\nTopic title: ${topicTitle}\n` +
          `Location: ${proposal.location_label ?? "(none)"}\n\n` +
          `FACT SHEET (your ONLY source of facts):\n${sheetJson}\n\n` +
          (violationsFeedback
            ? `A previous attempt FAILED verification with these violations — fix every one of them:\n${violationsFeedback}\n\n`
            : "") +
          `Instructions:\n` +
          `1. No factual claim may appear in the question unless it is in the fact sheet under the SAME case; cross-case claims only from shared_features_verified; if the sheet lacks a fact, omit it.\n` +
          `2. Follow the FIDELITY, PATTERN PRESERVATION, and ACCUSED PERSONS rules strictly: measure the proposer's stance, keep the proposer's actor, keep every case they linked, never presume an un-convicted suspect's guilt.\n` +
          `3. Produce exactly ONE stance question answerable on a -2..+2 oppose/support spectrum.\n` +
          `4. Return ONLY the JSON object specified in the system prompt.`
        );
      }

      type Candidate = {
        question: string; framing_style: string | null; core_tension: string | null;
        slider_low_label: string | null; slider_high_label: string | null;
        quality_score: number | null; quality_notes: string;
      };

      async function runStageB(feedback: string): Promise<Candidate | { gated: string } | { failed: string }> {
        console.log(`[ugq-moderate] stageB: writing (model=${framP.model}, temp=${framP.temperature}, retry=${feedback ? "yes" : "no"})`);
        let out: { text: string; sources: string[] };
        try {
          out = await callReframeLLM(provider, framP.model, framP.system, buildStageBUser(feedback),
            stageBKey, false, maxSearches, framP.temperature);
        } catch (e) {
          return { failed: (e as Error).message };
        }
        const parsed = parseJsonLoose(out.text);
        if (!parsed) {
          // parseJsonLoose swallows its own error internally — re-run JSON.parse
          // just to surface the real message (e.g. "Unterminated string at
          // position N"), and log the FULL text, not a 400-char head, so the
          // actual break point is visible instead of guessed at.
          const cleaned = out.text.replace(/```json/gi, "").replace(/```/g, "").trim();
          let parseErrMsg = "unknown";
          try { JSON.parse(cleaned); } catch (pe) { parseErrMsg = (pe as Error).message; }
          console.error(JSON.stringify({
            tag: "ugq-moderate.stageB_json_parse_error",
            message: parseErrMsg,
            text_length: out.text.length,
            full_text: out.text,
          }));
          return { gated: "Reframe output was not valid JSON — this is a parse failure, not a content rejection. Generate again." };
        }
        const q = (parsed.question && typeof parsed.question === "string") ? parsed.question.trim() : "";
        const qScore = typeof parsed.quality_score === "number" ? parsed.quality_score : null;
        const qNotes = typeof parsed.quality_notes === "string" ? parsed.quality_notes : "";
        const guiltFlag = qNotes.includes("presumes_guilt");
        if (!q || qScore === 0 || guiltFlag) {
          console.error(JSON.stringify({
            tag: "ugq-moderate.stageB_gated",
            score: qScore, guilt: guiltFlag, notes: qNotes,
            parsed_keys: Object.keys(parsed),
            question_field_present: "question" in parsed,
            question_field_type: typeof parsed.question,
          }));
          if (qNotes) return { gated: qNotes };
          const specificReason = guiltFlag
            ? "the model's own quality_notes flagged presumes_guilt"
            : qScore === 0
            ? "the model self-scored this 0/10"
            : "the model's response had no usable question field";
          return { gated: `Reframe unusable — ${specificReason}.` };
        }
        return {
          question: q,
          framing_style: typeof parsed.framing_style === "string" ? parsed.framing_style : null,
          core_tension: typeof parsed.core_tension === "string" ? parsed.core_tension : null,
          slider_low_label: typeof parsed.slider_low_label === "string" ? parsed.slider_low_label : null,
          slider_high_label: typeof parsed.slider_high_label === "string" ? parsed.slider_high_label : null,
          quality_score: qScore,
          quality_notes: qNotes,
        };
      }

      type Verdict = { verdict: string; violations: unknown[]; summary: string; malformed?: boolean } | { unavailable: string };

      async function runStageC(cand: Candidate): Promise<Verdict> {
        const verifyUser =
          `Proposer's raw question:\n"${questionText}"\n\n` +
          `FACT SHEET (the only factual reference):\n${sheetJson}\n\n` +
          `Candidate reframed question:\n"${cand.question}"\n` +
          `Slider oppose end: ${cand.slider_low_label ?? "(none)"}\n` +
          `Slider support end: ${cand.slider_high_label ?? "(none)"}\n\n` +
          `Compare the candidate against the fact sheet and the raw question per the system prompt. Return ONLY the JSON verdict object.`;
        console.log(`[ugq-moderate] stageC: checking (model=${verP.model}, temp=${verP.temperature})`);
        try {
          const out = await callReframeLLM("anthropic", verP.model, verP.system, verifyUser,
            anthropicKey, false, maxSearches, verP.temperature);
          const v = parseJsonLoose(out.text);
          const verdict = typeof v?.verdict === "string" ? v.verdict : "";
          if (verdict !== "pass" && verdict !== "fail") {
            const m = out.text.match(/"verdict"\s*:\s*"(pass|fail)"/);
            if (m) {
              console.error(`[ugq-moderate] stageC: malformed JSON, salvaged verdict=${m[1]} (violations lost)`);
              return {
                verdict: m[1],
                violations: [],
                summary: "verifier JSON malformed — verdict salvaged, violations list unrecoverable",
                malformed: true,
              };
            }
            return { unavailable: `unparseable verdict: ${out.text.slice(0, 200)}` };
          }
          return {
            verdict,
            violations: Array.isArray(v?.violations) ? v.violations : [],
            summary: typeof v?.summary === "string" ? v.summary : "",
          };
        } catch (e) {
          return { unavailable: (e as Error).message };
        }
      }

      const minQuality = Math.max(0, Math.min(10, Number(Deno.env.get("UGQ_MIN_QUALITY") ?? "8") | 0));

      let attempt = await runStageB("");
      if ("failed" in attempt) return await backToReview(502, "REFRAME_FAILED", attempt.failed);
      if ("gated" in attempt) {
        return await backToReview(422, "REFRAME_LOW_QUALITY",
          attempt.gated + " Edit the raw question or pick a more specific topic, then generate again.");
      }
      let candidate = attempt as Candidate;

      let verification: Record<string, unknown>;
      let originalAttempt: Record<string, unknown> | null = null;
      let retried = false;
      let retryReason: string | null = null;
      let retryBudget = 1;

      if (typeof candidate.quality_score === "number" && candidate.quality_score < minQuality && retryBudget > 0) {
        retryBudget--; retried = true; retryReason = "below_threshold";
        console.log(`[ugq-moderate] quality gate: self-score ${candidate.quality_score} < ${minQuality} — retrying Stage B once`);
        originalAttempt = {
          reason: "below_threshold",
          question: candidate.question,
          slider_low_label: candidate.slider_low_label,
          slider_high_label: candidate.slider_high_label,
          quality_score: candidate.quality_score,
          quality_notes: candidate.quality_notes,
        };
        const feedback = JSON.stringify({
          below_threshold: candidate.quality_score,
          minimum_required: minQuality,
          deficiencies: candidate.quality_notes,
          instruction: `Rewrite to score at least ${minQuality}. Fix every deficiency listed above; keep everything that already satisfied the rules.`,
        });
        const attempt2 = await runStageB(feedback);
        if ("failed" in attempt2 || "gated" in attempt2) {
          console.error("[ugq-moderate] quality gate: retry unusable — keeping original candidate");
        } else {
          const cand2 = attempt2 as Candidate;
          if (typeof cand2.quality_score !== "number" ||
              typeof candidate.quality_score !== "number" ||
              cand2.quality_score >= candidate.quality_score) {
            candidate = cand2;
          } else {
            console.log(`[ugq-moderate] quality gate: retry scored ${cand2.quality_score} < original ${candidate.quality_score} — keeping original`);
          }
        }
      }

      if (!verifyEnabled) {
        verification = { verdict: "skipped", summary: "UGQ_REFRAME_VERIFY=false" };
      } else {
        let v1 = await runStageC(candidate);
        if ("unavailable" in v1) {
          console.error("[ugq-moderate] stageC: unavailable:", v1.unavailable);
          verification = { verdict: "unavailable", error: v1.unavailable };
        } else if (v1.verdict === "pass") {
          verification = { verdict: "pass", violations: [], summary: v1.summary, ...(v1.malformed ? { malformed: true } : {}) };
        } else if (v1.malformed) {
          console.log(`[ugq-moderate] loop: salvaged fail with no violations — parking without retry`);
          verification = { verdict: "fail", violations: [], summary: v1.summary, malformed: true, retry: "skipped_no_feedback" };
        } else if (retryBudget <= 0) {
          console.log(`[ugq-moderate] loop: verdict=fail, retry budget spent on quality gate — parking as-is`);
          verification = { verdict: "fail", violations: v1.violations, summary: v1.summary, retry: "budget_spent_on_quality" };
        } else {
          retryBudget--; retried = true; retryReason = "verifier_fail";
          console.log(`[ugq-moderate] loop: verdict=fail violations=${v1.violations.length} — retrying Stage B once`);
          originalAttempt = {
            reason: "verifier_fail",
            question: candidate.question,
            slider_low_label: candidate.slider_low_label,
            slider_high_label: candidate.slider_high_label,
            quality_score: candidate.quality_score,
            violations: v1.violations,
          };
          const feedback = JSON.stringify({ violations: v1.violations, summary: v1.summary });
          const attempt2 = await runStageB(feedback);
          if ("failed" in attempt2 || "gated" in attempt2) {
            console.error("[ugq-moderate] loop: retry unusable — parking original with fail verdict");
            verification = { verdict: "fail", violations: v1.violations, summary: v1.summary, retry: "retry_unusable" };
          } else {
            candidate = attempt2 as Candidate;
            const v2 = await runStageC(candidate);
            if ("unavailable" in v2) {
              verification = { verdict: "unavailable", error: v2.unavailable, retried: true };
            } else {
              verification = { verdict: v2.verdict, violations: v2.violations, summary: v2.summary, retried: true };
            }
          }
        }
      }
      verification = { ...verification, model: verP.model, verified_at: new Date().toISOString(), retry_reason: retryReason };

      const verdictStr = String((verification as Record<string, unknown>).verdict);
      const verSummary = typeof (verification as Record<string, unknown>).summary === "string"
        ? (verification as Record<string, unknown>).summary as string : "";
      const verViolations = Array.isArray((verification as Record<string, unknown>).violations)
        ? (verification as Record<string, unknown>).violations as unknown[] : [];

      const reframeResult: Record<string, unknown> = {
        question: candidate.question,
        framing_style: candidate.framing_style,
        core_tension: candidate.core_tension,
        slider_low_label: candidate.slider_low_label,
        slider_high_label: candidate.slider_high_label,
        quality_score: candidate.quality_score,
        quality_notes: [
          candidate.quality_notes || null,
          verdictStr === "unavailable"
            ? "verifier: UNAVAILABLE — claims not checked against the sheet"
            : `verifier(${verdictStr})${retried ? " after 1 retry" : ""}: ${verSummary || (verViolations.length ? JSON.stringify(verViolations).slice(0, 300) : "all claims held")}`,
        ].filter(Boolean).join(" · "),
        fact_sheet: factSheet,
        verification,
        retried,
        original_attempt: originalAttempt,
        sources: sheetRaw.sources,
        topic_id: topicId,
        model: framP.model,
        web_search: webSearchEnabled,
        generated_at: new Date().toISOString(),
      };

      await adminSb.from("user_question_proposals").update({
        status: "reframed",
        reframe_result: reframeResult,
      }).eq("id", proposalId);

      console.log(`[ugq-moderate] parked at 'reframed' (verdict=${verdictStr}, retried=${retried}, score=${candidate.quality_score}, sources=${sheetRaw.sources.length})`);
      return json(200, { ok: true, status: "reframed", ...reframeResult });
    }

    if (action === "publish_reframed") {
      if (proposal.status !== "reframed" || !proposal.reframe_result) {
        return json(409, {
          ok: false, error: "NOT_REFRAMED",
          message: `Proposal is '${proposal.status}'; generate a reframe first.`,
        });
      }
      const rr = proposal.reframe_result as Record<string, unknown>;

      const finalQuestion = (typeof body.final_question === "string" && body.final_question.trim())
        ? body.final_question.trim()
        : (typeof rr.question === "string" ? rr.question : "");
      const topicId = (typeof body.topic_id === "string" && body.topic_id)
        ? body.topic_id
        : (typeof rr.topic_id === "string" ? rr.topic_id : proposal.suggested_topic_id);
      const sliderLow = (typeof body.slider_low_label === "string" && body.slider_low_label.trim())
        ? body.slider_low_label.trim()
        : (typeof rr.slider_low_label === "string" ? rr.slider_low_label : null);
      const sliderHigh = (typeof body.slider_high_label === "string" && body.slider_high_label.trim())
        ? body.slider_high_label.trim()
        : (typeof rr.slider_high_label === "string" ? rr.slider_high_label : null);

      if (!finalQuestion) return json(400, { ok: false, error: "MISSING_QUESTION" });
      if (!topicId) return json(400, { ok: false, error: "TOPIC_REQUIRED" });

      console.log(`[ugq-moderate] phase2: invoking ugq-publish for ${proposalId}`);
      const pubResp = await fetch(`${SUPABASE_URL}/functions/v1/ugq-publish`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-cron-secret": CRON_SECRET,
        },
        body: JSON.stringify({
          proposal_id: proposalId,
          reframed_question: finalQuestion,
          topic_id: topicId,
          slider_low_label: sliderLow,
          slider_high_label: sliderHigh,
        }),
      });
      console.log(`[ugq-moderate] phase2: ugq-publish HTTP ${pubResp.status}`);
      const pubJson = await pubResp.json().catch(() => ({}));
      if (!pubResp.ok || !pubJson?.ok) {
        console.error("[ugq-moderate] phase2: PUBLISH_FAILED body:", JSON.stringify(pubJson).slice(0, 500));
        return json(502, { ok: false, error: "PUBLISH_FAILED", message: pubJson?.message ?? "Publish failed" });
      }

      await adminSb.from("user_question_proposals").update({
        reframe_result: { ...rr, published_question: finalQuestion, published_at: new Date().toISOString() },
      }).eq("id", proposalId);

      return json(200, { ok: true, status: "published", question_id: pubJson.question_id, published_question: finalQuestion });
    }

    if (action === "discard_reframe") {
      if (proposal.status !== "reframed") {
        return json(409, { ok: false, error: "NOT_REFRAMED", message: `Proposal is '${proposal.status}'.` });
      }
      await adminSb.from("user_question_proposals").update({
        status: "in_review", reframe_result: null,
      }).eq("id", proposalId);
      console.log(`[ugq-moderate] discard_reframe: ${proposalId} back to in_review`);
      return json(200, { ok: true, status: "in_review" });
    }

    return json(400, { ok: false, error: "UNKNOWN_ACTION" });
  } catch (err) {
    console.error("[ugq-moderate] INTERNAL_ERROR:", (err as Error)?.message, (err as Error)?.stack?.slice(0, 800));
    return json(500, { ok: false, error: "INTERNAL_ERROR", message: (err as Error).message });
  }
});
