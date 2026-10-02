// supabase/functions/ugq-screen/pipeline_v2.ts
// UGQ pipeline v2 — Phase 1 (Oct 2026). Research once, write once, check once.
//
// Replaces, behind UGQ_PIPELINE=v2, the old path where ugq-screen wrote a fast
// unverified preview with its own web search and then (voice/video only)
// ugq-verify-preview ran ugq-moderate's Stage A/B/C, which researched the same
// incidents again from scratch. Measured on Prod on 2 Oct 2026: ~$0.50 and up
// to ~2.5 minutes per voice proposal, and the two passes disagreed about which
// examples to keep. Here the stages are:
//
//   1. extraction   — cheap model, NO web search: the proposer's intent, the
//                     actor they hold responsible, and every specific event
//                     they referred to (with date/location hints). Code keeps
//                     up to MAX_EXAMPLES of them; the rest become "and others".
//   2. research     — one worker per kept event, IN PARALLEL, each with its own
//                     small web-search budget. A worker must first establish
//                     the event's identity (matched / not_found / ambiguous)
//                     and may only return facts for a matched event — the
//                     Flydubai 2016 crash vs 2026 stabbing mix-up is exactly
//                     what this gate exists for. Facts whose source URL did
//                     not actually appear in that worker's search results are
//                     dropped in code (no invented citations). An unclear
//                     result is retried once on the stronger model.
//   3. fact sheet   — evidence state per event, computed in CODE from
//                     measurable signals (distinct publishers, a recognised
//                     outlet, reported contradictions), never from a model's
//                     self-reported confidence.
//   4. writer       — strong model, once, from the fact sheet (a few thousand
//                     tokens, not 20-60k of raw search results).
//   5. validator    — checks the question against the RAW proposal (not just
//                     the extraction, which can itself miss an example), the
//                     fact sheet, neutrality (Mirror Rule), stance/actor
//                     fidelity, form, and the native-language rendition.
//   6. repair       — on failure: one targeted repair, re-validate; if it
//                     still fails, one full rewrite, re-validate. Hard cap —
//                     no open-ended loop. A question that still fails is
//                     returned with verified=false (fail open, same posture as
//                     the rest of this pipeline: never block the proposer).
//
// Output keeps the existing preview_reframe shape (plus verified), so publish,
// admin review and translation are unchanged. The research artifacts are
// returned separately for the four v2 columns on user_question_proposals.

export type PreviewV2 = {
  question: string;
  slider_low_label: string | null;
  slider_high_label: string | null;
  context_summary: string | null;
  supporting_links: string[];
  quality_notes: string;
  cover_image_url: string | null;
  detected_language: string;
  question_native: string | null;
  slider_low_label_native: string | null;
  slider_high_label_native: string | null;
  context_summary_native: string | null;
  audience_country: string | null;
  verified: boolean;
};

export type PipelineConfig = {
  apiKey: string;
  fastModel: string;
  strongModel: string;
  maxExamples: number;
  // Shared prompt fragments owned by ugq-screen/index.ts, passed in so v1 and
  // v2 stay word-for-word identical on language and audience handling.
  languageInstructions: string;
  audienceInstructions: string;
};

export type PipelineResult = {
  preview: PreviewV2;
  extracted_events: ExtractedEvents;
  fact_sheet: FactSheet;
  verification_result: VerificationResult;
  pipeline_metrics: PipelineMetrics;
};

type EventRef = {
  id: string;
  user_description: string;
  entities: string[];
  event_type_hint: string | null;
  date_hint: string | null;
  location_hint: string | null;
  emphasis: "primary" | "secondary";
  // "pattern" = a class of incidents ("stabbings in the UK and Europe"), not
  // one occurrence. There is no single event to identify, so it is named the
  // way the proposer named it and never researched (2 Oct 2026 test: the
  // research worker and its stronger-model retry both — correctly — returned
  // "ambiguous" for exactly this, at ~$0.08 for nothing).
  kind: "single_event" | "pattern";
  source: "proposal" | "added_context";
};

export type ExtractedEvents = {
  detected_language: string;
  intent: string;
  proposer_actor: string | null;
  general_topic: string;
  audience_country: string | null;
  events: EventRef[];
  kept_event_ids: string[];
  more_count: number;
};

type Fact = { claim: string; source_url: string; source_title: string | null; source_date: string | null };

type EvidenceState = "VERIFIED" | "PARTIALLY_VERIFIED" | "CONFLICTING" | "UNVERIFIED";

type ResearchedEvent = {
  event_id: string;
  user_description: string;
  identity_status: "matched" | "not_found" | "ambiguous" | "error" | "not_researched";
  candidate_event: string | null;
  event_date: string | null;
  identity_evidence: string[];
  evidence_state: EvidenceState;
  facts: Fact[];
  contradictions: string[];
  publishers: string[];
  model: string;
  escalated: boolean;
};

export type FactSheet = {
  version: 1;
  researched_at: string;
  events: ResearchedEvent[];
  background: ResearchedEvent | null;
  sources: string[];
};

type Issue = { type: string; detail: string; fix: string };

export type VerificationResult = {
  pass: boolean;
  attempts: Array<{ stage: "initial" | "repair" | "rewrite"; pass: boolean; issues: Issue[] }>;
  rewrite_count: number;
};

type StageMetric = {
  stage: string;
  model: string;
  ms: number;
  input_tokens: number;
  output_tokens: number;
  searches: number;
  cost_usd: number;
  ok: boolean;
};

export type PipelineMetrics = {
  version: "v2";
  mode: "fresh" | "refine";
  total_ms: number;
  extraction_ms: number;
  research_ms: number;
  writer_ms: number;
  validator_ms: number;
  repair_ms: number;
  search_count: number;
  input_tokens: number;
  output_tokens: number;
  model_cost_usd: number;
  search_cost_usd: number;
  total_cost_usd: number;
  events_detected: number;
  events_kept: number;
  events_verified: number;
  sources_used: number;
  rewrite_count: number;
  stages: StageMetric[];
};

// ── Cost table (USD per 1M tokens) — estimates for pipeline_metrics only;
//    the Anthropic Console stays the source of truth for billing. ──────────────
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
  "claude-opus-5-5": { in: 4, out: 20 },
};
const SEARCH_COST_USD = 0.01;

function priceFor(model: string) {
  return PRICES[model] ?? { in: 3, out: 15 };
}

