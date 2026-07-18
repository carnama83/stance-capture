// supabase/functions/ugq-moderate/index.ts
// Epic UGQ — Gate 2 admin action endpoint. v5.1: FACT-SHEET PIPELINE (handoff spec 2026-07-06)
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

// ── LLM call ──────────────────────────────────────────────────────────────────
// Anthropic path supports the server-side web_search tool (Stage A only). With
// tools enabled the response contains MULTIPLE content blocks (text,
// server_tool_use, web_search_tool_result); text must be gathered across ALL
// text blocks — never read content[0] alone. Source URLs harvested best-effort.
async function callReframeLLM(
  provider: string, modelName: string, systemPrompt: string, userPrompt: string,
  apiKey: string, webSearch: boolean, maxSearches: number, temperature: number,
): Promise<{ text: string; sources: string[] }> {
  if (provider === "anthropic") {
    const reqBody: Record<string, unknown> = {
      model: modelName,
      // Grounded calls emit post-search synthesis before the JSON; 2048 was
      // observed truncating mid-JSON (stop_reason max_tokens → parse failure).
      max_tokens: 4096,
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

  // OpenAI path: plain call, no web grounding.
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
  // Grounded responses may include prose around the JSON; extract outermost object.
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch { return null; }
  }
  return null;
}

// Load a stage's prompt row; row model/temperature are authoritative when present.
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

  // CHECKPOINT 1 — env presence (no secret values logged).
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

    // ── Admin auth ─────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json(401, { ok: false, error: "UNAUTHORIZED" });
    const userSb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userSb.auth.getUser();
    if (!user) return json(401, { ok: false, error: "UNAUTHORIZED" });
    const { data: adminRow } = await adminSb.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!adminRow) return json(403, { ok: false, error: "FORBIDDEN" });
    const adminId = user.id;

    const body = await req.json().catch(() => ({}));
    const proposalId = typeof body.proposal_id === "string" ? body.proposal_id : "";
    const action = typeof body.action === "string" ? body.action : "";
    if (!proposalId || !action) return json(400, { ok: false, error: "MISSING_FIELDS" });

    // CHECKPOINT 2 — auth passed, request parsed.
    console.log(`[ugq-moderate] action="${action}" proposal=${proposalId} admin=${adminId}`);

    const { data: proposal } = await adminSb.from("user_question_proposals")
      .select("id, user_id, raw_question, admin_edited_question, suggested_topic_id, location_label, status, reframe_result")
      .eq("id", proposalId).maybeSingle();
    if (!proposal) return json(404, { ok: false, error: "NOT_FOUND" });

    const { data: rep } = await adminSb.from("user_proposal_reputation")
      .select("score, tier, total_published, total_rejected").eq("user_id", proposal.user_id).maybeSingle();
    const curTier = rep?.tier ?? "new";

    // ── RESCREEN (re-run Gate 1 on a stuck 'proposed' proposal) ─────────────────
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

    // ── REJECT ─────────────────────────────────────────────────────────────────
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

    // ── FLAG PROPOSER ──────────────────────────────────────────────────────────
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

    // ── PHASE 1: APPROVE / EDIT_AND_APPROVE → A extract, B write, C check, PARK ─
    if (action === "approve" || action === "edit_and_approve") {
      const edited = action === "edit_and_approve" && typeof body.edited_question === "string"
        ? body.edited_question.trim() : null;
      const questionText = edited || proposal.admin_edited_question || proposal.raw_question;

      const topicId = (typeof body.topic_id === "string" && body.topic_id) ? body.topic_id : proposal.suggested_topic_id;
      if (!topicId) return json(400, { ok: false, error: "TOPIC_REQUIRED", message: "Assign a topic before generating." });

      // Stage A (grounded) and Stage C run on Anthropic; Stage B follows the
      // provider env like v4.3 (all three rows currently pin claude-sonnet-4-6).
      if (!anthropicKey) return json(500, { ok: false, error: "NO_LLM_KEY", message: "ANTHROPIC_API_KEY is required for the fact-sheet pipeline." });
      const stageBKey = provider === "anthropic" ? anthropicKey : openaiKey;
      if (!stageBKey) return json(500, { ok: false, error: "NO_LLM_KEY" });

      await adminSb.from("user_question_proposals").update({
        status: "reframing",
        admin_edited_question: edited ?? proposal.admin_edited_question,
        reviewed_by: adminId, reviewed_at: new Date().toISOString(),
      }).eq("id", proposalId);

      // Roll back to in_review with a specific error (A/B failures — nothing to park).
      async function backToReview(status: number, error: string, message: string, extra?: Record<string, unknown>) {
        await adminSb.from("user_question_proposals").update({ status: "in_review" }).eq("id", proposalId);
        return json(status, { ok: false, error, message, ...(extra ?? {}) });
      }

      // Load the three stage prompts (row model/temperature authoritative).
      const factP = await loadPrompt(adminSb, "fact_extraction", FALLBACK_FACT_PROMPT, "claude-sonnet-4-6", 0);
      const framP = await loadPrompt(adminSb, "question_reframing", FALLBACK_REFRAME_PROMPT,
        provider === "anthropic" ? "claude-sonnet-4-6" : "gpt-4o-mini", 0.2);
      const verP = await loadPrompt(adminSb, "question_verification", FALLBACK_VERIFY_PROMPT, "claude-sonnet-4-6", 0);
      console.log(`[ugq-moderate] prompts: fact=${factP.fromRow ? "row" : "FALLBACK"} reframe=${framP.fromRow ? "row" : "FALLBACK"} verify=${verP.fromRow ? "row" : "FALLBACK"}`);

      // Topic title for context.
      const { data: topicRow } = await adminSb.from("topics").select("title").eq("id", topicId).maybeSingle();
      const topicTitle = topicRow?.title ?? "(none)";

      // Optional Route 1 corpus digest — fed to STAGE A as extra context.
      // Best-effort: any failure degrades to no digest, never blocks.
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

      // ── STAGE A — fact sheet (grounded, temp from row [0]) ──────────────────
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

      // ── STAGE B — write from sheet (web search OFF) ─────────────────────────
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
        const q = (parsed?.question && typeof parsed.question === "string") ? parsed.question.trim() : "";
        const qScore = parsed && typeof parsed.quality_score === "number" ? parsed.quality_score : null;
        const qNotes = typeof parsed?.quality_notes === "string" ? parsed.quality_notes : "";
        const guiltFlag = qNotes.includes("presumes_guilt");
        if (!q || qScore === 0 || guiltFlag) {
          console.error(`[ugq-moderate] stageB: gated (score=${qScore}, guilt=${guiltFlag}, notes=${qNotes.slice(0, 200)})`);
          console.error(`[ugq-moderate] stageB: raw output head: ${out.text.slice(0, 400)}`);
          return { gated: qNotes || "Reframe unusable (no question / score 0 / presumes guilt)." };
        }
        return {
          question: q,
          framing_style: typeof parsed?.framing_style === "string" ? parsed.framing_style : null,
          core_tension: typeof parsed?.core_tension === "string" ? parsed.core_tension : null,
          slider_low_label: typeof parsed?.slider_low_label === "string" ? parsed.slider_low_label : null,
          slider_high_label: typeof parsed?.slider_high_label === "string" ? parsed.slider_high_label : null,
          quality_score: qScore,
          quality_notes: qNotes,
        };
      }

      // ── STAGE C — check against sheet (verify-only, web search OFF) ─────────
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
            // v5.2 fallback: malformed JSON (e.g. unescaped quotes inside a
            // verbose sheet_says — observed run 6) but the verdict itself is
            // usually intact at the head of the output. Salvage it by regex so
            // one bad string doesn't degrade a completed check to UNAVAILABLE.
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

      // ── B → [quality gate] → C, ONE shared retry, park regardless ───────────
      // The single retry is spent on whichever failure comes FIRST:
      //   (a) the writer's own quality_score below the prompt's minimum bar
      //       (the prompt demands >= 8; v5.0 gated only on score === 0, so a
      //       self-declared 5/10 sailed into verification and burned the retry
      //       on an unsalvageable candidate — observed acceptance run 5), or
      //   (b) a Stage C fail verdict.
      // Never both: retries are capped at 1 total to hold the latency budget.
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

      // Quality gate — the writer's own verdict. Strict numeric check: a null
      // score is unknown, not below-bar; never coerce (score === null discipline).
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
          // Keep the better-scoring candidate; ties go to the retry (it saw feedback).
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
          // Salvaged fail: no violations survived, so retry feedback would be
          // empty — park as-is; the admin regenerates or edits by hand.
          console.log(`[ugq-moderate] loop: salvaged fail with no violations — parking without retry`);
          verification = { verdict: "fail", violations: [], summary: v1.summary, malformed: true, retry: "skipped_no_feedback" };
        } else if (retryBudget <= 0) {
          // Budget already spent at the quality gate: park with the fail verdict.
          console.log(`[ugq-moderate] loop: verdict=fail, retry budget spent on quality gate — parking as-is`);
          verification = { verdict: "fail", violations: v1.violations, summary: v1.summary, retry: "budget_spent_on_quality" };
        } else {
          // ONE retry of Stage B with the violations as feedback.
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
            // Retry infra-failed or gated: park the ORIGINAL candidate with its
            // fail verdict — the admin sees exactly what failed and edits by hand.
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

      // ── PARK. Nothing published until the admin reviews this. ───────────────
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
        sources: sheetRaw.sources,          // Stage A grounding = the audit trail
        topic_id: topicId,
        model: framP.model,
        web_search: webSearchEnabled,       // grounding happened at Stage A
        generated_at: new Date().toISOString(),
      };

      await adminSb.from("user_question_proposals").update({
        status: "reframed",
        reframe_result: reframeResult,
      }).eq("id", proposalId);

      console.log(`[ugq-moderate] parked at 'reframed' (verdict=${verdictStr}, retried=${retried}, score=${candidate.quality_score}, sources=${sheetRaw.sources.length})`);
      return json(200, { ok: true, status: "reframed", ...reframeResult });
    }

    // ── PHASE 2: PUBLISH_REFRAMED → hand the reviewed text to ugq-publish ──────
    if (action === "publish_reframed") {
      if (proposal.status !== "reframed" || !proposal.reframe_result) {
        return json(409, {
          ok: false, error: "NOT_REFRAMED",
          message: `Proposal is '${proposal.status}'; generate a reframe first.`,
        });
      }
      const rr = proposal.reframe_result as Record<string, unknown>;

      // Admin edits override the stored reframe.
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
        // Stay parked at 'reframed' so the admin can retry without regenerating.
        return json(502, { ok: false, error: "PUBLISH_FAILED", message: pubJson?.message ?? "Publish failed" });
      }

      // Record what was actually published (audit trail for edits).
      await adminSb.from("user_question_proposals").update({
        reframe_result: { ...rr, published_question: finalQuestion, published_at: new Date().toISOString() },
      }).eq("id", proposalId);

      return json(200, { ok: true, status: "published", question_id: pubJson.question_id, published_question: finalQuestion });
    }

    // ── DISCARD_REFRAME → back to in_review for another pass ───────────────────
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
