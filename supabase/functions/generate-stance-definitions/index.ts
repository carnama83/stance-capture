// supabase/functions/generate-stance-definitions/index.ts
//
// Epic Report R1 (RPT-01) — what each of the five positions (-2..+2) means for
// ONE exact rendition of a question, generated once and stored in
// question_stance_definitions.
//
//   ai_tip          second person, shown on the slider (ai-stance-tip reads it)
//   interpretation  third person, input for the Question Insight Report
//
// Body: { rendition_id }  or  { question_id, language_code }
//   -> { rendition_id, language_code, source: "stored" | "generated", definitions }
//
// Idempotent: if all five rows exist they are returned without a model call,
// so this is safe to call from the slider, the report page and the backfill.
// Only published or superseded renditions are accepted (never drafts — their
// text may never go live). Concurrent first calls may both generate; the
// insert ignores duplicates on (rendition_id, score) and the stored rows win.
//
// All five scores are generated in ONE call so they are mutually consistent.
// Output is validated (five distinct scores, non-trivial text, the requested
// script) before anything is stored; a failed validation is retried once and
// then reported, never stored.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const PROMPT_KEY = "stance_definitions_generation";

// Keep in sync with the ai_prompts seed (20260927201000_epic_report_r1_stance_definitions_prompt.sql).
const HARDCODED_SYSTEM_PROMPT =
  "You define what each position on a five-point opinion scale means for one civic question on a public platform. You describe positions, never the people who hold them. You are neutral: you never persuade, never rank positions, and never add facts that are not in the question or its context. You always answer with valid JSON only.";
const HARDCODED_USER_TEMPLATE = `Question: {{question_text}}
Context: {{context}}

Scale for THIS question:
-2 = {{low_label}}
-1 = leans toward "{{low_label}}"
 0 = neutral / unsure
+1 = leans toward "{{high_label}}"
+2 = {{high_label}}

For each of the five scores write:
- "ai_tip": second person ("You ..."), 40-70 words. Explains what choosing this position means for THIS question, in terms of its two ends.
- "interpretation": third person ("This position ..."), 60-110 words. What the position emphasises or prioritises, the concern it responds to, and the outcome it seeks. For -1 and +1, say what separates it from the stronger position on the same side. For 0, cover the range: unsure, sees merit on both sides, or wants more information.

Rules:
- Frame positions the way the labels do. If the labels describe delivery or implementation (e.g. "Not delivered" / "Fully delivered"), a position is a JUDGMENT about whether it happened, not support for the idea. If they describe support or opposition, it is policy alignment.
- Never mention respondents, voters, people, residents, percentages, or how many hold a position.
- Never call any position right, better, popular or the majority.
- Write every "ai_tip" and "interpretation" in {{language_name}}.

Return exactly:
{"definitions":[{"score":-2,"ai_tip":"...","interpretation":"..."},{"score":-1,...},{"score":0,...},{"score":1,...},{"score":2,...}]}`;

// Script each language must be written in. A model instruction is a request,
// not a guarantee, so output is checked before it is stored (same reasoning as
// QuestionStanceSlider's language guard).
const DEVANAGARI = /[ऀ-ॿ]/;
const SCRIPT_BY_LANGUAGE: Record<string, RegExp> = { hi: DEVANAGARI, mr: DEVANAGARI };