// Recognised outlets — one signal (with publisher count and contradictions) for
// the evidence state. Deliberately a short, boring list, not a quality score.
const RECOGNISED_OUTLETS = [
  "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk", "cnn.com", "nytimes.com", "washingtonpost.com",
  "theguardian.com", "npr.org", "cbsnews.com", "nbcnews.com", "abcnews.go.com", "aljazeera.com", "dw.com",
  "france24.com", "bloomberg.com", "ft.com", "wsj.com", "economist.com", "cbc.ca", "abc.net.au", "smh.com.au",
  "skynews.com", "news.sky.com", "thehindu.com", "indianexpress.com", "hindustantimes.com", "timesofindia.indiatimes.com",
  "ndtv.com", "indiatoday.in", "livemint.com", "business-standard.com", "theprint.in", "scroll.in", "thewire.in",
  "news18.com", "deccanherald.com", "thenationalnews.com", "gulfnews.com", "khaleejtimes.com", "pib.gov.in",
  "pbs.org", "time.com", "usatoday.com", "latimes.com", "politico.com", "axios.com", "theatlantic.com",
  "chicagotribune.com", "suntimes.com", "independent.co.uk", "telegraph.co.uk", "thetimes.co.uk", "lemonde.fr",
  "spiegel.de", "scmp.com", "straitstimes.com", "economictimes.indiatimes.com", "moneycontrol.com", "firstpost.com",
  "thequint.com", "aninews.in", "ptinews.com", "punemirror.com", "mid-day.com", "freepressjournal.in",
];

function publisherOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  } catch {
    return null;
  }
}

function isRecognised(publisher: string): boolean {
  return RECOGNISED_OUTLETS.some((d) => publisher === d || publisher.endsWith("." + d));
}

function normUrl(u: string): string {
  try {
    const x = new URL(u.trim());
    x.hash = "";
    return (x.origin + x.pathname).replace(/\/+$/, "").toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function extractJson(s: string): Record<string, unknown> | null {
  const cleaned = s.replace(/<\/?cite\b[^>]*>/gi, "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : [];

const NULLABLE_STRING = { anyOf: [{ type: "string" }, { type: "null" }] };

// ── Claude call with usage capture ─────────────────────────────────────────
type CallResult = {
  ok: boolean;
  text: string;
  stopReason: string | null;
  searchResults: Array<{ url: string; title: string | null; page_age: string | null }>;
  metric: StageMetric;
  httpStatus: number;
};

async function callClaude(cfg: PipelineConfig, opts: {
  stage: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  webSearchUses?: number;
  schema?: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  timeoutMs: number;
}): Promise<CallResult> {
  const t0 = Date.now();
  const isHaiku = opts.model.startsWith("claude-haiku");
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  };
  // Haiku 4.5 takes no effort setting (it errors there) and still accepts
  // temperature; the Sonnet 5 family rejects sampling params and takes effort.
  if (isHaiku) body.temperature = 0;
  const outputConfig: Record<string, unknown> = {};
  if (!isHaiku && opts.effort) outputConfig.effort = opts.effort;
  if (opts.schema) outputConfig.format = { type: "json_schema", schema: opts.schema };
  if (Object.keys(outputConfig).length) body.output_config = outputConfig;
  if (opts.webSearchUses && opts.webSearchUses > 0) {
    body.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: opts.webSearchUses }];
  }

  const empty = (status: number): CallResult => ({
    ok: false, text: "", stopReason: null, searchResults: [], httpStatus: status,
    metric: { stage: opts.stage, model: opts.model, ms: Date.now() - t0, input_tokens: 0, output_tokens: 0, searches: 0, cost_usd: 0, ok: false },
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    clearTimeout(timer);
    console.error(JSON.stringify({ tag: `ugq-screen.v2.${opts.stage}_fetch_failed`, model: opts.model, message: (e as Error).message }));
    return empty(0);
  }
  clearTimeout(timer);
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error(JSON.stringify({ tag: `ugq-screen.v2.${opts.stage}_http_error`, model: opts.model, status: res.status, body: errBody.slice(0, 400) }));
    return empty(res.status);
  }
  const data = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!data) return empty(res.status);

  const blocks = Array.isArray(data.content) ? data.content as Array<Record<string, unknown>> : [];
  const text = blocks.filter((b) => b?.type === "text").map((b) => String(b.text ?? "")).join("\n");
  const searchResults: CallResult["searchResults"] = [];
  for (const b of blocks) {
    if (b?.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content as Array<Record<string, unknown>>) {
        if (typeof r?.url === "string") {
          searchResults.push({ url: r.url, title: str(r.title), page_age: str(r.page_age) });
        }
      }
    }
  }
  const usage = (data.usage ?? {}) as Record<string, unknown>;
  const inTok = Number(usage.input_tokens ?? 0) + Number(usage.cache_creation_input_tokens ?? 0) + Number(usage.cache_read_input_tokens ?? 0);
  const outTok = Number(usage.output_tokens ?? 0);
  const searches = Number((usage.server_tool_use as Record<string, unknown> | undefined)?.web_search_requests ?? 0);
  const p = priceFor(opts.model);
  const cost = (inTok * p.in + outTok * p.out) / 1_000_000 + searches * SEARCH_COST_USD;
  const stopReason = typeof data.stop_reason === "string" ? data.stop_reason : null;
  const ok = !!text && stopReason !== "refusal" && stopReason !== "max_tokens";
  if (!ok) {
    console.error(JSON.stringify({ tag: `ugq-screen.v2.${opts.stage}_unusable`, model: opts.model, stop_reason: stopReason, text_len: text.length }));
  }
  return {
    ok, text, stopReason, searchResults, httpStatus: res.status,
    metric: { stage: opts.stage, model: opts.model, ms: Date.now() - t0, input_tokens: inTok, output_tokens: outTok, searches, cost_usd: cost, ok },
  };
}

// ── 1. Extraction ─────────────────────────────────────────────────────────
const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["detected_language", "intent", "proposer_actor", "events", "general_topic", "audience_country"],
  properties: {
    detected_language: { type: "string" },
    intent: { type: "string" },
    proposer_actor: NULLABLE_STRING,
    general_topic: { type: "string" },
    audience_country: NULLABLE_STRING,
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["user_description", "kind", "entities", "event_type_hint", "date_hint", "location_hint", "emphasis"],
        properties: {
          user_description: { type: "string" },
          kind: { type: "string", enum: ["single_event", "pattern"] },
          entities: { type: "array", items: { type: "string" } },
          event_type_hint: NULLABLE_STRING,
          date_hint: NULLABLE_STRING,
          location_hint: NULLABLE_STRING,
          emphasis: { type: "string", enum: ["primary", "secondary"] },
        },
      },
    },
  },
};

