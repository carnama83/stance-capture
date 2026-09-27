// supabase/functions/question-edit/index.ts
//
// Sep 2026, NEW — improve a LIVE question's wording before anyone answers it.
//
// Who: the question's proposer (questions.proposed_by) or an admin.
// When: only while public.question_answer_count(question) = 0. The database
//       enforces this itself (trg_questions_lock_wording); the checks here only
//       give a friendly answer earlier.
// How:  AI suggests, the person approves. The browser never sends the new
//       wording: `suggest` stores the model's revision (after a safety and
//       framing check) in question_edit_suggestions, and `apply` publishes that
//       stored row by id via apply_question_edit_suggestion(). What goes live is
//       therefore exactly what the safety check saw.
//
// Actions (POST JSON, user JWT in Authorization):
//   { action: "status",  question_id }
//   { action: "suggest", question_id, change_request?, use_background? }
//   { action: "refine",  suggestion_id, change_request }   (adjusts that pending
//                        suggestion, keeping everything not asked about verbatim;
//                        the old suggestion becomes 'superseded')
//   { action: "apply",   suggestion_id }
//   { action: "discard", suggestion_id }
//
// Errors carry a stable `error` code; the UI translates the code (en/hi) and
// only falls back to `message`, which is English.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//      ANTHROPIC_API_KEY, UGQ_SCREEN_MODEL (optional, same model ugq-screen uses)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const CHANGE_MIN_LEN = 5;
const CHANGE_MAX_LEN = 500;
const SUGGESTIONS_PER_HOUR = 10;

// Output budgets. The model spends part of max_tokens on thinking before it
// writes the JSON: on Prod the safety check used 431 of a 512 budget and was
// cut off (stop_reason=max_tokens) with no answer, so the whole suggestion
// failed; a web-search revise used 4,176 of 4,096. Keep generous headroom.
const SAFETY_MAX_TOKENS = 4096;
const REVISE_MAX_TOKENS = 16000;

type QuestionRow = {
  id: string;
  question: string;
  slider_low_label: string | null;
  slider_high_label: string | null;
  context_summary: string | null;
  supporting_links: string[] | null;
  proposed_by: string | null;
  canonical_language: string | null;
};

type Revision = {
  question: string;
  slider_low_label: string | null;
  slider_high_label: string | null;
  context_summary: string | null;
  supporting_links: string[];
  notes: string | null;
};

type SuggestionRow = {
  id: string;
  question_id: string;
  requested_by: string;
  change_request: string;
  base_question: string;
  suggested_question: string;
  suggested_low: string | null;
  suggested_high: string | null;
  suggested_context: string | null;
  suggested_links: string[] | null;
  status: string;
  created_at: string;
};

type SafetyVerdict ={ safety_flag: "clean" | "review" | "reject"; framing_flag: "clean" | "leading"; reason: string };

// ── model plumbing ──────────────────────────────────────────────────────────
function extractJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

// Raw line breaks inside JSON strings (a multi-paragraph background) would
// otherwise make a correct reply unparseable -- see generate-question-renditions.
function escapeControlCharsInStrings(text: string): string {
  let out = "", inString = false, escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) { escaped = false; out += ch; continue; }
      if (ch === "\\") { escaped = true; out += ch; continue; }
      if (ch === '"') { inString = false; out += ch; continue; }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t" : "\\u" + code.toString(16).padStart(4, "0");
        continue;
      }
      out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

function parseModelJson(raw: string): Record<string, unknown> | null {
  // With web search on, the model wraps sourced sentences in
  // <cite index="1-1,1-2">...</cite>; that markup reached a live Prod
  // Background verbatim. Strip the tags, keep the words.
  raw = raw.replace(/<\/?cite\b[^>]*>/gi, "");
  const unfenced = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  // Extract first (brace matching copes with raw newlines), THEN escape: a stray
  // quote in any prose before the object would otherwise throw off the escaper.
  const object = extractJsonObject(unfenced);
  for (const c of [object, unfenced]) {
    if (!c) continue;
    for (const text of [c, escapeControlCharsInStrings(c)]) {
      try { return JSON.parse(text); } catch { /* next */ }
    }
  }
  return null;
}

