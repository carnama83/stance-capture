// supabase/functions/suggest-government-roles/index.ts
// Epic R — M-R10: AI government-role suggestions (R-FR-19, US-R17, US-R21, BR-R10, BR-R11).
//
// Admin-triggered, per question. Auth pattern mirrors generate-authority-brief:
// the caller's own JWT must pass is_admin_me(); the service role does the reads
// and writes.
//
// The model may only RANK offices that already exist in government_role_registry
// (verified roles of the institutions mapped to the question). It receives them
// as a numbered list and answers with indexes; any index or action type outside
// what was offered is dropped. So it can never invent an office or name a person.
// Results land in question_role_suggestions as 'suggested' — nothing is shown to
// users until an admin confirms it on /admin/authorities (US-R21). Existing
// confirmed or rejected rows are never overwritten.
//
// Prompt loaded from ai_prompts (prompt_key='government_role_suggestion'), with
// the same text hardcoded below as the fallback (seeded by migration 20260926040000).

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

const HARDCODED_SYSTEM_PROMPT = `You help a civic platform suggest which EXISTING government offices are relevant to an expected action on a civic issue. You never invent offices, never name people, and never tell anyone to contact, pressure or target an official (BR-R10).

You receive: the question and its context, the region, the responsible institutions, a numbered list of candidate offices (each with its institution, level, domain and role type), and the expected actions to consider.

For each expected action, pick the candidate offices that have a genuine responsibility for carrying out or deciding that action in this place — for example the office that orders an inquiry for "investigation", the office that approves payouts for "compensation", the office that maintains the asset for "infrastructure_fix". Skip an action if no candidate fits. Do not pick an office just because it is senior.

Return ONLY valid JSON, no markdown:
{"suggestions": [{"expectation_type": "<one of the given actions>", "role_index": <number from the list>, "confidence": <0.0-1.0>, "rationale": "<one neutral sentence on the office's responsibility for this action>"}]}

At most 3 offices per action. Confidence reflects how clearly the office is responsible, not how important it is. Rationales state duties, never blame.`;