function extractionSystem(alreadyKnown: string[] | null): string {
  return (
    "You read a citizen's raw civic-question proposal for a stance platform and pull out its structure. You do " +
    "NOT research anything and you do NOT judge whether anything is true. The proposal may be in any language or " +
    "a mix (Hindi in Devanagari, Hindi in Roman letters, Hinglish); write every field in English.\n" +
    "- intent: one sentence stating the stance the proposer wants people to answer, in the proposer's own " +
    "framing — do not soften, sharpen or re-angle it.\n" +
    "- proposer_actor: who the proposer asks to act or holds responsible (e.g. 'Middle East airlines', 'Pune " +
    "Municipal Corporation'), or null if none.\n" +
    "- events: EVERY specific real-world incident, event or example the proposer refers to, in the order they " +
    "mention them, one entry each. A named occurrence counts ('the Flydubai incident', 'the firing on the " +
    "Australian beach', 'stabbings in the UK and European countries', 'the Pahalgam attack'). A bare category " +
    "with nothing specific ('crime in general', 'hate crimes worldwide') is NOT an event. user_description is " +
    "how the proposer described it (translated to English if needed). kind is 'single_event' when it points to " +
    "one occurrence ('the Flydubai incident', 'the Pahalgam attack', 'the firing on the Australian beach') and " +
    "'pattern' when it is a class of several occurrences with no single one meant ('stabbings in the UK and " +
    "European countries', 'recent bridge collapses in Bihar'). entities are named organisations, places, " +
    "people, AND named systems, schemes, policies, laws or products ('UPI', 'NPCI', 'GST', 'Agnipath', 'the " +
    "Labour Codes') mentioned in that description — an example with no name of any kind cannot be pinned " +
    "down, so do not invent one. date_hint/location_hint only from what the proposer said ('this week', " +
    "'last year', 'in Pune'), else null. emphasis is 'primary' for the event(s) the question is centred on, " +
    "'secondary' for supporting examples.\n" +
    (alreadyKnown && alreadyKnown.length
      ? "- The proposal ALREADY covers these events; do NOT list them again, list only events that are new in " +
        "this text: " + alreadyKnown.map((d) => `"${d}"`).join(", ") + ".\n"
      : "") +
    "- general_topic: a 3-8 word search phrase for the overall subject.\n" +
    "- detected_language: ISO 639-1 code of the input language (Hinglish counts as 'hi' only if Hindi words " +
    "outnumber English words, otherwise 'en').\n" +
    "- audience_country: the country whose public this is for, or 'Global', or null if you cannot tell."
  );
}

function parseExtraction(raw: Record<string, unknown> | null, idPrefix: string, source: EventRef["source"]): Omit<ExtractedEvents, "kept_event_ids" | "more_count"> | null {
  if (!raw) return null;
  const evs = Array.isArray(raw.events) ? raw.events as Array<Record<string, unknown>> : [];
  const events: EventRef[] = evs
    .map((e, i) => ({
      id: `${idPrefix}${i + 1}`,
      user_description: str(e.user_description) ?? "",
      entities: strArr(e.entities),
      event_type_hint: str(e.event_type_hint),
      date_hint: str(e.date_hint),
      location_hint: str(e.location_hint),
      emphasis: (e.emphasis === "primary" ? "primary" : "secondary") as EventRef["emphasis"],
      kind: (e.kind === "pattern" ? "pattern" : "single_event") as EventRef["kind"],
      source,
    }))
    .filter((e) => e.user_description);
  return {
    detected_language: (str(raw.detected_language) ?? "en").toLowerCase().slice(0, 10),
    intent: str(raw.intent) ?? "",
    proposer_actor: str(raw.proposer_actor),
    general_topic: str(raw.general_topic) ?? "",
    audience_country: str(raw.audience_country),
    events,
  };
}

// Owner's rule (2 Oct 2026): name up to MAX_EXAMPLES, then "and others".
// Primary events first, then in the order the proposer mentioned them.
function chooseKept(events: EventRef[], max: number, preferIds: string[] = []): { kept: string[]; more: number } {
  const ordered = [
    ...events.filter((e) => preferIds.includes(e.id)),
    ...events.filter((e) => !preferIds.includes(e.id) && e.emphasis === "primary"),
    ...events.filter((e) => !preferIds.includes(e.id) && e.emphasis !== "primary"),
  ];
  const kept = ordered.slice(0, max).map((e) => e.id);
  return { kept, more: Math.max(0, events.length - kept.length) };
}

// ── 2/3. Research workers + evidence state ─────────────────────────────────
function researchSystem(today: string, mode: "event" | "background"): string {
  const common =
    `Today's date is ${today}. Use web search (at most 2 searches). Report only what the search results you ` +
    "actually saw say: every fact needs the exact URL of the result it came from, copied as shown. Never state " +
    "that an un-convicted person is guilty — use 'allegedly', 'accused' or 'police said'. If sources disagree " +
    "on a material point, list it in contradictions. Return ONLY a JSON object, no prose: " +
    "{\"identity_status\":\"matched\"|\"not_found\"|\"ambiguous\",\"candidate_event\":\"one-line name of the " +
    "event you identified, or null\",\"event_date\":\"YYYY-MM-DD or YYYY-MM, or null\",\"identity_evidence\":" +
    "[\"why this is (or is not) the event meant: entity, event type, date, place\"],\"facts\":[{\"claim\":" +
    "\"one short factual sentence\",\"source_url\":\"...\",\"source_title\":\"...\",\"source_date\":\"... or " +
    "null\"}],\"contradictions\":[\"...\"]}. 3-6 facts at most.";
  if (mode === "background") {
    return (
      "You gather short, neutral background facts on a civic topic a citizen raised. Set identity_status to " +
      "'matched' if you found relevant, current information, else 'not_found'. " + common
    );
  }
  return (
    "You research ONE specific event a citizen referred to in a civic question. FIRST establish identity: find " +
    "the specific event that matches the description, its named entities, its event type and any date or place " +
    "hint. A description like 'the recent X incident' or 'this week' means the latest matching event, usually " +
    "within the last few months. A real event involving the same entity but of a different kind or from a " +
    "different period is NOT a match (e.g. an airline's crash years ago is not 'the recent stabbing on that " +
    "airline'). If two or more different events fit about equally well, return 'ambiguous' and no facts. If " +
    "nothing fits, return 'not_found' and no facts. Only for 'matched' return facts about THAT event. " + common
  );
}

function researchUser(ev: { user_description: string; entities: string[]; event_type_hint: string | null; date_hint: string | null; location_hint: string | null }, rawProposal: string): string {
  return (
    `The citizen's own words (for context only):\n"${rawProposal.slice(0, 1500)}"\n\n` +
    `Event to research: "${ev.user_description}"\n` +
    `Named entities: ${ev.entities.length ? ev.entities.join(", ") : "(none)"}\n` +
    `Event type hint: ${ev.event_type_hint ?? "(none)"}\n` +
    `Date hint: ${ev.date_hint ?? "(none)"}\n` +
    `Location hint: ${ev.location_hint ?? "(none)"}`
  );
}

function evidenceFrom(identity: ResearchedEvent["identity_status"], facts: Fact[], contradictions: string[]): { state: EvidenceState; publishers: string[] } {
  const publishers = [...new Set(facts.map((f) => publisherOf(f.source_url)).filter((p): p is string => !!p))];
  if (identity !== "matched" || facts.length === 0) return { state: "UNVERIFIED", publishers };
  if (contradictions.length > 0) return { state: "CONFLICTING", publishers };
  if (publishers.length >= 2 && publishers.some(isRecognised)) return { state: "VERIFIED", publishers };
  return { state: "PARTIALLY_VERIFIED", publishers };
}