async function callClaude(
  apiKey: string, model: string, label: string, system: string, user: string,
  maxTokens: number, webSearch: boolean,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model, max_tokens: maxTokens, system,
      messages: [{ role: "user", content: user }],
      ...(webSearch ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] } : {}),
    }),
  });
  if (!res.ok) {
    console.error(JSON.stringify({ tag: `question-edit.llm_error.${label}`, status: res.status, body: (await res.text()).slice(0, 500) }));
    return "";
  }
  const data = await res.json();
  const blocks: Array<{ type?: string; text?: string }> = Array.isArray(data?.content) ? data.content : [];
  // With web search the answer can be split across several text blocks.
  const text = blocks.filter((b) => b?.type === "text").map((b) => b.text ?? "").join("\n");
  console.log(JSON.stringify({ tag: `question-edit.llm_meta.${label}`, stop_reason: data?.stop_reason, usage: data?.usage }));
  return text;
}

const STRUCTURE_RULES =
  "Structure of the question: one short concrete context clause, one clause on the underlying tension or " +
  "accountability question, then ONE question ending in 'you', answerable on a single -2..+2 oppose/support " +
  "spectrum (never a menu of options, never 'A, B, or C', never 'Do you support' / 'Should the government'). " +
  "Target 30-45 words, 65 max. Plain everyday language, no jargon. Neutral: no loaded adjectives, no built-in " +
  "premise the respondent cannot reject, nothing that suggests the 'right' answer. Write everything in ENGLISH. ";

// Quoted wording is an instruction, not a suggestion: in testing, a request to
// add a sentence saying authorities "often" act late came back as
// "consistently", which turned a fair criticism into an accusation.
const VERBATIM_RULE =
  "If the request gives exact wording in quotation marks, use that wording VERBATIM, character for character; " +
  "never strengthen, soften or paraphrase it. ";

// The version being revised: the live question (suggest) or a pending
// suggestion (refine).
type BaseVersion = {
  question: string;
  slider_low_label: string | null;
  slider_high_label: string | null;
  context_summary: string | null;
  supporting_links: string[] | null;
};

function describe(v: BaseVersion) {
  return `Question: ${v.question}\n` +
    `Oppose end of the slider: ${v.slider_low_label ?? "(none set)"}\n` +
    `Support end of the slider: ${v.slider_high_label ?? "(none set)"}\n` +
    `Background:\n${v.context_summary ?? "(none)"}\n\n` +
    `Supporting links: ${(v.supporting_links ?? []).join(", ") || "(none)"}`;
}

// Refine: a small, targeted adjustment to a suggestion the person has already
// seen. Everything they did not ask to change must come back untouched, or
// each round re-rolls the parts they were happy with.
function refinePrompts(base: BaseVersion, changeRequest: string) {
  const system =
    "You are making a SMALL, TARGETED adjustment to a DRAFT revision of a civic stance question that nobody has " +
    "answered yet. The person has reviewed the draft and asked for one specific change. Apply ONLY that change. " +
    "Copy every sentence, clause, slider end, background paragraph and link the request does not mention " +
    "EXACTLY as it is in the draft; do not tighten, reorder or re-word them. " +
    VERBATIM_RULE +
    "No web search on this pass: never invent facts. The result must still follow these rules: " +
    STRUCTURE_RULES +
    "Keep separate background paragraphs separate (blank line between them). Slider ends stay true opposites " +
    "on ONE axis. " +
    "Return ONLY JSON: {\"question\":\"...\",\"slider_low_label\":\"...\",\"slider_high_label\":\"...\"," +
    "\"context_summary\":\"... or null\",\"supporting_links\":[\"url\"],\"notes\":\"one short sentence, plain " +
    "language, saying exactly what you changed\"}. If the requested change cannot be made while keeping a fair " +
    "single-spectrum question, return {\"question\":null,\"notes\":\"one short plain-language sentence explaining why\"}.";
  const user =
    `DRAFT (adjust this):\n${describe(base)}\n\n` +
    `REQUESTED ADJUSTMENT:\n"${changeRequest}"\n\n` +
    "Return the adjusted draft now.";
  return { system, user };
}

