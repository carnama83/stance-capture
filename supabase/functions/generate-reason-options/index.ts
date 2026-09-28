// supabase/functions/generate-reason-options/index.ts
//
// Epic Report R3 — the one-tap reasons shown after someone answers a
// question ("Why did you choose this?"). Options belong to the QUESTION, not a
// rendition, so tallies stay comparable across languages and republishes:
//
//   question_reason_options        side (low | neutral | high), option_key, position
//   question_reason_option_labels  label per language
//
// Body: { question_id, language_code }
//   -> { question_id, language_code, source: "stored" | "generated", options: [{ side, key, label, position }] }
//
// Idempotent. First call for a question generates the option set in the
// question's original language from its published original rendition (plus
// the stored stance definitions, when present). First call for a new language
// translates the labels once. Both outputs are validated before storing; an
// invalid answer is retried once and never stored. Labels missing in the
// requested language fall back to the original language, flagged per option.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = "gpt-4o-mini";
const PROMPT_VERSION = "reason_options:v1";

const DEVANAGARI = /[ऀ-ॿ]/;
const SCRIPT_BY_LANGUAGE: Record<string, RegExp> = { hi: DEVANAGARI, mr: DEVANAGARI };
const SIDES = ["low", "neutral", "high"] as const;
type Side = (typeof SIDES)[number];

const GENERATE_SYSTEM =
  "You write the short answer options a civic opinion platform shows after someone has placed themselves on a scale, asking why they chose that position. You are neutral: you never persuade, never rank reasons, never add facts that are not in the question or its context. You answer with valid JSON only.";

const GENERATE_TEMPLATE = `Question: {{question_text}}
Context: {{context}}

Scale:
- "low" side (-2 and -1) = toward "{{low_label}}"
- "neutral" (0) = neutral / unsure
- "high" side (+1 and +2) = toward "{{high_label}}"
{{definitions}}
Write the reasons a person on each side might tap to say WHY they chose it:
- "low": exactly 4 options
- "high": exactly 4 options
- "neutral": exactly 3 options (e.g. not enough information, both sides have a point, it depends on how it is done — adapted to THIS question)

Rules:
- Each label is a reason, not a restatement of the position. 3-9 words, plain everyday language, at most 60 characters, no ending full stop.
- Options on one side must be clearly different from each other.
- Never mention people, groups, parties or places as good or bad; no insults; no facts beyond the question and context.
- Write every label in {{language_name}}.
- "key": a short English snake_case identifier for the option, unique across all 11 options, 2-40 characters of a-z, 0-9 and _.

Return exactly:
{"options":[{"side":"low","key":"...","label":"..."}, ...]}`;

const TRANSLATE_SYSTEM =
  "You translate short answer options for a civic opinion platform. Keep each option's meaning exactly, keep it short and in everyday language, and answer with valid JSON only.";

const TRANSLATE_TEMPLATE = `The question, as readers see it in {{language_name}}:
{{question_text}}

Translate each option label into {{language_name}}. Keep the same meaning and roughly the same length (at most 60 characters). Do not change the keys.

Options:
{{options_json}}

Return exactly:
{"labels":[{"key":"...","label":"..."}, ...]}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

async function restJson(path: string) {
  const res = await rest(path);
  if (!res.ok) throw new Error(`${path.split("?")[0]}: ${res.status} ${await res.text()}`);
  return await res.json();
}

function fill(template: string, vars: Record<string, string>) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{{${k}}}`, v);
  return out;
}

async function languageName(code: string): Promise<string> {
  if (code === "en") return "English";
  try {
    const rows = await restJson(`languages?language_code=eq.${encodeURIComponent(code)}&select=display_name_english`);
    return rows[0]?.display_name_english ?? code;
  } catch {
    return code;
  }
}

async function chatJson(system: string, user: string, retryNote: string) {
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  if (retryNote) messages.push({ role: "user", content: `Your previous answer was rejected: ${retryNote}. Return the corrected JSON only.` });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.3, max_tokens: 1500, response_format: { type: "json_object" } }),
    signal: AbortSignal.timeout(40_000),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const data = await res.json();
  try {
    return JSON.parse(data?.choices?.[0]?.message?.content ?? "");
  } catch {
    return null;
  }
}