async function researchOne(
  cfg: PipelineConfig, ev: EventRef | null, background: { topic: string } | null, rawProposal: string,
  today: string, metrics: StageMetric[],
): Promise<ResearchedEvent> {
  const mode = background ? "background" : "event";
  const target = background
    ? { user_description: background.topic, entities: [], event_type_hint: null, date_hint: null, location_hint: null }
    : ev!;
  const eventId = background ? "background" : ev!.id;

  const attempt = async (model: string, escalated: boolean): Promise<ResearchedEvent | null> => {
    const r = await callClaude(cfg, {
      stage: background ? "research_background" : `research_${eventId}${escalated ? "_escalated" : ""}`,
      model, system: researchSystem(today, mode), user: researchUser(target, rawProposal),
      maxTokens: 2048, webSearchUses: 2, effort: "low", timeoutMs: 45_000,
    });
    metrics.push(r.metric);
    if (!r.ok) return null;
    const parsed = extractJson(r.text);
    if (!parsed) {
      console.error(JSON.stringify({ tag: "ugq-screen.v2.research_unparseable", event_id: eventId, model, head: r.text.slice(0, 300) }));
      return null;
    }
    const identityRaw = str(parsed.identity_status);
    const identity: ResearchedEvent["identity_status"] =
      identityRaw === "matched" || identityRaw === "ambiguous" || identityRaw === "not_found" ? identityRaw : "not_found";
    // A fact may only cite a URL this worker's own searches returned.
    const seen = new Map(r.searchResults.map((s) => [normUrl(s.url), s]));
    const factsRaw = Array.isArray(parsed.facts) ? parsed.facts as Array<Record<string, unknown>> : [];
    let dropped = 0;
    const facts: Fact[] = identity !== "matched" ? [] : factsRaw.flatMap((f) => {
      const claim = str(f.claim);
      const url = str(f.source_url);
      const hit = url ? seen.get(normUrl(url)) : undefined;
      if (!claim || !url || !hit) {
        dropped++;
        return [];
      }
      return [{ claim, source_url: hit.url, source_title: str(f.source_title) ?? hit.title, source_date: str(f.source_date) ?? hit.page_age }];
    }).slice(0, 6);
    if (dropped) {
      console.log(JSON.stringify({ tag: "ugq-screen.v2.research_dropped_uncited_facts", event_id: eventId, dropped }));
    }
    const contradictions = strArr(parsed.contradictions);
    // A "match" with no citable fact is not evidence of anything.
    const effectiveIdentity = identity === "matched" && facts.length === 0 ? "not_found" : identity;
    const ev2 = evidenceFrom(effectiveIdentity, facts, contradictions);
    return {
      event_id: eventId,
      user_description: target.user_description,
      identity_status: effectiveIdentity,
      candidate_event: str(parsed.candidate_event),
      event_date: str(parsed.event_date),
      identity_evidence: strArr(parsed.identity_evidence).slice(0, 5),
      evidence_state: ev2.state,
      facts,
      contradictions,
      publishers: ev2.publishers,
      model,
      escalated,
    };
  };

  let out = await attempt(cfg.fastModel, false);
  // Escalate once to the strong model when the cheap worker failed outright or
  // could not settle WHICH event was meant. Never escalate "not_found" for a
  // background search — no topic background is a normal outcome.
  if ((!out || out.identity_status === "ambiguous") && cfg.strongModel !== cfg.fastModel) {
    const retry = await attempt(cfg.strongModel, true);
    if (retry) out = retry;
  }
  return out ?? {
    event_id: eventId, user_description: target.user_description, identity_status: "error", candidate_event: null,
    event_date: null, identity_evidence: [], evidence_state: "UNVERIFIED", facts: [], contradictions: [], publishers: [],
    model: cfg.fastModel, escalated: false,
  };
}

// ── 4. Writer ──────────────────────────────────────────────────────────────
const PREVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "question", "slider_low_label", "slider_high_label", "context_summary", "supporting_links", "quality_notes",
    "detected_language", "question_native", "slider_low_label_native", "slider_high_label_native",
    "context_summary_native", "audience_country",
  ],
  properties: {
    question: { type: "string" },
    slider_low_label: { type: "string" },
    slider_high_label: { type: "string" },
    context_summary: NULLABLE_STRING,
    supporting_links: { type: "array", items: { type: "string" } },
    quality_notes: { type: "string" },
    detected_language: { type: "string" },
    question_native: NULLABLE_STRING,
    slider_low_label_native: NULLABLE_STRING,
    slider_high_label_native: NULLABLE_STRING,
    context_summary_native: NULLABLE_STRING,
    audience_country: NULLABLE_STRING,
  },
};

const STRUCTURE_RULES =
  "Structure of the question itself: one short concrete context clause, one clause on the underlying tension or " +
  "accountability question, then ONE question put directly to the reader (e.g. 'do you…?', never a stray 'you' tacked onto the end), answerable on a single -2..+2 oppose/support " +
  "spectrum (never a menu of options, never 'A, B, or C', never 'Do you support' / 'Do you back' / 'Should the " +
  "government' — ask about the thing itself instead, e.g. 'should traffic police strictly enforce…, in your " +
  "view?' or 'do you think … should …?'). Use " +
  "up to 65 words — 65 is the hard maximum. Plain everyday language, no jargon. The question is ONE " +
  "proposition the reader agrees or disagrees with — never an either/or ('should X…, or should Y…?', 'is it " +
  "A or B?'): with two options there is no telling which end of the slider is 'yes'. slider_high_label says " +
  "what answering YES to the question exactly as written means, slider_low_label what answering NO means — " +
  "each a 3-6 word noun phrase, English. Check it by reading the question and answering 'yes': that answer " +
  "must be the high label. ";

const EVIDENCE_RULES =
  "EVIDENCE RULES — you are given a fact sheet; it is your ONLY source of facts. Never add a fact, number, date, " +
  "name or attribution that is not in it. Per example: VERIFIED or PARTIALLY_VERIFIED — you may use its facts " +
  "(only those listed). CONFLICTING — never state the disputed point as fact; leave it out or say reports " +
  "differ. UNVERIFIED (not found, ambiguous, or no usable source) — it is still the proposer's own reference: " +
  "name it the way the proposer did, add no facts about it, and do not cast doubt on it. ";

const FIDELITY_RULES =
  "FIDELITY (Mirror Rule) — the question must measure the proposer's stance as given in intent, about the actor " +
  "they named. Never swap the actor (e.g. turning 'can passengers trust these airlines' into 'should this " +
  "airline publicly account for X'), never re-centre the question on a different angle a fact happens to " +
  "suggest, never import a trade-off the proposer did not raise. Never contradict, hedge on, or cast doubt on " +
  "the proposer's framing. KEEP THE PROPOSER'S FRAMING EVEN WHEN A FACT QUALIFIES IT (owner decision, Oct " +
  "2026): if the fact sheet contradicts or narrows the proposer's premise (e.g. they ask whether small " +
  "merchants should bear a charge, and sources say small merchants are exempt), ask the proposer's question as " +
  "they asked it and put that fact in context_summary only — never rewrite the question around it. " +
  "NEUTRAL WORDING — measure the proposer's stance, do not carry their opinion. Their own slant or rhetoric " +
  "('not leave it only to the PMC', 'obviously', 'finally') must not appear in the question; ask the plain " +
  "version so either answer reads as reasonable. ";