function revisionPrompts(q: BaseVersion, changeRequest: string, role: "proposer" | "admin", webSearch: boolean) {
  const current =
    `Question: ${q.question}\n` +
    `Oppose end of the slider: ${q.slider_low_label ?? "(none set)"}\n` +
    `Support end of the slider: ${q.slider_high_label ?? "(none set)"}\n` +
    `Background:\n${q.context_summary ?? "(none)"}`;

  const system =
    VERBATIM_RULE +
    "You are REVISING a live civic stance question that nobody has answered yet. The " +
    (role === "proposer" ? "person who posted it" : "platform's editor") +
    " realised it should say more, and has told you what to add or change. Unlike a background note, this " +
    "change is meant to shape the QUESTION ITSELF: reflect it in the question wording (and in the slider ends " +
    "if the change affects what the two ends mean). Keep everything in the current version that is still " +
    "accurate; do not drop existing facts, numbers or dates unless the requested change supersedes them. " +
    "Keep the existing central tension as the question's anchor unless the requested change explicitly asks " +
    "for a different one. " +
    (webSearch
      ? "Use web search only to verify or support the NEW information; never contradict, hedge on, or cast doubt " +
        "on the requested change inside the question. If search finds nothing relevant, rely on what you were told. "
      : "You have no web search: use only what you were told, frame any new claim as reported rather than " +
        "asserting it outright, and never invent facts. ") +
    STRUCTURE_RULES +
    "Background: keep the current background's facts (you may tighten wording). If the change brings a new " +
    "fact that belongs in the background rather than the question, add it as one short extra paragraph, " +
    "separated by a blank line. Keep separate paragraphs separate. " +
    "Slider ends: 3-6 word noun phrases; the oppose end is the -2 side, the support end the +2 side, and they " +
    "must stay true opposites on ONE axis. " +
    "Return ONLY JSON: {\"question\":\"...\",\"slider_low_label\":\"...\",\"slider_high_label\":\"...\"," +
    "\"context_summary\":\"... or null\",\"supporting_links\":[\"url\"] (keep the current links that still " +
    "apply; 0-3 total),\"notes\":\"one short sentence, plain language, saying what you changed and why\"}. " +
    "If the requested change cannot be turned into a fair single-spectrum question, return " +
    "{\"question\":null,\"notes\":\"one short plain-language sentence explaining why\"}.";

  const user =
    `CURRENT VERSION (live, no answers yet):\n${current}\n\n` +
    `Current supporting links: ${(q.supporting_links ?? []).join(", ") || "(none)"}\n\n` +
    `REQUESTED CHANGE:\n"${changeRequest}"\n\n` +
    "Write the revised version now.";
  return { system, user };
}

function parseRevision(raw: string, current: BaseVersion): Revision | { refused: string } | null {
  const p = parseModelJson(raw);
  if (!p) return null;
  const notes = typeof p.notes === "string" ? p.notes.trim().slice(0, 400) : null;
  const question = typeof p.question === "string" ? p.question.trim() : "";
  if (!question) return { refused: notes ?? "" };
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const links = Array.isArray(p.supporting_links)
    ? p.supporting_links.filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u)).slice(0, 3)
    : [];
  return {
    question: question.slice(0, 1000),
    slider_low_label: str(p.slider_low_label)?.slice(0, 120) ?? current.slider_low_label,
    slider_high_label: str(p.slider_high_label)?.slice(0, 120) ?? current.slider_high_label,
    context_summary: str(p.context_summary)?.slice(0, 3000) ?? current.context_summary,
    supporting_links: links.length ? links : (current.supporting_links ?? []),
    notes,
  };
}

