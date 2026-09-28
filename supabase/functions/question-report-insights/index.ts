// supabase/functions/question-report-insights/index.ts
//
// Epic Report R4 — the AI-written summary on a Question Insight Report.
//
// Body: { question_id, language_code }
//   -> { status: "ok" | "below_minimum" | "hidden" | "generating" | "unavailable",
//        snapshot_id?, generated_at?, response_count?, stale?, insights? }
//
// 1. ACCESS. Reads get_question_insight_report AS THE CALLER (their JWT, or
//    the anon key), so can_view_question_report decides, exactly as for the
//    report page itself. Everything after that uses the service role.
// 2. FACTS ONLY. The model sees the report's own statistics (English) and
//    nothing else — no table access. It never calculates: the validator
//    rejects any number that is not in the payload.
// 3. CACHE = SNAPSHOT. The latest English row in question_report_snapshots is
//    served until the data has moved enough to be worth a new one (see
//    whyRegenerate). One generation per question+language at a time: the
//    unique 'generating' slot makes a concurrent caller serve the previous
//    summary instead of paying for a second model call.
// 4. LANGUAGES. Other languages translate a specific English row
//    (source_snapshot_id), so every language describes the same numbers.
// 5. MINIMUM. No AI summary below 5 responses (decision D7).
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const PROMPT_KEY = "question_report_insights";
const MIN_RESPONSES = 5;
const DEVANAGARI = /[ऀ-ॿ]/;
const SCRIPT_BY_LANGUAGE: Record<string, RegExp> = { hi: DEVANAGARI, mr: DEVANAGARI };

// Keep in sync with the ai_prompts seed (20260928151000_epic_report_r4_insights_prompt.sql).
const HARDCODED_SYSTEM = `You write the plain-language summary section of a "Community Insight Report" about ONE question on Stance Capture, a civic opinion platform. You receive the report's statistics as JSON and nothing else.

Hard rules:
1. Use only facts in the JSON. Never calculate new numbers: every number you write must appear in the JSON exactly as given (counts, percentages, averages, dates). You may write counts as "6 of 9".
2. Say "respondents" or "respondents to this question". Never write residents, citizens, voters, the public, everyone, or "people of" a place, and never present respondents as representative of any population.
3. Never declare a winner, a mandate, or what "the majority wants". Describe how the responses are distributed.
4. Always describe minority positions, even a single response.
5. "position_meanings" describe what each position stands for; they are NOT respondents' words. Unless "reasons" has at least 5 respondents_with_reasons, never write that respondents said, cited, explained, mentioned or told anything; use conditional language ("respondents choosing this position may be prioritising ...").
6. When "reasons" has at least 5 respondents_with_reasons, you may report which reasons respondents chose. Name the reason and use the counts of ONE side exactly as given, e.g. "3 of the 4 respondents toward 'X' who gave a reason chose 'Y'". Never describe one side's count as a share of all respondents with reasons. You may quote only the quotes provided, word for word, in quotation marks.
7. Describe the trend only as movement in the averages; never give causes. Compare like with like: first_group_average with latest_group_average, or the running averages with each other — never a group average with a running average. With fewer than 30 responses, say it is an early signal.
8. If "question_changes_after_first_response" is not empty, mention each change (wording, answer scale or background) in trend_summary or caveats, and say that answers before and after a wording or scale change may not be directly comparable. If it is empty, say nothing at all about wording, scale or background changes.
9. "why_they_may_feel_this_way" must weigh ALL positions by their counts, not only the largest group.
10. "what_people_appear_to_want" states the outcome respondents appear to seek (for example "a predictable way to find hazards, assign ownership and follow up"), not the label of the option they chose.
11. Neutral, plain English, short sentences, no markdown.

Return JSON with exactly these keys:
{"headline": "one sentence, at most 30 words",
 "what_people_are_voting_for": "2-3 sentences",
 "why_they_may_feel_this_way": "2-4 sentences",
 "other_perspectives": "1-3 sentences",
 "trend_summary": "1-2 sentences",
 "what_people_appear_to_want": "1-2 sentences",
 "desired_outcomes": ["2-4 short noun phrases, at most 8 words each"],
 "caveats": ["1-4 short sentences"]}`;

const HARDCODED_USER = `Report statistics:
{{payload}}

Write the summary now, following every rule.`;