function namingRules(more: number): string {
  return (
    "NAMED EXAMPLES — name every example in examples_to_name briefly in the context clause (the proposer chose " +
    "them; never drop one, never fold them into a vague summary like 'a string of attacks')." +
    (more > 0
      ? ` The proposer named ${more} more beyond these (examples_covered_by_and_others): do NOT name those — ` +
        "add 'and others' right after the named ones instead."
      : " Do not add 'and others' — there are no further examples.") +
    " quality_notes must describe each example's research exactly as its research_note says — never call an " +
    "example unverifiable if it was simply not researched. "
  );
}

function writerSystem(cfg: PipelineConfig, more: number, refine: boolean): string {
  return (
    "You write the stance question a citizen proposed for a civic stance platform, from a structured brief and a " +
    "fact sheet. " +
    (refine
      ? "You are REVISING the current draft because the proposer added context: keep what is still accurate, " +
        "weave the new context in as a qualifying clause on the existing tension, and only change the central " +
        "tension if the new context makes it factually wrong. "
      : "") +
    STRUCTURE_RULES + EVIDENCE_RULES + FIDELITY_RULES + namingRules(more) +
    "BACKGROUND — context_summary: 1-3 neutral sentences built only from the fact sheet (it may cover more than " +
    "one example), or null if the fact sheet has no usable facts. supporting_links: up to 3 URLs chosen ONLY from " +
    "available_sources, backing context_summary ([] if none). quality_notes: one short sentence. " +
    cfg.languageInstructions + cfg.audienceInstructions +
    "Return ONLY the JSON object."
  );
}

// What actually happened to each example, in words — so quality_notes and the
// validator never describe an example as "could not be verified" when it was
// simply never researched (2 Oct 2026 test: Pahalgam, set aside for "and
// others", was reported as unverifiable).
function researchNote(e: ResearchedEvent): string {
  switch (e.identity_status) {
    case "matched": return `researched and identified (${e.evidence_state})`;
    case "not_researched": return `not researched: ${e.identity_evidence[0] ?? "nothing specific to identify"}`;
    case "ambiguous": return "researched: several different events fit, so none was picked";
    case "not_found": return "researched: no matching event found";
    default: return "research failed";
  }
}

function compactSheet(sheet: FactSheet, extracted: ExtractedEvents) {
  const keptIds = extracted.kept_event_ids;
  const pick = (e: ResearchedEvent) => ({
    id: e.event_id,
    proposer_described_it_as: e.user_description,
    evidence_state: e.evidence_state,
    research_note: researchNote(e),
    identified_as: e.identity_status === "matched" ? e.candidate_event : null,
    event_date: e.identity_status === "matched" ? e.event_date : null,
    facts: e.facts.map((f) => ({ claim: f.claim, source: f.source_url })),
    contradictions: e.contradictions,
  });
  return {
    examples_to_name: sheet.events.filter((e) => keptIds.includes(e.event_id)).map(pick),
    // Deliberately NOT named — covered by "and others" under the owner's
    // three-example cap, and not researched.
    examples_covered_by_and_others: extracted.events
      .filter((e) => !keptIds.includes(e.id))
      .map((e) => e.user_description),
    background: sheet.background && sheet.background.facts.length ? pick(sheet.background) : null,
  };
}

function writerUser(input: {
  raw: string; extracted: ExtractedEvents; sheet: FactSheet; currentDraft?: Record<string, unknown> | null;
  newContext?: string | null; feedback?: Issue[] | null;
}): string {
  const brief = {
    raw_proposal: input.raw,
    intent: input.extracted.intent,
    proposer_actor: input.extracted.proposer_actor,
    detected_language: input.extracted.detected_language,
    ...compactSheet(input.sheet, input.extracted),
    more_examples_named: input.extracted.more_count,
    available_sources: input.sheet.sources,
    ...(input.currentDraft ? { current_draft: input.currentDraft } : {}),
    ...(input.newContext ? { proposer_new_context: input.newContext } : {}),
    ...(input.feedback?.length ? { a_previous_draft_failed_review_fix_all_of_these: input.feedback } : {}),
  };
  return `Brief:\n${JSON.stringify(brief, null, 1)}\n\nWrite the question now.`;
}

function parsePreview(raw: Record<string, unknown> | null, sheet: FactSheet): PreviewV2 | null {
  if (!raw) return null;
  const question = str(raw.question);
  if (!question) return null;
  const lang = (str(raw.detected_language) ?? "en").toLowerCase().slice(0, 10);
  const native = (k: string) => (lang !== "en" ? str(raw[k]) : null);
  // supporting_links may only come from the fact sheet's own sources.
  const allowed = new Map(sheet.sources.map((u) => [normUrl(u), u]));
  let links = strArr(raw.supporting_links).map((u) => allowed.get(normUrl(u))).filter((u): u is string => !!u);
  if (links.length === 0) {
    links = sheet.events.concat(sheet.background ? [sheet.background] : [])
      .filter((e) => e.evidence_state === "VERIFIED" || e.evidence_state === "PARTIALLY_VERIFIED")
      .flatMap((e) => e.facts.map((f) => f.source_url));
  }
  links = [...new Set(links)].slice(0, 3);
  // No facts researched at all → no background. A background with nothing to
  // say turns into commentary on the proposer ("this is the proposer's own
  // observation and has not been independently verified" — 2 Oct 2026 test),
  // which is exactly the doubt the platform must never cast.
  const hasFacts = sheet.events.some((e) => e.facts.length > 0) || !!sheet.background?.facts.length;
  const cap = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  return {
    question,
    slider_low_label: cap(str(raw.slider_low_label)),
    slider_high_label: cap(str(raw.slider_high_label)),
    context_summary: hasFacts ? str(raw.context_summary) : null,
    supporting_links: links,
    quality_notes: str(raw.quality_notes) ?? "",
    cover_image_url: null,
    detected_language: lang,
    question_native: native("question_native"),
    slider_low_label_native: native("slider_low_label_native"),
    slider_high_label_native: native("slider_high_label_native"),
    context_summary_native: hasFacts ? native("context_summary_native") : null,
    audience_country: str(raw.audience_country)?.slice(0, 120) ?? null,
    verified: false,
  };
}

// ── 5. Validator ───────────────────────────────────────────────────────────
const ISSUE_TYPES = [
  "unsupported_claim", "contradicts_evidence", "states_disputed_as_fact", "missing_example",
  "extraction_missed_example", "missing_and_others", "doubt_cast_on_proposer", "stance_changed",
  "actor_changed", "not_neutral", "form", "slider_labels", "native_mismatch", "other",
];

const VALIDATOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["yes_answer_is", "pass", "issues"],
  properties: {
    // Slider polarity, asked as its own explicit question so it is actually
    // checked (2 Oct 2026 test: an either/or UPI question shipped with the
    // labels reversed and the general "slider_labels" item never caught it).
    yes_answer_is: { type: "string", enum: ["high_label", "low_label", "unclear"] },
    pass: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "detail", "fix"],
        properties: {
          type: { type: "string", enum: ISSUE_TYPES },
          detail: { type: "string" },
          fix: { type: "string" },
        },
      },
    },
  },
};

const VALIDATOR_SYSTEM =
  "You are the final check before a citizen's proposed stance question is shown to them. You cannot rewrite; " +
  "you report problems. Compare the CANDIDATE against the RAW PROPOSAL (the ultimate reference — the extraction " +
  "step can itself miss things), the extracted brief, and the FACT SHEET. Check:\n" +
  "1. Every factual statement in question/context_summary is in the fact sheet (unsupported_claim) and none " +
  "contradicts it (contradicts_evidence). A CONFLICTING point must not be stated as fact (states_disputed_as_fact).\n" +
  "2. Every example in examples_to_name is named (missing_example). Examples listed in " +
  "examples_covered_by_and_others are DELIBERATELY not named — the platform names at most three and covers the " +
  "rest with 'and others' — so never report them as missing and never ask for them to be added. Report " +
  "extraction_missed_example only for a specific example in the raw proposal that appears in NEITHER " +
  "examples_to_name NOR examples_covered_by_and_others. If examples_covered_by_and_others is non-empty the " +
  "question must say 'and others' (missing_and_others).\n" +
  "3. An UNVERIFIED example may be named as the proposer named it, but must carry no added facts and no doubt " +
  "(doubt_cast_on_proposer).\n" +
  "4. The question measures the proposer's own stance (stance_changed) about the actor they named " +
  "(actor_changed), and is not worded so one answer sounds obviously right (not_neutral). If a fact narrows or " +
  "contradicts the proposer's premise, the QUESTION must still ask what the proposer asked — the fact belongs in " +
  "context_summary only; a question rewritten around such a fact is stance_changed. The proposer's own slant or " +
  "rhetoric carried into the question ('not leave it only to X', 'obviously') is not_neutral.\n" +
  "5. Form: one question answerable on a single -2..+2 oppose/support scale, no menu of options, no either/or " +
  "('…, or should …?'), grammatical, put directly to the reader (form).\n" +
  "6. SLIDER DIRECTION — do this literally: read the question exactly as written and answer it 'yes'. Which " +
  "label describes that yes-answer? Put 'high_label', 'low_label' or 'unclear' (e.g. an either/or question) " +
  "in yes_answer_is. Anything other than high_label is a slider_labels issue.\n" +
  "7. If question_native is present it says the same thing as question, equally neutral, and Hindi is in " +
  "Devanagari script (native_mismatch).\n" +
  "Set pass=true only if there are no issues. Minor style preferences are NOT issues. For each issue give the " +
  "exact problem and the smallest fix.";

function codeChecks(p: PreviewV2, extracted: ExtractedEvents): Issue[] {
  const issues: Issue[] = [];
  const wc = wordCount(p.question);
  if (wc > 65) issues.push({ type: "form", detail: `Question is ${wc} words; the maximum is 65.`, fix: "Shorten connecting phrases; keep every named example." });
  if (!p.slider_low_label || !p.slider_high_label) issues.push({ type: "slider_labels", detail: "A slider label is missing.", fix: "Provide both slider labels." });
  if (extracted.more_count > 0 && !/and others/i.test(p.question)) {
    issues.push({ type: "missing_and_others", detail: "The proposer named more examples than are listed, but the question lacks 'and others'.", fix: "Add 'and others' after the named examples." });
  }
  // House style the writer drifts from and the model checker let through in
  // 4 of 9 test cases (2 Oct 2026) — enforced here instead.
  const banned = p.question.match(/\b(do you support|do you back|should the government)\b/i);
  if (banned) {
    issues.push({ type: "form", detail: `The question uses '${banned[0]}', which house style forbids.`, fix: "Ask about the thing itself, e.g. 'should X …, in your view?' or 'do you think X should …?'." });
  }
  // Either/or questions have no defined "yes" end, which is how a reversed
  // slider shipped in the 2 Oct 2026 UPI test case.
  if (/,\s*or\s+(should|do|does|did|is|are|was|were|will|would|can|could|has|have)\b/i.test(p.question) ||
      /\bor should\b/i.test(p.question)) {
    issues.push({ type: "form", detail: "The question is an either/or ('…, or should …?'), so the slider has no clear 'yes' end.", fix: "Ask one proposition the reader agrees or disagrees with; drop the 'or …' alternative." });
  }
  // Owner decision (Oct 2026): Hindi native renditions are always Devanagari,
  // including for Hinglish / Romanised Hindi input.
  if (p.detected_language === "hi" && p.question_native && !/[ऀ-ॿ]/.test(p.question_native)) {
    issues.push({ type: "native_mismatch", detail: "question_native is Hindi in Roman letters.", fix: "Write question_native and the native slider labels in Devanagari script." });
  }
  if (extracted.more_count === 0 && /and others/i.test(p.question)) {
    issues.push({ type: "form", detail: "The question says 'and others' but every example the proposer named is already named.", fix: "Remove 'and others'." });
  }
  // Belt and braces for the three-example cap: an example set aside for "and
  // others" must not reappear by name (2 Oct 2026 test: a repair re-added it).
  for (const e of extracted.events.filter((x) => !extracted.kept_event_ids.includes(x.id))) {
    // Longest entity unique to this example ("Pahalgam" over "India"), so a
    // country the question legitimately mentions does not trip the check.
    const key = e.entities
      .filter((n) => n.length >= 4 && !extracted.events.some((o) => o.id !== e.id && o.entities.includes(n)))
      .sort((a, b) => b.length - a.length)[0];
    if (key && p.question.toLowerCase().includes(key.toLowerCase())) {
      issues.push({ type: "form", detail: `'${e.user_description}' is meant to be covered by 'and others' (max three named examples) but is named.`, fix: `Remove the mention of ${key}; keep 'and others'.` });
    }
  }
  return issues;
}