async function checkSafety(apiKey: string, model: string, r: Revision): Promise<SafetyVerdict | null> {
  const system =
    "You check a revised civic stance question before it replaces the live version on a platform where people " +
    "answer on a -2..+2 scale. Judge TWO things. " +
    "safety_flag: 'reject' for hate speech, doxxing, personal attacks, harassment or incitement; 'review' if " +
    "unsure; otherwise 'clean'. A strong opinion on a real civic topic is NOT unsafe. " +
    "framing_flag: 'leading' if the wording itself steers toward an answer (loaded adjectives, a premise the " +
    "respondent cannot reject, sarcasm, 'isn't it obvious'), or if the two slider ends are not true opposites on " +
    "one axis; otherwise 'clean'. Judge the wording, not the topic. " +
    "Return ONLY JSON: {\"safety_flag\":\"clean\"|\"review\"|\"reject\",\"framing_flag\":\"clean\"|\"leading\"," +
    "\"reason\":\"one short plain-language sentence a non-expert can act on; empty if both are clean\"}.";
  const user =
    `Question: ${r.question}\nOppose end: ${r.slider_low_label ?? ""}\nSupport end: ${r.slider_high_label ?? ""}\n` +
    `Background:\n${r.context_summary ?? "(none)"}\n\nJudge it now.`;
  const raw = await callClaude(apiKey, model, "safety", system, user, SAFETY_MAX_TOKENS, false);
  const p = raw ? parseModelJson(raw) : null;
  if (!p) return null;
  const safety = ["clean", "review", "reject"].includes(p.safety_flag as string) ? p.safety_flag as SafetyVerdict["safety_flag"] : "review";
  const framing = p.framing_flag === "leading" ? "leading" : "clean";
  return { safety_flag: safety, framing_flag: framing, reason: typeof p.reason === "string" ? p.reason.slice(0, 300) : "" };
}

