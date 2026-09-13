// supabase/functions/generate-authority-brief/index.ts
// Epic R — M-R06: AI-generated neutral authority brief (R6, US-R11).
//
// Admin-triggered, single-item generation (like admin-create-question-draft,
// not a batch cron job like extract-entities/reframe). Auth pattern mirrors
// admin-create-question-draft exactly: caller's own JWT verifies is_admin_me(),
// service role does the actual reads/writes.
//
// Generates FROM the published expectation_ledgers snapshot (frozen numbers),
// not a live query — US-R11 gates this on "once an expectation ledger
// crosses threshold and is approved", so the brief should match what's
// publicly shown on the ledger page, not whatever the live aggregation says
// right now (which could have moved since publish).
//
// Prompt loaded from ai_prompts (prompt_key='authority_brief_generation'),
// same load-with-hardcoded-fallback pattern as reframe/logic.ts — see the
// M-R06 migration's seed row for the current live prompt text.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4.57.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Fallback if ai_prompts has no active 'authority_brief_generation' row —
// kept in sync with the migration's seed text. See that file for the full
// BR-R04 guardrail rationale.
const HARDCODED_SYSTEM_PROMPT = `You write short, neutral, factual briefs for civic authorities summarising what a community expects following a published civic issue. Your ONLY job is to state what the data shows.

STRICT RULES:
- Use phrasing like "a majority expect" or "X% expect" — NEVER "residents are demanding", "the public demands", or any accusatory/activist framing.
- State facts only: participation count, region, the dominant expectation type and its percentage.
- Do NOT editorialise, do NOT imply wrongdoing, do NOT use emotionally charged language.
- Do NOT address the authority directly ("you should...") — describe what respondents expect, in the third person.
- Output 2-4 sentences, plain prose, no markdown, no headers.`;

const HARDCODED_USER_TEMPLATE = `Question: {{question_text}}
Region: {{region_name}}
Participation: {{participation_count}} respondents
Time window: {{time_window_start}} to {{time_window_end}}
Expectation distribution: {{expectation_breakdown}}
Anonymous opt-in count (people who chose to make this expectation visible): {{optin_count}}

Write the brief now, following the system rules exactly.`;

function fillTemplate(template, vars) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, String(value ?? ""));
  }
  return out;
}

function formatBreakdown(snapshot) {
  if (!Array.isArray(snapshot) || snapshot.length === 0) return "no data";
  return snapshot
    .map((row) => `${row.expectation_type}: ${row.pct_of_respondents}%`)
    .join(", ");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
    }
    const accessToken = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");

    if (!supabaseUrl || !anonKey) return jsonResponse({ error: "Server misconfigured: Supabase env vars missing" }, 500);
    if (!serviceRoleKey) return jsonResponse({ error: "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing" }, 500);
    if (!openaiApiKey) return jsonResponse({ error: "Server misconfigured: OPENAI_API_KEY missing" }, 500);

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    // 1) Verify admin
    const { data: isAdmin, error: adminError } = await supabaseAuth.rpc("is_admin_me");
    if (adminError) return jsonResponse({ error: "Failed to verify admin status" }, 500);
    if (!isAdmin) return jsonResponse({ error: "Forbidden" }, 403);

    // 2) Parse + validate body
    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    const { question_id, region_id, authority_id } = body;
    if (!question_id || !region_id || !authority_id) {
      return jsonResponse({ error: "question_id, region_id, and authority_id are all required" }, 400);
    }

    // 3) Load the published ledger — this is the source of truth for the
    // brief's numbers, not a live query (see file header).
    const { data: ledger, error: ledgerErr } = await supabaseAdmin
      .from("expectation_ledgers")
      .select("snapshot_summary, participation_count, time_window_start, time_window_end, optin_count, status")
      .eq("question_id", question_id)
      .eq("region_id", region_id)
      .maybeSingle();

    if (ledgerErr) return jsonResponse({ error: `Failed to load ledger: ${ledgerErr.message}` }, 500);
    if (!ledger || ledger.status !== "published") {
      return jsonResponse({ error: "Ledger must be published before a brief can be generated (US-R11)" }, 400);
    }

    // 4) Question text + region name for prompt context
    const { data: question } = await supabaseAdmin
      .from("questions")
      .select("question")
      .eq("id", question_id)
      .maybeSingle();
    const { data: region } = await supabaseAdmin
      .from("locations")
      .select("name")
      .eq("id", region_id)
      .maybeSingle();

    // 5) Load active prompt from ai_prompts, fall back to hardcoded —
    // mirrors reframe/logic.ts exactly.
    let systemPrompt = HARDCODED_SYSTEM_PROMPT;
    let userTemplate = HARDCODED_USER_TEMPLATE;
    let model = "gpt-4o-mini";
    let temperature = 0.4;
    let promptId = null;
    try {
      const { data: promptRow, error: promptErr } = await supabaseAdmin
        .from("ai_prompts")
        .select("id, system_prompt, user_prompt_template, model, temperature")
        .eq("prompt_key", "authority_brief_generation")
        .eq("is_active", true)
        .maybeSingle();
      if (!promptErr && promptRow) {
        systemPrompt = promptRow.system_prompt ?? HARDCODED_SYSTEM_PROMPT;
        userTemplate = promptRow.user_prompt_template ?? HARDCODED_USER_TEMPLATE;
        model = promptRow.model ?? model;
        temperature = promptRow.temperature ?? temperature;
        promptId = promptRow.id ?? null;
      }
    } catch (_e) {
      // fall through to hardcoded — same non-fatal posture as reframe
    }

    // 6) Fill template + call OpenAI
    const userPrompt = fillTemplate(userTemplate, {
      question_text: question?.question ?? "(question text unavailable)",
      region_name: region?.name ?? "(region unavailable)",
      participation_count: ledger.participation_count ?? 0,
      time_window_start: ledger.time_window_start ?? "",
      time_window_end: ledger.time_window_end ?? "",
      expectation_breakdown: formatBreakdown(ledger.snapshot_summary),
      optin_count: ledger.optin_count ?? 0,
    });

    const client = new OpenAI({ apiKey: openaiApiKey, maxRetries: 4, timeout: 30_000 });
    const completion = await client.chat.completions.create({
      model,
      temperature,
      max_tokens: 300,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const briefText = completion.choices[0]?.message?.content?.trim() ?? "";

    if (!briefText) {
      return jsonResponse({ error: "Model returned empty content" }, 502);
    }

    // 7) Persist as a new draft brief — always a fresh row, never overwrites
    // a prior brief for this (question, region, authority) combo, so an
    // admin can regenerate without losing the previous draft for comparison.
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("authority_briefs")
      .insert({
        question_id,
        region_id,
        authority_id,
        brief_text: briefText,
        generated_at: new Date().toISOString(),
        status: "draft",
      })
      .select()
      .single();

    if (insertErr) return jsonResponse({ error: `Failed to save brief: ${insertErr.message}` }, 500);

    return jsonResponse({
      brief: inserted,
      prompt_source: promptId ? `ai_prompts:${promptId}` : "hardcoded",
    });
  } catch (err) {
    console.error("generate-authority-brief error:", err);
    return jsonResponse({ error: err?.message ?? "Unknown error" }, 500);
  }
});