async function validate(cfg: PipelineConfig, raw: string, extracted: ExtractedEvents, sheet: FactSheet, p: PreviewV2, metrics: StageMetric[], stage: string): Promise<{ pass: boolean; issues: Issue[]; ran: boolean }> {
  const fromCode = codeChecks(p, extracted);
  const r = await callClaude(cfg, {
    stage, model: cfg.strongModel, system: VALIDATOR_SYSTEM, effort: "low", schema: VALIDATOR_SCHEMA,
    maxTokens: 3000, timeoutMs: 40_000,
    user:
      `RAW PROPOSAL:\n"${raw}"\n\n` +
      `BRIEF:\n${JSON.stringify({ intent: extracted.intent, proposer_actor: extracted.proposer_actor, ...compactSheet(sheet, extracted) }, null, 1)}\n\n` +
      `CANDIDATE:\n${JSON.stringify({ question: p.question, slider_low_label: p.slider_low_label, slider_high_label: p.slider_high_label, context_summary: p.context_summary, question_native: p.question_native, slider_low_label_native: p.slider_low_label_native, slider_high_label_native: p.slider_high_label_native, context_summary_native: p.context_summary_native }, null, 1)}`,
  });
  metrics.push(r.metric);
  const parsed = r.ok ? extractJson(r.text) : null;
  if (!parsed || typeof parsed.pass !== "boolean") {
    // Validator unavailable: the code checks still apply, but the question
    // cannot be called fact-checked.
    return { pass: false, issues: fromCode, ran: false };
  }
  const modelIssues: Issue[] = (Array.isArray(parsed.issues) ? parsed.issues as Array<Record<string, unknown>> : [])
    .map((i) => ({ type: str(i.type) ?? "other", detail: str(i.detail) ?? "", fix: str(i.fix) ?? "" }))
    .filter((i) => i.detail);
  // Enforced in code from the validator's explicit yes-answer judgement, so a
  // reversed slider fails even if the validator forgot to list it as an issue.
  const yesIs = str(parsed.yes_answer_is);
  if (yesIs !== "high_label" && !modelIssues.some((i) => i.type === "slider_labels")) {
    modelIssues.push({
      type: "slider_labels",
      detail: yesIs === "low_label"
        ? "Answering 'yes' to the question as written matches slider_low_label — the labels are reversed."
        : "It is unclear which slider end a 'yes' answer belongs to (often an either/or question).",
      fix: "Make the question one proposition, and make slider_high_label what answering 'yes' means.",
    });
  }
  const issues = [...fromCode, ...modelIssues];
  return { pass: issues.length === 0 && parsed.pass === true, issues, ran: true };
}

const REPAIR_SYSTEM_SUFFIX =
  "TARGETED REPAIR: you are given a draft that failed review and the exact issues. Change ONLY what those " +
  "issues require and leave every other word as it is. If an issue is extraction_missed_example, name that " +
  "example as the proposer named it (no facts about it). Never name an example from " +
  "examples_covered_by_and_others. Return the full JSON object.";

// ── Orchestration ──────────────────────────────────────────────────────────
function emptyMetrics(mode: PipelineMetrics["mode"]): PipelineMetrics {
  return {
    version: "v2", mode, total_ms: 0, extraction_ms: 0, research_ms: 0, writer_ms: 0, validator_ms: 0, repair_ms: 0,
    search_count: 0, input_tokens: 0, output_tokens: 0, model_cost_usd: 0, search_cost_usd: 0, total_cost_usd: 0,
    events_detected: 0, events_kept: 0, events_verified: 0, sources_used: 0, rewrite_count: 0, stages: [],
  };
}

function finishMetrics(m: PipelineMetrics, stages: StageMetric[], t0: number, extracted: ExtractedEvents, sheet: FactSheet, rewrites: number) {
  m.stages = stages;
  m.total_ms = Date.now() - t0;
  m.search_count = stages.reduce((a, s) => a + s.searches, 0);
  m.input_tokens = stages.reduce((a, s) => a + s.input_tokens, 0);
  m.output_tokens = stages.reduce((a, s) => a + s.output_tokens, 0);
  m.search_cost_usd = +(m.search_count * SEARCH_COST_USD).toFixed(4);
  m.total_cost_usd = +stages.reduce((a, s) => a + s.cost_usd, 0).toFixed(4);
  m.model_cost_usd = +(m.total_cost_usd - m.search_cost_usd).toFixed(4);
  m.events_detected = extracted.events.length;
  m.events_kept = extracted.kept_event_ids.length;
  m.events_verified = sheet.events.filter((e) => e.evidence_state === "VERIFIED").length;
  m.sources_used = sheet.sources.length;
  m.rewrite_count = rewrites;
}

async function researchAll(cfg: PipelineConfig, raw: string, events: EventRef[], backgroundTopic: string | null, stages: StageMetric[]) {
  const today = new Date().toISOString().slice(0, 10);
  const notResearched = (e: EventRef, why: string): Promise<ResearchedEvent> => Promise.resolve({
    event_id: e.id, user_description: e.user_description, identity_status: "not_researched",
    candidate_event: null, event_date: null, identity_evidence: [why],
    evidence_state: "UNVERIFIED", facts: [], contradictions: [], publishers: [], model: "none", escalated: false,
  });
  // No named place, organisation or person = nothing to pin the identity to.
  // 2 Oct 2026 test: "the bridge collapse last month" was matched to an
  // obscure bridge in Maine and stated as fact; a search will always find
  // SOME match for a generic description, so it must not be searched.
  const unanchored = (e: EventRef) => e.entities.length === 0 && !e.location_hint;
  const jobs: Promise<ResearchedEvent>[] = events.map((e) =>
    e.kind === "pattern"
      ? notResearched(e, "A pattern of incidents, not one event — named as the proposer named it, not researched.")
      : unanchored(e)
      ? notResearched(e, "No named place, organisation or person to identify it by — named as the proposer named it, not researched.")
      : researchOne(cfg, e, null, raw, today, stages));
  const bgJob = backgroundTopic ? researchOne(cfg, null, { topic: backgroundTopic }, raw, today, stages) : Promise.resolve(null);
  const [researched, background] = await Promise.all([Promise.all(jobs), bgJob]);
  return { researched, background };
}

function buildSheet(events: ResearchedEvent[], background: ResearchedEvent | null): FactSheet {
  const sources = [...new Set(
    [...events, ...(background ? [background] : [])].flatMap((e) => e.facts.map((f) => f.source_url)),
  )];
  return { version: 1, researched_at: new Date().toISOString(), events, background, sources };
}