// ── handler ─────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const MODEL = (Deno.env.get("UGQ_SCREEN_MODEL") ?? "claude-sonnet-4-6").trim();

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json(401, { ok: false, error: "UNAUTHORIZED" });
    const userSb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userSb.auth.getUser();
    if (!user) return json(401, { ok: false, error: "UNAUTHORIZED" });

    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";

    const { data: adminRow } = await adminSb.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
    const isAdmin = !!adminRow;

    // ── apply / discard work on a stored suggestion ──
    if (action === "apply" || action === "discard") {
      const suggestionId = typeof body.suggestion_id === "string" ? body.suggestion_id : "";
      if (!suggestionId) return json(400, { ok: false, error: "MISSING_SUGGESTION_ID" });

      if (action === "discard") {
        await adminSb.from("question_edit_suggestions")
          .update({ status: "discarded" })
          .eq("id", suggestionId).eq("requested_by", user.id).eq("status", "pending");
        return json(200, { ok: true });
      }

      const { data, error } = await adminSb.rpc("apply_question_edit_suggestion", {
        p_suggestion_id: suggestionId, p_actor: user.id,
      });
      if (error) {
        const msg = error.message ?? "";
        const code = (["QUESTION_LOCKED", "QUESTION_CHANGED", "SUGGESTION_EXPIRED", "SUGGESTION_NOT_PENDING",
          "SUGGESTION_NOT_FOUND", "FORBIDDEN"].find((c) => msg.includes(c))) ?? "APPLY_FAILED";
        const status = code === "FORBIDDEN" ? 403 : code === "SUGGESTION_NOT_FOUND" ? 404
          : code === "SUGGESTION_EXPIRED" ? 410 : code === "APPLY_FAILED" ? 500 : 409;
        console.error(JSON.stringify({ tag: "question-edit.apply_failed", code, message: msg.slice(0, 300) }));
        return json(status, { ok: false, error: code, message: msg.slice(0, 300) });
      }
      const row = Array.isArray(data) ? data[0] : data;
      return json(200, { ok: true, question: row });
    }

    // ── refine starts from a pending suggestion; resolve its question first ──
    let parent: SuggestionRow | null = null;
    let questionId = typeof body.question_id === "string" ? body.question_id : "";
    if (action === "refine") {
      const suggestionId = typeof body.suggestion_id === "string" ? body.suggestion_id : "";
      if (!suggestionId) return json(400, { ok: false, error: "MISSING_SUGGESTION_ID" });
      const { data: s } = await adminSb.from("question_edit_suggestions")
        .select("id, question_id, requested_by, change_request, base_question, suggested_question, suggested_low, suggested_high, suggested_context, suggested_links, status, created_at")
        .eq("id", suggestionId).maybeSingle<SuggestionRow>();
      if (!s) return json(404, { ok: false, error: "SUGGESTION_NOT_FOUND" });
      if (s.requested_by !== user.id) return json(403, { ok: false, error: "FORBIDDEN" });
      if (s.status !== "pending") return json(409, { ok: false, error: "SUGGESTION_NOT_PENDING" });
      if (Date.now() - new Date(s.created_at).getTime() > 60 * 60 * 1000) {
        return json(410, { ok: false, error: "SUGGESTION_EXPIRED" });
      }
      parent = s;
      questionId = s.question_id;
    }

    // ── status / suggest / refine work on a question ──
    if (!questionId) return json(400, { ok: false, error: "MISSING_QUESTION_ID" });

    const { data: q } = await adminSb.from("questions")
      .select("id, question, slider_low_label, slider_high_label, context_summary, supporting_links, proposed_by, canonical_language")
      .eq("id", questionId).maybeSingle<QuestionRow>();
    if (!q) return json(404, { ok: false, error: "NOT_FOUND" });

    const role: "proposer" | "admin" | null = isAdmin ? "admin" : (q.proposed_by === user.id ? "proposer" : null);
    const { data: answerCount } = await adminSb.rpc("question_answer_count", { p_question_id: questionId });
    const answers = Number(answerCount ?? 0);
    const languageSupported = (q.canonical_language ?? "en") === "en";

    if (action === "status") {
      return json(200, {
        ok: true, role, answer_count: answers,
        editable: !!role && answers === 0 && languageSupported,
        reason: !role ? "FORBIDDEN" : answers > 0 ? "QUESTION_LOCKED" : !languageSupported ? "LANGUAGE_NOT_SUPPORTED" : null,
      });
    }

    if (action !== "suggest" && action !== "refine") return json(400, { ok: false, error: "UNKNOWN_ACTION" });
    // Someone applied another edit after this suggestion was made; refining it
    // would build on wording that is no longer live.
    if (parent && parent.base_question !== q.question) {
      return json(409, { ok: false, error: "QUESTION_CHANGED" });
    }
    if (!role) return json(403, { ok: false, error: "FORBIDDEN", message: "Only the person who posted this question or an admin can edit it." });
    if (answers > 0) {
      return json(409, { ok: false, error: "QUESTION_LOCKED", answer_count: answers,
        message: "People have already answered this question, so its wording can no longer change." });
    }
    // A question that originated in another language has that language as its
    // source rendition; rewriting only the English would diverge from it.
    if (!languageSupported) {
      return json(409, { ok: false, error: "LANGUAGE_NOT_SUPPORTED",
        message: "Editing is currently available only for questions first written in English." });
    }
    if (!ANTHROPIC_API_KEY) return json(503, { ok: false, error: "AI_UNAVAILABLE" });

    const useBackground = !parent && body.use_background === true;
    let changeRequest = typeof body.change_request === "string" ? body.change_request.trim() : "";
    if (useBackground) {
      if (role !== "admin") return json(403, { ok: false, error: "FORBIDDEN" });
      if (!q.context_summary?.trim()) {
        return json(400, { ok: false, error: "NO_BACKGROUND", message: "This question has no background to work from yet." });
      }
      changeRequest = changeRequest ||
        "Update the question so it reflects the most important information in the current background, " +
        "especially anything added most recently (the last paragraph).";
    } else {
      if (changeRequest.length < CHANGE_MIN_LEN) return json(400, { ok: false, error: "CHANGE_TOO_SHORT" });
      if (changeRequest.length > CHANGE_MAX_LEN) return json(400, { ok: false, error: "CHANGE_TOO_LONG" });
    }

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recent } = await adminSb.from("question_edit_suggestions")
      .select("id", { count: "exact", head: true })
      .eq("question_id", questionId).eq("requested_by", user.id).gte("created_at", since);
    if ((recent ?? 0) >= SUGGESTIONS_PER_HOUR) return json(429, { ok: false, error: "TOO_MANY_SUGGESTIONS" });

    let revision: Revision | { refused: string } | null = null;
    if (parent) {
      // Refine: adjust the suggestion the person is looking at. No web search:
      // this is a wording adjustment, and search is what lets a pass drift.
      const base: BaseVersion = {
        question: parent.suggested_question,
        slider_low_label: parent.suggested_low,
        slider_high_label: parent.suggested_high,
        context_summary: parent.suggested_context,
        supporting_links: parent.suggested_links,
      };
      const { system, user: usr } = refinePrompts(base, changeRequest);
      const raw = await callClaude(ANTHROPIC_API_KEY, MODEL, "refine", system, usr, REVISE_MAX_TOKENS, false);
      revision = raw ? parseRevision(raw, base) : null;
      if (revision && !("refused" in revision) &&
          revision.question === base.question && revision.slider_low_label === base.slider_low_label &&
          revision.slider_high_label === base.slider_high_label && revision.context_summary === base.context_summary) {
        return json(422, { ok: false, error: "NO_CHANGE" });
      }
    } else {
      // Revise: with web search first, then without if that fails to parse.
      for (const webSearch of [true, false]) {
        const { system, user: usr } = revisionPrompts(q, changeRequest, role, webSearch);
        const raw = await callClaude(ANTHROPIC_API_KEY, MODEL, webSearch ? "revise" : "revise_nosearch", system, usr, REVISE_MAX_TOKENS, webSearch);
        revision = raw ? parseRevision(raw, q) : null;
        if (revision) break;
      }
    }
    if (!revision) return json(502, { ok: false, error: "SUGGEST_FAILED" });
    if ("refused" in revision) {
      return json(422, { ok: false, error: "CANNOT_REVISE", message: revision.refused || undefined });
    }
    // The live wording has to change for this to be a wording edit.
    if (revision.question === q.question && revision.slider_low_label === q.slider_low_label &&
        revision.slider_high_label === q.slider_high_label) {
      return json(422, { ok: false, error: "NO_CHANGE" });
    }

    const verdict = await checkSafety(ANTHROPIC_API_KEY, MODEL, revision);
    if (!verdict) return json(502, { ok: false, error: "SUGGEST_FAILED" });
    if (verdict.safety_flag === "reject") {
      return json(422, { ok: false, error: "UNSAFE", message: verdict.reason || undefined });
    }
    // Proposers get only clean suggestions. Admins see the warning and decide.
    if (role === "proposer" && (verdict.safety_flag !== "clean" || verdict.framing_flag !== "clean")) {
      return json(422, { ok: false, error: "NEEDS_CHANGES", message: verdict.reason || undefined });
    }

    const { data: saved, error: saveErr } = await adminSb.from("question_edit_suggestions").insert({
      question_id: q.id,
      requested_by: user.id,
      requester_role: role,
      // A refinement keeps the whole request history, so the audit row written
      // on apply says what was actually asked for.
      change_request: parent ? `${parent.change_request}\n\nRefined: ${changeRequest}` : changeRequest,
      refined_from: parent?.id ?? null,
      base_question: q.question,
      suggested_question: revision.question,
      suggested_low: revision.slider_low_label,
      suggested_high: revision.slider_high_label,
      suggested_context: revision.context_summary,
      suggested_links: revision.supporting_links,
      safety_flag: verdict.safety_flag,
      framing_flag: verdict.framing_flag,
      notes: revision.notes,
      model: MODEL,
    }).select("id").single();
    if (saveErr || !saved) {
      console.error(JSON.stringify({ tag: "question-edit.save_failed", message: saveErr?.message }));
      return json(500, { ok: false, error: "SUGGEST_FAILED" });
    }
    if (parent) {
      await adminSb.from("question_edit_suggestions")
        .update({ status: "superseded" }).eq("id", parent.id).eq("status", "pending");
    }

    return json(200, {
      ok: true,
      current: {
        question: q.question, slider_low_label: q.slider_low_label,
        slider_high_label: q.slider_high_label, context_summary: q.context_summary,
      },
      suggestion: {
        id: saved.id, ...revision,
        safety_flag: verdict.safety_flag, framing_flag: verdict.framing_flag,
        warning: verdict.safety_flag !== "clean" || verdict.framing_flag !== "clean" ? verdict.reason : null,
      },
    });
  } catch (err) {
    console.error(JSON.stringify({ tag: "question-edit.unhandled", message: (err as Error).message }));
    return json(500, { ok: false, error: "INTERNAL_ERROR" });
  }
});