function checkLabel(label: unknown, lang: string): string | null {
  if (typeof label !== "string") return "label missing";
  const l = label.trim();
  if (l.length < 2 || l.length > 80) return `label length ${l.length} out of range: "${l}"`;
  const script = SCRIPT_BY_LANGUAGE[lang];
  if (script && !script.test(l)) return `label not in the requested language: "${l}"`;
  // Containing SOME Devanagari is not enough: "दोनों पक्षों के valid बिंदु हैं"
  // passed that check on the first Dev run. No Latin words in a non-Latin label.
  if (script && /[A-Za-z]{3,}/.test(l)) return `label mixes in English words: "${l}"`;
  if (lang === "en" && DEVANAGARI.test(l)) return `label not in English: "${l}"`;
  return null;
}

function validateOptions(options: any, lang: string): string | null {
  if (!Array.isArray(options)) return "options is not an array";
  const want: Record<Side, number> = { low: 4, neutral: 3, high: 4 };
  const keys = new Set<string>();
  for (const side of SIDES) {
    const n = options.filter((o: any) => o?.side === side).length;
    if (n !== want[side]) return `expected ${want[side]} "${side}" options, got ${n}`;
  }
  for (const o of options) {
    if (!SIDES.includes(o?.side)) return `unknown side ${o?.side}`;
    if (typeof o?.key !== "string" || !/^[a-z0-9_]{2,40}$/.test(o.key)) return `bad key ${o?.key}`;
    if (keys.has(o.key)) return `duplicate key ${o.key}`;
    keys.add(o.key);
    const err = checkLabel(o.label, lang);
    if (err) return err;
  }
  return null;
}

type OptionRow = { id: string; side: Side; option_key: string; position: number };

async function loadOptions(questionId: string): Promise<OptionRow[]> {
  return await restJson(
    `question_reason_options?question_id=eq.${questionId}&select=id,side,option_key,position&order=side,position`,
  );
}

async function loadLabels(optionIds: string[], langs: string[]) {
  if (!optionIds.length) return [] as { option_id: string; language_code: string; label: string }[];
  return await restJson(
    `question_reason_option_labels?option_id=in.(${optionIds.join(",")})&language_code=in.(${langs.join(",")})&select=option_id,language_code,label`,
  );
}

async function originalRendition(questionId: string) {
  const rows = await restJson(
    `question_renditions?question_id=eq.${questionId}&rendition_type=eq.original&lifecycle_status=eq.published` +
      `&select=id,language_code,rendered_text,slider_low_label,slider_high_label,context_summary,summary&limit=1`,
  );
  return rows[0] ?? null;
}

async function generateOptions(questionId: string) {
  const r = await originalRendition(questionId);
  if (!r) throw new Error("no published original rendition");
  const defs = await restJson(
    `question_stance_definitions?rendition_id=eq.${r.id}&select=score,interpretation&order=score`,
  );
  const definitions = defs.length === 5
    ? "\nWhat each position stands for:\n" + defs.map((d: any) => `${d.score > 0 ? "+" : ""}${d.score}: ${d.interpretation}`).join("\n") + "\n"
    : "";
  const lang = r.language_code;
  const user = fill(GENERATE_TEMPLATE, {
    question_text: r.rendered_text,
    context: [r.summary, r.context_summary].filter((s: string | null) => s && s.trim()).join("\n\n") || "(none)",
    low_label: r.slider_low_label?.trim() || "Strongly disagree",
    high_label: r.slider_high_label?.trim() || "Strongly agree",
    definitions,
    language_name: await languageName(lang),
  });

  let err = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await chatJson(GENERATE_SYSTEM, user, err);
    err = out ? validateOptions(out.options, lang) ?? "" : "the answer was not valid JSON";
    if (!err) {
      const rows = out.options.map((o: any) => ({
        question_id: questionId,
        source_rendition_id: r.id,
        side: o.side,
        option_key: o.key,
        position: out.options.filter((p: any) => p.side === o.side).indexOf(o),
        model: MODEL,
        prompt_version: PROMPT_VERSION,
      }));
      const ins = await rest("question_reason_options?on_conflict=question_id,option_key", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify(rows),
      });
      if (!ins.ok) throw new Error(`insert options: ${ins.status} ${await ins.text()}`);
      // Re-read: a concurrent first call may have won; only label what is stored.
      const stored = await loadOptions(questionId);
      const labelRows = stored
        .map((s) => {
          const o = out.options.find((p: any) => p.key === s.option_key);
          return o ? { option_id: s.id, language_code: lang, label: String(o.label).trim() } : null;
        })
        .filter(Boolean);
      if (labelRows.length) {
        const lab = await rest("question_reason_option_labels?on_conflict=option_id,language_code", {
          method: "POST",
          headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify(labelRows),
        });
        if (!lab.ok) throw new Error(`insert labels: ${lab.status} ${await lab.text()}`);
      }
      return;
    }
    console.warn("[generate-reason-options] generation rejected", { questionId, attempt, err });
  }
  throw new Error(`generation failed validation twice: ${err}`);
}