const TRANSLATE_SYSTEM =
  "You translate a short, neutral report summary for a civic opinion platform. Keep the meaning exactly, keep every number exactly as written (Western digits), keep any text inside quotation marks exactly as it is (those are respondents' own words), and answer with valid JSON only.";

const INSIGHT_KEYS = [
  "headline",
  "what_people_are_voting_for",
  "why_they_may_feel_this_way",
  "other_perspectives",
  "trend_summary",
  "what_people_appear_to_want",
] as const;

type Insights = Record<(typeof INSIGHT_KEYS)[number], string> & { desired_outcomes: string[]; caveats: string[] };

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

// ---------------------------------------------------------------------------
// The payload the model sees: the report's own numbers, English wording.
// ---------------------------------------------------------------------------
function trendEnds(points: any[]) {
  const withMean = points.filter((p) => p.bucketMean != null);
  if (withMean.length < 2) return { first_group_average: null, latest_group_average: null };
  const first = withMean[0];
  const last = withMean[withMean.length - 1];
  return {
    first_group: `responses ${first.fromResponse}-${first.toResponse}`,
    first_group_average: first.bucketMean,
    latest_group: `responses ${last.fromResponse}-${last.toResponse}`,
    latest_group_average: last.bucketMean,
    latest_running_average: last.cumulativeMean,
  };
}
function buildPayload(r: any) {
  const q = r.question;
  const rs = r.responseSummary;
  const low = q.lowLabel ?? "Strongly disagree";
  const high = q.highLabel ?? "Strongly agree";
  const scoreLabel = (s: number) =>
    s === -2 ? low : s === 2 ? high : s === 0 ? "neutral / unsure" : s < 0 ? `leans toward "${low}"` : `leans toward "${high}"`;
  const day = (iso: string | null) => (iso ? String(iso).slice(0, 10) : null);
  return {
    question: {
      text: q.text,
      context: [q.summary, q.context].filter(Boolean).join("\n\n") || null,
      scale: { "-2": low, "+2": high },
      location: q.location ?? null,
      topic: q.topic ?? null,
    },
    responses: {
      total: rs.total,
      signed_in: rs.signedIn,
      without_account: rs.anonymous,
      strength_label: rs.strength, // early (<30) | emerging (30-99) | established (100+)
      distribution: rs.distribution.map((d: any) => ({ score: d.score, position: scoreLabel(d.score), count: d.count, percentage: d.percentage })),
      average_position: rs.mean,
      median_position: rs.median,
      leaning_low: rs.lean.low,
      neutral: rs.lean.neutral,
      leaning_high: rs.lean.high,
      first_response_date: day(rs.firstResponseAt),
      last_response_date: day(rs.lastResponseAt),
    },
    position_meanings: r.stanceDefinitions
      ? r.stanceDefinitions.map((d: any) => ({ score: d.score, position: scoreLabel(d.score), meaning: d.interpretation }))
      : null,
    trend: {
      grouping: r.trend.bucket,
      // Spelled out so the model compares like with like (rule 7).
      ...trendEnds(r.trend.points),
      points: r.trend.points.map((p: any) => ({
        responses_from: p.fromResponse,
        responses_to: p.toResponse,
        group_average: p.bucketMean,
        running_average: p.cumulativeMean,
      })),
    },
    question_changes_after_first_response: r.changes.map((c: any) => ({ kind: c.kind, after_response: c.responsesBefore, date: day(c.at) })),
    edits_before_first_response: r.preResponseEdits,
    channels: r.channels,
    geography: r.geography,
    reasons: r.reasons && r.reasons.totalWithReasons > 0
      ? {
          respondents_with_reasons: r.reasons.totalWithReasons,
          by_side: r.reasons.sides
            .filter((sd: any) => sd.respondents > 0)
            .map((sd: any) => ({
              side: sd.side === "high" ? `toward "${high}"` : sd.side === "low" ? `toward "${low}"` : "neutral",
              respondents_on_this_side_who_gave_a_reason: sd.respondents,
              reasons_chosen: sd.options.filter((o: any) => o.count > 0).map((o: any) => ({ reason: o.label, count: o.count })),
              quotes: sd.quotes,
            })),
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Validator (RPT-22). Returns a list of violations; empty = accept.
// ---------------------------------------------------------------------------
const NUM = /[-+]?\d+(?:[.,]\d+)?/g;

function numbersIn(text: string): number[] {
  return (text.match(NUM) ?? []).map((n) => Number(n.replace(",", ".").replace("+", ""))).filter(Number.isFinite);
}

function allText(ins: Insights): string {
  return [...INSIGHT_KEYS.map((k) => ins[k]), ...(ins.desired_outcomes ?? []), ...(ins.caveats ?? [])].join("\n");
}

// Quoted spans (“…” or "…") of 12+ characters: respondents' words, never checked
// for language and required to be verbatim copies of a provided quote.
const QUOTED = /[“"]([^”"]{12,})[”"]/g;

function validateShape(ins: any): string[] {
  const v: string[] = [];
  if (!ins || typeof ins !== "object") return ["the answer is not a JSON object"];
  for (const k of INSIGHT_KEYS) {
    if (typeof ins[k] !== "string" || !ins[k].trim()) v.push(`"${k}" is missing or empty`);
    else if (ins[k].length > 900) v.push(`"${k}" is too long`);
  }
  if (!Array.isArray(ins.desired_outcomes) || ins.desired_outcomes.length < 2 || ins.desired_outcomes.length > 5 ||
      ins.desired_outcomes.some((o: unknown) => typeof o !== "string" || !o.trim() || o.length > 100)) {
    v.push(`"desired_outcomes" must be 2-4 short strings`);
  }
  if (!Array.isArray(ins.caveats) || ins.caveats.length < 1 || ins.caveats.length > 5 ||
      ins.caveats.some((o: unknown) => typeof o !== "string" || !o.trim())) {
    v.push(`"caveats" must be 1-4 short sentences`);
  }
  return v;
}

function validateEnglish(ins: Insights, payload: any): string[] {
  const v = validateShape(ins);
  if (v.length) return v;
  const text = allText(ins);
  const payloadText = JSON.stringify(payload);
  const payloadLower = payloadText.toLowerCase();

  // 1. Numbers must come from the payload (plus the scale ends and the
  //    published thresholds the prompt itself names).
  const allowed = new Set<number>([...numbersIn(payloadText), 0, 1, 2, 3, 4, 5, 30, 100]);
  const allowedList = [...allowed];
  for (const n of numbersIn(text.replace(QUOTED, " "))) {
    if (!allowedList.some((a) => Math.abs(Math.abs(a) - Math.abs(n)) < 0.006)) v.push(`the number ${n} is not in the statistics`);
  }

  // 2. Population language, winners and mandates. A word that is part of the
  //    question's own wording or scale (e.g. a "Residents and departments ..."
  //    label) is allowed, since the text may need to name that position.
  const banned: [RegExp, string][] = [
    [/\bwinners?\b/i, "winner"],
    [/\bmandate\b/i, "mandate"],
    [/\bmajority\s+(of\s+\w+\s+)?(wants?|demands?|supports?|believes?)\b/i, "majority wants"],
    [/\beveryone\b/i, "everyone"],
    [/\bthe public\b/i, "the public"],
    [/\bresidents?\b/i, "residents"],
    [/\bcitizens?\b/i, "citizens"],
    [/\bvoters?\b/i, "voters"],
    [/\bpeople of\b/i, "people of"],
  ];
  for (const [re, word] of banned) {
    if (re.test(text.replace(QUOTED, " ")) && !payloadLower.includes(word)) v.push(`do not use "${word}"`);
  }

  // 3. Attribution needs evidence.
  const reasonCount = payload.reasons?.respondents_with_reasons ?? 0;
  if (reasonCount < 5 && /\b(said|says|say|cited|cites|cite|told|explained|mentioned|stated|argued)\b/i.test(text)) {
    v.push("do not write that respondents said, cited, explained or mentioned anything: fewer than 5 respondents gave a reason");
  }

  // 4. Quotes must be verbatim copies of provided quotes.
  for (const m of text.matchAll(QUOTED)) {
    const q = m[1].trim();
    if (!payloadText.includes(q)) v.push(`quoted text "${q.slice(0, 40)}" is not one of the provided quotes or labels`);
  }

  // 5. Changes to the question must be disclosed — and never invented.
  const changeWords = /\b(wording|reworded|relabel\w*|scale change|changes? (to|in) the (question|scale|wording))\b/i;
  const where = `${ins.trend_summary}\n${ins.caveats.join("\n")}`;
  if ((payload.question_changes_after_first_response ?? []).length > 0) {
    if (!/wording|reworded|scale|relabel|background|context/i.test(where)) {
      v.push("mention the change(s) to the question listed in question_changes_after_first_response in trend_summary or caveats");
    }
  } else if (changeWords.test(where)) {
    v.push("the question did not change after the first response: say nothing about wording or scale changes");
  }

  // 6. A trend statement must not pair a group average with a running
  //    average: if both ends of the comparison are quoted, they must be the
  //    first/latest group averages or two running averages.
  const t = payload.trend ?? {};
  if (t.first_group_average != null && t.latest_running_average != null && t.latest_group_average !== t.latest_running_average) {
    const nums = numbersIn(ins.trend_summary);
    const has = (x: number) => nums.some((n) => Math.abs(n - x) < 0.006);
    if (has(t.first_group_average) && has(t.latest_running_average) && !has(t.latest_group_average)) {
      v.push(`trend_summary compares the first GROUP average (${t.first_group_average}) with the latest RUNNING average (${t.latest_running_average}); compare it with the latest group average (${t.latest_group_average}) instead`);
    }
  }
  return v;
}

function validateTranslation(tr: Insights, en: Insights, lang: string): string[] {
  const v = validateShape(tr);
  if (v.length) return v;
  const script = SCRIPT_BY_LANGUAGE[lang];
  const trText = allText(tr);
  const unquoted = trText.replace(QUOTED, " ");
  if (script) {
    for (const k of INSIGHT_KEYS) if (!script.test(tr[k])) v.push(`"${k}" is not in the requested language`);
    const latin = (unquoted.match(/\b[A-Za-z]{3,}\b/g) ?? []).filter((w) => !["Stance", "Capture", "WhatsApp"].includes(w));
    if (latin.length) v.push(`untranslated words: ${[...new Set(latin)].slice(0, 5).join(", ")}`);
  }
  const enNums = numbersIn(allText(en));
  for (const n of numbersIn(unquoted)) {
    if (!enNums.some((a) => Math.abs(a - n) < 0.006)) v.push(`the number ${n} is not in the English summary`);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Model calls
// ---------------------------------------------------------------------------
async function loadPrompt() {
  try {
    const rows = await restJson(
      `ai_prompts?prompt_key=eq.${PROMPT_KEY}&is_active=eq.true&select=version,system_prompt,user_prompt_template,model,temperature,max_tokens&order=version.desc&limit=1`,
    );
    const row = rows[0];
    if (row?.system_prompt && row?.user_prompt_template) {
      return {
        system: row.system_prompt as string,
        user: row.user_prompt_template as string,
        model: (row.model as string) || "gpt-4o-mini",
        temperature: Number(row.temperature ?? 0.3),
        maxTokens: Number(row.max_tokens ?? 1800),
        version: `ai_prompts:${PROMPT_KEY}:v${row.version}`,
      };
    }
  } catch (e) {
    console.warn("[question-report-insights] prompt load failed; using hardcoded", e);
  }
  return { system: HARDCODED_SYSTEM, user: HARDCODED_USER, model: "gpt-4o-mini", temperature: 0.3, maxTokens: 1800, version: "hardcoded:v1" };
}

async function chatJson(model: string, temperature: number, maxTokens: number, messages: { role: string; content: string }[]) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, response_format: { type: "json_object" } }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const data = await res.json();
  try {
    return JSON.parse(data?.choices?.[0]?.message?.content ?? "");
  } catch {
    return null;
  }
}

async function generateEnglish(payload: any, prompt: Awaited<ReturnType<typeof loadPrompt>>) {
  const messages = [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user.replaceAll("{{payload}}", JSON.stringify(payload, null, 1)) },
  ];
  let violations: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await chatJson(prompt.model, prompt.temperature, prompt.maxTokens, messages);
    violations = out ? validateEnglish(out, payload) : ["the answer was not valid JSON"];
    if (!violations.length) return { insights: out as Insights, violations: [] };
    console.warn("[question-report-insights] rejected", { attempt, violations });
    messages.push({ role: "assistant", content: JSON.stringify(out) });
    messages.push({ role: "user", content: `Your answer broke these rules:\n- ${violations.join("\n- ")}\nReturn the corrected JSON only.` });
  }
  return { insights: null, violations };
}

async function translate(en: Insights, lang: string, model: string) {
  const name = await languageName(lang);
  const messages = [
    { role: "system", content: TRANSLATE_SYSTEM },
    {
      role: "user",
      content: `Translate every value of this JSON into ${name}. Keep the keys, keep all numbers exactly, keep quoted text unchanged.\n\n${JSON.stringify(en, null, 1)}`,
    },
  ];
  let violations: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await chatJson(model, 0.2, 2500, messages);
    violations = out ? validateTranslation(out, en, lang) : ["the answer was not valid JSON"];
    if (!violations.length) return { insights: out as Insights, violations: [] };
    console.warn("[question-report-insights] translation rejected", { lang, attempt, violations });
    messages.push({ role: "assistant", content: JSON.stringify(out) });
    messages.push({ role: "user", content: `Your translation broke these rules:\n- ${violations.join("\n- ")}\nReturn the corrected JSON only.` });
  }
  return { insights: null, violations };
}