async function writeValidateRepair(cfg: PipelineConfig, args: {
  raw: string; extracted: ExtractedEvents; sheet: FactSheet; stages: StageMetric[]; metrics: PipelineMetrics;
  currentDraft?: Record<string, unknown> | null; newContext?: string | null;
}): Promise<{ preview: PreviewV2; verification: VerificationResult } | null> {
  const { raw, extracted, sheet, stages, metrics } = args;
  const refine = !!args.newContext;
  const sys = writerSystem(cfg, extracted.more_count, refine);
  const attempts: VerificationResult["attempts"] = [];
  let rewrites = 0;

  const timed = async <T>(bucket: "writer_ms" | "validator_ms" | "repair_ms", fn: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    try {
      return await fn();
    } finally {
      metrics[bucket] += Date.now() - t;
    }
  };

  const write = async (stage: string, system: string, feedback: Issue[] | null, draft: Record<string, unknown> | null, effort: "low" | "medium") => {
    const r = await callClaude(cfg, {
      stage, model: cfg.strongModel, system, effort, schema: PREVIEW_SCHEMA, maxTokens: 6000, timeoutMs: 50_000,
      user: writerUser({ raw, extracted, sheet, currentDraft: draft ?? args.currentDraft ?? null, newContext: args.newContext ?? null, feedback }),
    });
    stages.push(r.metric);
    return r.ok ? parsePreview(extractJson(r.text), sheet) : null;
  };

  let cand = await timed("writer_ms", () => write("writer", sys, null, null, "medium"));
  if (!cand) return null;
  let v = await timed("validator_ms", () => validate(cfg, raw, extracted, sheet, cand!, stages, "validator"));
  attempts.push({ stage: "initial", pass: v.pass, issues: v.issues });

  if (!v.pass && v.ran) {
    rewrites++;
    const draftObj = { ...cand } as Record<string, unknown>;
    const repaired = await timed("repair_ms", () => write("repair", sys + REPAIR_SYSTEM_SUFFIX, v.issues, draftObj, "low"));
    if (repaired) {
      const v2 = await timed("validator_ms", () => validate(cfg, raw, extracted, sheet, repaired, stages, "validator_after_repair"));
      attempts.push({ stage: "repair", pass: v2.pass, issues: v2.issues });
      if (v2.pass || !v2.ran) {
        cand = repaired;
        v = v2;
      } else {
        // Still failing after a targeted repair: one full rewrite with every
        // issue seen so far as feedback, then stop.
        rewrites++;
        const allIssues = [...v.issues, ...v2.issues];
        const rewritten = await timed("repair_ms", () => write("rewrite", sys, allIssues, null, "medium"));
        if (rewritten) {
          const v3 = await timed("validator_ms", () => validate(cfg, raw, extracted, sheet, rewritten, stages, "validator_after_rewrite"));
          attempts.push({ stage: "rewrite", pass: v3.pass, issues: v3.issues });
          cand = rewritten;
          v = v3;
        } else {
          cand = repaired;
          v = v2;
        }
      }
    }
  }

  const verified = v.pass && v.ran;
  return {
    preview: { ...cand, verified },
    verification: { pass: verified, attempts, rewrite_count: rewrites },
  };
}

export async function runPipelineV2(cfg: PipelineConfig, raw: string): Promise<PipelineResult | null> {
  const t0 = Date.now();
  const stages: StageMetric[] = [];
  const metrics = emptyMetrics("fresh");

  const tx = Date.now();
  const ex = await callClaude(cfg, {
    stage: "extraction", model: cfg.fastModel, system: extractionSystem(null), schema: EXTRACTION_SCHEMA,
    user: `Raw proposal:\n"${raw}"`, maxTokens: 1500, timeoutMs: 25_000,
  });
  stages.push(ex.metric);
  metrics.extraction_ms = Date.now() - tx;
  const base = ex.ok ? parseExtraction(extractJson(ex.text), "e", "proposal") : null;
  if (!base) {
    console.error(JSON.stringify({ tag: "ugq-screen.v2.extraction_failed" }));
    return null;
  }
  const { kept, more } = chooseKept(base.events, cfg.maxExamples);
  const extracted: ExtractedEvents = { ...base, kept_event_ids: kept, more_count: more };

  const tr = Date.now();
  const keptEvents = base.events.filter((e) => kept.includes(e.id));
  // Background search only when there is no specific event to research.
  const { researched, background } = await researchAll(cfg, raw, keptEvents, keptEvents.length === 0 ? (base.general_topic || null) : null, stages);
  metrics.research_ms = Date.now() - tr;
  const sheet = buildSheet(researched, background);

  const out = await writeValidateRepair(cfg, { raw, extracted, sheet, stages, metrics });
  if (!out) {
    console.error(JSON.stringify({ tag: "ugq-screen.v2.writer_failed" }));
    return null;
  }
  finishMetrics(metrics, stages, t0, extracted, sheet, out.verification.rewrite_count);
  return { preview: out.preview, extracted_events: extracted, fact_sheet: sheet, verification_result: out.verification, pipeline_metrics: metrics };
}

// Regenerate ("Add more context and regenerate"): reuses the stored fact sheet
// and researches ONLY events that are new in the added context.
export async function runRefineV2(cfg: PipelineConfig, args: {
  raw: string; additionalContext: string; currentDraft: Record<string, unknown>;
  extracted: ExtractedEvents; factSheet: FactSheet;
}): Promise<PipelineResult | null> {
  const t0 = Date.now();
  const stages: StageMetric[] = [];
  const metrics = emptyMetrics("refine");

  const tx = Date.now();
  const ex = await callClaude(cfg, {
    stage: "extraction", model: cfg.fastModel,
    system: extractionSystem(args.extracted.events.map((e) => e.user_description)), schema: EXTRACTION_SCHEMA,
    user: `Additional context the proposer just added to their proposal:\n"${args.additionalContext}"\n\nTheir original proposal (for reference):\n"${args.raw.slice(0, 1500)}"`,
    maxTokens: 1500, timeoutMs: 25_000,
  });
  stages.push(ex.metric);
  metrics.extraction_ms = Date.now() - tx;
  const added = ex.ok ? parseExtraction(extractJson(ex.text), `a${Date.now() % 100000}_`, "added_context") : null;
  // The prompt already lists the known events, but the model can still repeat
  // one (2 Oct 2026 test: context about Pune shopkeepers' UPI payments came
  // back as a "new" UPI MDR event and was researched a second time). Drop
  // any added event that shares a named entity with an existing one.
  const known = args.extracted.events.flatMap((e) => [...e.entities, e.user_description]).map((s) => s.toLowerCase());
  const newEvents = (added?.events ?? []).filter((e) => {
    const dup = e.entities.some((n) => n.length >= 3 && known.some((k) => k.includes(n.toLowerCase())));
    if (dup) console.log(JSON.stringify({ tag: "ugq-screen.v2.refine_dropped_duplicate_event", description: e.user_description }));
    return !dup;
  });

  const allEvents = [...args.extracted.events, ...newEvents];
  // Newly added examples are the proposer's latest emphasis — keep them first.
  const { kept, more } = chooseKept(allEvents, cfg.maxExamples, newEvents.map((e) => e.id));
  const extracted: ExtractedEvents = { ...args.extracted, events: allEvents, kept_event_ids: kept, more_count: more };

  const tr = Date.now();
  const alreadyResearched = new Set(args.factSheet.events.map((e) => e.event_id));
  const toResearch = allEvents.filter((e) => kept.includes(e.id) && !alreadyResearched.has(e.id));
  const { researched } = await researchAll(cfg, args.raw, toResearch, null, stages);
  metrics.research_ms = Date.now() - tr;
  const sheet = buildSheet([...args.factSheet.events, ...researched], args.factSheet.background);

  const out = await writeValidateRepair(cfg, {
    raw: `${args.raw}\n\n---\nAdditional context from proposer: ${args.additionalContext}`,
    extracted, sheet, stages, metrics, currentDraft: args.currentDraft, newContext: args.additionalContext,
  });
  if (!out) return null;
  finishMetrics(metrics, stages, t0, extracted, sheet, out.verification.rewrite_count);
  return { preview: out.preview, extracted_events: extracted, fact_sheet: sheet, verification_result: out.verification, pipeline_metrics: metrics };
}