async function translateLabels(questionId: string, lang: string, options: OptionRow[], sourceLabels: Map<string, string>) {
  const rend = (await restJson(
    `question_renditions?question_id=eq.${questionId}&language_code=eq.${encodeURIComponent(lang)}&lifecycle_status=eq.published&select=rendered_text&limit=1`,
  ))[0];
  const items = options.map((o) => ({ key: o.option_key, label: sourceLabels.get(o.id) ?? o.option_key }));
  const user = fill(TRANSLATE_TEMPLATE, {
    language_name: await languageName(lang),
    question_text: rend?.rendered_text ?? "(not available in this language)",
    options_json: JSON.stringify(items),
  });
  let err = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await chatJson(TRANSLATE_SYSTEM, user, err);
    const labels = out?.labels;
    err = !Array.isArray(labels) ? "labels is not an array" : "";
    if (!err) {
      for (const o of options) {
        const l = labels.find((x: any) => x?.key === o.option_key);
        const e = l ? checkLabel(l.label, lang) : `missing key ${o.option_key}`;
        if (e) { err = e; break; }
      }
    }
    if (!err) {
      const rows = options.map((o) => ({
        option_id: o.id,
        language_code: lang,
        label: String(labels.find((x: any) => x.key === o.option_key).label).trim(),
      }));
      const lab = await rest("question_reason_option_labels?on_conflict=option_id,language_code", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
      if (!lab.ok) throw new Error(`insert translated labels: ${lab.status} ${await lab.text()}`);
      return;
    }
    console.warn("[generate-reason-options] translation rejected", { questionId, lang, attempt, err });
  }
  throw new Error(`translation failed validation twice: ${err}`);
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
  const questionId = typeof body?.question_id === "string" ? body.question_id : "";
  const lang = String(body?.language_code ?? "en").trim().toLowerCase().split("-")[0] || "en";
  if (!/^[0-9a-f-]{36}$/i.test(questionId)) return json({ error: "question_id required" }, 400);

  try {
    let source: "stored" | "generated" = "stored";
    let options = await loadOptions(questionId);
    if (options.length === 0) {
      if (!OPENAI_API_KEY) return json({ error: "missing_openai_key", options: [] }, 503);
      const exists = await restJson(`questions?id=eq.${questionId}&published_at=not.is.null&select=id`);
      if (!exists.length) return json({ error: "question_not_found", options: [] }, 404);
      await generateOptions(questionId);
      options = await loadOptions(questionId);
      source = "generated";
    }

    const original = (await restJson(
      `question_reason_options?question_id=eq.${questionId}&select=source_rendition_id,question_renditions(language_code)&limit=1`,
    ))[0]?.question_renditions?.language_code ?? "en";
    const ids = options.map((o) => o.id);
    let labels = await loadLabels(ids, Array.from(new Set([lang, original])));
    const inLang = labels.filter((l: any) => l.language_code === lang);

    if (lang !== original && inLang.length < options.length && OPENAI_API_KEY) {
      try {
        const src = new Map<string, string>(
          labels.filter((l: any) => l.language_code === original).map((l: any) => [l.option_id, l.label]),
        );
        await translateLabels(questionId, lang, options, src);
        labels = await loadLabels(ids, Array.from(new Set([lang, original])));
        source = "generated";
      } catch (e) {
        // Non-fatal: the prompt shows the original-language labels, flagged.
        console.warn("[generate-reason-options] translation failed; falling back", e);
      }
    }

    const pick = (id: string) =>
      labels.find((l: any) => l.option_id === id && l.language_code === lang) ??
      labels.find((l: any) => l.option_id === id && l.language_code === original);
    return json({
      question_id: questionId,
      language_code: lang,
      source,
      options: options.map((o) => {
        const l = pick(o.id);
        return { side: o.side, key: o.option_key, position: o.position, label: l?.label ?? o.option_key, language_code: l?.language_code ?? original };
      }),
    });
  } catch (err) {
    console.error("[generate-reason-options] error", err);
    return json({ error: "generation_failed", detail: String(err), options: [] }, 500);
  }
});