async function languageName(code: string): Promise<string> {
  try {
    const rows = await restJson(`languages?language_code=eq.${encodeURIComponent(code)}&select=display_name_english`);
    return rows[0]?.display_name_english ?? code;
  } catch {
    return code;
  }
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------
const SNAP_COLS =
  "id,status,generated_at,response_count,reason_count,stats_json,insights_json,desired_outcomes,hidden,prompt_version,model,source_snapshot_id";

async function latestSnapshot(questionId: string, lang: string, extra = "") {
  const rows = await restJson(
    `question_report_snapshots?question_id=eq.${questionId}&language_code=eq.${lang}&status=in.(ok,failed)${extra}&select=${SNAP_COLS}&order=generated_at.desc&limit=1`,
  );
  return rows[0] ?? null;
}

// Why the cached English summary no longer fits the data; null = serve it.
function whyRegenerate(snap: any, report: any, promptVersion: string): string | null {
  if (!snap) return "none";
  const n = report.responseSummary.total;
  const grew = n - snap.response_count;
  const reasons = report.reasons?.totalWithReasons ?? 0;
  const reasonsGrew = reasons - (snap.reason_count ?? 0);
  const ageHours = (Date.now() - new Date(snap.generated_at).getTime()) / 3_600_000;
  if (snap.status === "failed") return ageHours >= 1 ? "retry_failed" : null;
  if (grew >= (n < 30 ? 3 : Math.min(10, Math.max(1, Math.ceil(snap.response_count * 0.1))))) return "responses";
  if ((report.changes?.length ?? 0) !== (snap.stats_json?.question_changes_after_first_response?.length ?? 0)) return "question_changed";
  if (reasonsGrew >= (n < 30 ? 3 : 5)) return "reasons";
  if (ageHours >= 24 && (grew !== 0 || reasonsGrew !== 0)) return "daily";
  if (snap.prompt_version !== promptVersion) return "prompt_changed";
  return null;
}

// Claim the one 'generating' slot for question+language. Clears a slot left
// behind by a crashed run (older than 3 minutes) first.
async function claim(questionId: string, lang: string, row: Record<string, unknown>) {
  const cutoff = new Date(Date.now() - 180_000).toISOString();
  await rest(
    `question_report_snapshots?question_id=eq.${questionId}&language_code=eq.${lang}&status=eq.generating&generated_at=lt.${cutoff}`,
    { method: "DELETE" },
  );
  const res = await rest("question_report_snapshots", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ question_id: questionId, language_code: lang, status: "generating", ...row }),
  });
  if (res.status === 409) return null;
  if (!res.ok) throw new Error(`claim failed: ${res.status} ${await res.text()}`);
  return (await res.json())[0];
}