type Rendition = {
  id: string;
  question_id: string;
  language_code: string;
  rendered_text: string;
  slider_low_label: string | null;
  slider_high_label: string | null;
  context_summary: string | null;
  summary: string | null;
  lifecycle_status: string;
};
type Definition = { score: number; label: string | null; ai_tip: string; interpretation: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function rest(path: string, init: RequestInit = {}) {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

const RENDITION_COLS =
  "id,question_id,language_code,rendered_text,slider_low_label,slider_high_label,context_summary,summary,lifecycle_status";

async function resolveRendition(body: any): Promise<Rendition | null> {
  let query: string;
  if (typeof body?.rendition_id === "string" && body.rendition_id) {
    query = `question_renditions?id=eq.${encodeURIComponent(body.rendition_id)}` +
      `&lifecycle_status=in.(published,superseded)&select=${RENDITION_COLS}`;
  } else if (typeof body?.question_id === "string" && body.question_id) {
    const lang = String(body.language_code ?? "en").trim().toLowerCase().split("-")[0] || "en";
    query = `question_renditions?question_id=eq.${encodeURIComponent(body.question_id)}` +
      `&language_code=eq.${encodeURIComponent(lang)}&lifecycle_status=eq.published` +
      `&select=${RENDITION_COLS}&limit=1`;
  } else {
    return null;
  }
  const res = await rest(query);
  if (!res.ok) throw new Error(`rendition lookup failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

async function loadDefinitions(renditionId: string): Promise<Definition[]> {
  const res = await rest(
    `question_stance_definitions?rendition_id=eq.${renditionId}&select=score,label,ai_tip,interpretation&order=score`,
  );
  if (!res.ok) throw new Error(`definitions lookup failed: ${res.status}`);
  return await res.json();
}

async function fetchLanguageName(code: string): Promise<string> {
  if (code === "en") return "English";
  try {
    const res = await rest(`languages?language_code=eq.${encodeURIComponent(code)}&select=display_name_english`);
    if (!res.ok) return code;
    const rows = await res.json();
    return rows[0]?.display_name_english ?? code;
  } catch {
    return code;
  }
}

async function loadPrompt() {
  try {
    const res = await rest(
      `ai_prompts?prompt_key=eq.${PROMPT_KEY}&is_active=eq.true&select=version,system_prompt,user_prompt_template,model,temperature,max_tokens&order=version.desc&limit=1`,
    );
    if (res.ok) {
      const row = (await res.json())[0];
      if (row?.system_prompt && row?.user_prompt_template) {
        return {
          system: row.system_prompt as string,
          template: row.user_prompt_template as string,
          model: (row.model as string) || "gpt-4o-mini",
          temperature: Number(row.temperature ?? 0.3),
          maxTokens: Number(row.max_tokens ?? 2500),
          version: `ai_prompts:${PROMPT_KEY}:v${row.version}`,
        };
      }
    }
  } catch (e) {
    console.warn("[generate-stance-definitions] prompt load failed; using hardcoded", e);
  }
  return {
    system: HARDCODED_SYSTEM_PROMPT,
    template: HARDCODED_USER_TEMPLATE,
    model: "gpt-4o-mini",
    temperature: 0.3,
    maxTokens: 2500,
    version: "hardcoded:v1",
  };
}

function fill(template: string, vars: Record<string, string>) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{{${k}}}`, v);
  return out;
}

// Returns an error message, or null when the output is acceptable.
function validate(defs: any, lang: string): string | null {
  if (!Array.isArray(defs) || defs.length !== 5) return "expected exactly 5 definitions";
  const scores = new Set(defs.map((d: any) => Number(d?.score)));
  for (const s of [-2, -1, 0, 1, 2]) if (!scores.has(s)) return `missing score ${s}`;
  const script = SCRIPT_BY_LANGUAGE[lang];
  for (const d of defs) {
    for (const field of ["ai_tip", "interpretation"]) {
      const text = d?.[field];
      if (typeof text !== "string" || text.trim().length < 20) return `score ${d?.score}: ${field} missing or too short`;
      if (script && !script.test(text)) return `score ${d?.score}: ${field} is not in the requested language (${lang})`;
      if (lang === "en" && DEVANAGARI.test(text)) return `score ${d?.score}: ${field} is not in English`;
    }
  }
  return null;
}

async function generate(r: Rendition) {
  const prompt = await loadPrompt();
  const languageName = await fetchLanguageName(r.language_code);
  const low = r.slider_low_label?.trim() || "Strongly disagree";
  const high = r.slider_high_label?.trim() || "Strongly agree";
  const context = [r.summary, r.context_summary].filter((s) => s && s.trim()).join("\n\n") || "(none)";
  const userPrompt = fill(prompt.template, {
    question_text: r.rendered_text,
    context,
    low_label: low,
    high_label: high,
    language_name: languageName,
  });

  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const messages = [
      { role: "system", content: prompt.system },
      { role: "user", content: userPrompt },
    ];
    if (lastError) {
      messages.push({ role: "user", content: `Your previous answer was rejected: ${lastError}. Return the corrected JSON only.` });
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: prompt.model,
        messages,
        temperature: prompt.temperature,
        max_tokens: prompt.maxTokens,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
    const data = await res.json();
    let parsed: any;
    try {
      parsed = JSON.parse(data?.choices?.[0]?.message?.content ?? "");
    } catch {
      lastError = "the answer was not valid JSON";
      continue;
    }
    const defs = parsed?.definitions;
    lastError = validate(defs, r.language_code) ?? "";
    if (!lastError) {
      return {
        model: prompt.model,
        version: prompt.version,
        rows: defs.map((d: any) => {
          const score = Number(d.score);
          return {
            question_id: r.question_id,
            rendition_id: r.id,
            language_code: r.language_code,
            score,
            label: score === -2 ? low : score === 2 ? high : null,
            ai_tip: String(d.ai_tip).trim(),
            interpretation: String(d.interpretation).trim(),
          };
        }),
      };
    }
    console.warn("[generate-stance-definitions] validation failed", { rendition_id: r.id, attempt, lastError });
  }
  throw new Error(`validation failed twice: ${lastError}`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  try {
    const rendition = await resolveRendition(body);
    if (!rendition) return json({ error: "rendition_not_found", definitions: null }, 404);

    const existing = await loadDefinitions(rendition.id);
    if (existing.length === 5) {
      return json({ rendition_id: rendition.id, language_code: rendition.language_code, source: "stored", definitions: existing });
    }

    if (!OPENAI_API_KEY) return json({ error: "missing_openai_key", definitions: null }, 503);

    const generated = await generate(rendition);
    const rows = generated.rows.map((row) => ({ ...row, model: generated.model, prompt_version: generated.version }));
    const ins = await rest("question_stance_definitions?on_conflict=rendition_id,score", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
    if (!ins.ok) throw new Error(`insert failed: ${ins.status} ${await ins.text()}`);

    const stored = await loadDefinitions(rendition.id);
    console.log("[generate-stance-definitions] generated", {
      rendition_id: rendition.id,
      language_code: rendition.language_code,
      prompt_version: generated.version,
    });
    return json({ rendition_id: rendition.id, language_code: rendition.language_code, source: "generated", definitions: stored });
  } catch (err) {
    console.error("[generate-stance-definitions] error", err);
    return json({ error: "generation_failed", detail: String(err), definitions: null }, 500);
  }
});