// Action types that can carry an office (mirrors the table CHECK). Incident
// questions use the accountability levels; others the general actions.
const GENERAL_ACTIONS = ["investigation", "compensation", "policy_reform", "transparency", "infrastructure_fix", "accountability", "legal_action"];
const INCIDENT_ACTIONS = ["criminal_prosecution", "departmental_suspension", "independent_investigation", "compensation_only", "administrative_transfer"];
const MAX_PER_ACTION = 3;

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

    // 2) Parse body
    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    const { question_id } = body;
    if (!question_id) return jsonResponse({ error: "question_id is required" }, 400);

    // 3) Question + mapped institutions + their verified offices
    const { data: question, error: qErr } = await supabaseAdmin
      .from("questions")
      .select("id, question, summary, context_summary, content_type, location_label, location_id")
      .eq("id", question_id)
      .maybeSingle();
    if (qErr) return jsonResponse({ error: `Failed to load question: ${qErr.message}` }, 500);
    if (!question) return jsonResponse({ error: "Question not found" }, 404);

    const { data: mapRows, error: mErr } = await supabaseAdmin
      .from("question_authority_map")
      .select("authority_id, confidence_level, authority_registry(id, name, jurisdiction_level, domain)")
      .eq("question_id", question_id);
    if (mErr) return jsonResponse({ error: `Failed to load institutions: ${mErr.message}` }, 500);
    const authorities = (mapRows ?? []).map((m) => m.authority_registry).filter(Boolean);
    if (authorities.length === 0) {
      return jsonResponse({ added: 0, reason: "No institutions are mapped to this question yet — assign one first." });
    }

    const { data: roles, error: rErr } = await supabaseAdmin
      .from("government_role_registry")
      .select("id, role_name, authority_id, government_level, domain, role_type")
      .in("authority_id", authorities.map((a) => a.id))
      .eq("verification_status", "verified")
      .order("role_name");
    if (rErr) return jsonResponse({ error: `Failed to load offices: ${rErr.message}` }, 500);
    if (!roles || roles.length === 0) {
      return jsonResponse({ added: 0, reason: "The mapped institutions have no verified government roles yet — add them in Government Roles." });
    }

    const actions = question.content_type === "incident" ? INCIDENT_ACTIONS : GENERAL_ACTIONS;
    const authorityName = new Map(authorities.map((a) => [a.id, a.name]));

    // 4) Prompt (ai_prompts with hardcoded fallback)
    let systemPrompt = HARDCODED_SYSTEM_PROMPT;
    let model = "gpt-4o-mini";
    let temperature = 0.2;
    let promptId = null;
    try {
      const { data: promptRow, error: promptErr } = await supabaseAdmin
        .from("ai_prompts")
        .select("id, system_prompt, model, temperature")
        .eq("prompt_key", "government_role_suggestion")
        .eq("is_active", true)
        .maybeSingle();
      if (!promptErr && promptRow) {
        systemPrompt = promptRow.system_prompt ?? HARDCODED_SYSTEM_PROMPT;
        model = promptRow.model ?? model;
        temperature = promptRow.temperature ?? temperature;
        promptId = promptRow.id ?? null;
      }
    } catch (_e) {
      // fall through to hardcoded
    }

    const candidateList = roles
      .map((r, i) => `${i + 1}. ${r.role_name} — ${authorityName.get(r.authority_id) ?? "institution"} (${r.government_level}, ${r.domain}, ${r.role_type})`)
      .join("\n");
    const userPrompt =
      `Question: ${question.question}\n` +
      `Context: ${question.context_summary ?? question.summary ?? "(none)"}\n` +
      `Region: ${question.location_label ?? "(unspecified)"}\n` +
      `Content type: ${question.content_type ?? "general"}\n` +
      `Responsible institutions: ${authorities.map((a) => a.name).join("; ")}\n\n` +
      `Candidate offices:\n${candidateList}\n\n` +
      `Expected actions to consider: ${actions.join(", ")}\n\n` +
      `Return the JSON now.`;

    const client = new OpenAI({ apiKey: openaiApiKey, maxRetries: 4, timeout: 30_000 });
    const completion = await client.chat.completions.create({
      model,
      temperature,
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";

    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch {
      return jsonResponse({ error: "Model returned invalid JSON", raw: raw.slice(0, 500) }, 502);
    }

    // 5) Validate: only offered actions and offered roles; cap per action.
    const perAction = new Map();
    const rows = [];
    for (const s of Array.isArray(parsed?.suggestions) ? parsed.suggestions : []) {
      const type = String(s?.expectation_type ?? "");
      const idx = Number(s?.role_index);
      if (!actions.includes(type)) continue;
      if (!Number.isInteger(idx) || idx < 1 || idx > roles.length) continue;
      const count = perAction.get(type) ?? 0;
      if (count >= MAX_PER_ACTION) continue;
      perAction.set(type, count + 1);
      const role = roles[idx - 1];
      const conf = Number(s?.confidence);
      rows.push({
        question_id,
        expectation_type: type,
        government_role_id: role.id,
        suggested_by: "ai",
        confidence_score: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : null,
        rationale: String(s?.rationale ?? "").slice(0, 500) || null,
        source_evidence: {
          model,
          prompt: promptId ? `ai_prompts:${promptId}` : "hardcoded",
          institutions: authorities.map((a) => ({ id: a.id, name: a.name })),
          content_type: question.content_type ?? "general",
          generated_at: new Date().toISOString(),
        },
        status: "suggested",
      });
    }

    if (rows.length === 0) {
      return jsonResponse({ added: 0, reason: "The model found no office clearly responsible for these actions." });
    }

    // Never overwrite a row an admin has already confirmed or rejected.
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("question_role_suggestions")
      .upsert(rows, { onConflict: "question_id,expectation_type,government_role_id", ignoreDuplicates: true })
      .select("id");
    if (insErr) return jsonResponse({ error: `Failed to save suggestions: ${insErr.message}` }, 500);

    return jsonResponse({ added: inserted?.length ?? 0, proposed: rows.length, prompt_source: promptId ? `ai_prompts:${promptId}` : "hardcoded" });
  } catch (err) {
    console.error("suggest-government-roles error:", err);
    return jsonResponse({ error: err?.message ?? "Unknown error" }, 500);
  }
});