async function finish(id: string, patch: Record<string, unknown>) {
  const res = await rest(`question_report_snapshots?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ generated_at: new Date().toISOString(), ...patch }),
  });
  if (!res.ok) throw new Error(`finish failed: ${res.status} ${await res.text()}`);
  return (await res.json())[0];
}

function toCamel(ins: Insights | null) {
  if (!ins) return null;
  return {
    headline: ins.headline,
    whatPeopleAreVotingFor: ins.what_people_are_voting_for,
    whyTheyMayFeelThisWay: ins.why_they_may_feel_this_way,
    otherPerspectives: ins.other_perspectives,
    trendSummary: ins.trend_summary,
    whatPeopleAppearToWant: ins.what_people_appear_to_want,
    desiredOutcomes: ins.desired_outcomes,
    caveats: ins.caveats,
  };
}

function served(snap: any, lang: string, stale: boolean) {
  if (!snap || snap.status !== "ok") return json({ status: "unavailable", language_code: lang });
  if (snap.hidden) return json({ status: "hidden", snapshot_id: snap.id, language_code: lang });
  return json({
    status: "ok",
    snapshot_id: snap.id,
    generated_at: snap.generated_at,
    response_count: snap.response_count,
    model: snap.model,
    language_code: lang,
    stale,
    insights: toCamel(snap.insights_json),
  });
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

  // 1. Access + facts, as the caller.
  const rep = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_question_insight_report`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: req.headers.get("Authorization") ?? `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_question_id: questionId, p_language: "en" }),
  });
  if (!rep.ok) {
    const err = await rep.json().catch(() => ({}));
    if (/report_not_available/.test(String(err?.message ?? ""))) return json({ error: "report_not_available" }, 403);
    console.error("[question-report-insights] report read failed", rep.status, err);
    return json({ error: "report_failed" }, 500);
  }
  const report = await rep.json();
  const total = report?.responseSummary?.total ?? 0;
  if (total < MIN_RESPONSES) return json({ status: "below_minimum", minimum: MIN_RESPONSES, language_code: lang });

  try {
    // 2. English snapshot: serve, or regenerate.
    const prompt = await loadPrompt();
    let en = await latestSnapshot(questionId, "en");
    const reason = whyRegenerate(en, report, prompt.version);
    if (reason && OPENAI_API_KEY) {
      const payload = buildPayload(report);
      const slot = await claim(questionId, "en", {
        response_count: total,
        reason_count: report.reasons?.totalWithReasons ?? 0,
        response_cutoff_at: report.responseSummary.lastResponseAt,
        current_rendition_id: report.question.currentRenditionId,
        stats_json: payload,
      });
      if (!slot) {
        // Someone else is generating right now.
        if (!en || en.status !== "ok") return json({ status: "generating", language_code: lang });
      } else {
        console.log("[question-report-insights] generating", { questionId, reason });
        const { insights, violations } = await generateEnglish(payload, prompt);
        en = await finish(slot.id, insights
          ? { status: "ok", insights_json: insights, desired_outcomes: insights.desired_outcomes, model: prompt.model, prompt_version: prompt.version }
          : { status: "failed", failure_reason: violations.join(" | ").slice(0, 2000), model: prompt.model, prompt_version: prompt.version });
      }
    }
    if (!en || en.status !== "ok") return json({ status: "unavailable", language_code: lang });
    const stale = !!whyRegenerate(en, report, prompt.version);
    if (lang === "en") return served(en, lang, stale);

    // 3. Other languages: a translation of THIS English snapshot.
    let tr = await latestSnapshot(questionId, lang, `&source_snapshot_id=eq.${en.id}`);
    if (!tr || (tr.status === "failed" && (Date.now() - new Date(tr.generated_at).getTime()) >= 3_600_000)) {
      const slot = await claim(questionId, lang, {
        source_snapshot_id: en.id,
        response_count: en.response_count,
        reason_count: en.reason_count,
        stats_json: en.stats_json,
        hidden: en.hidden,
      });
      if (!slot) return served(en, "en", stale); // translation in progress: show English meanwhile
      const { insights, violations } = await translate(en.insights_json, lang, prompt.model);
      tr = await finish(slot.id, insights
        ? { status: "ok", insights_json: insights, desired_outcomes: insights.desired_outcomes, model: prompt.model, prompt_version: prompt.version }
        : { status: "failed", failure_reason: violations.join(" | ").slice(0, 2000), model: prompt.model, prompt_version: prompt.version });
    }
    if (!tr || tr.status !== "ok") return served(en, "en", stale); // fall back to English, labelled by language_code
    return served({ ...tr, hidden: tr.hidden || en.hidden }, lang, stale);
  } catch (err) {
    console.error("[question-report-insights] error", err);
    return json({ status: "unavailable", error: "generation_failed", language_code: lang });
  }
});
