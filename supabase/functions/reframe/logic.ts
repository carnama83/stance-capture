// supabase/functions/reframe/logic.ts
// Epic QF — Question Framing Intelligence
//
// v2 — Multi-provider LLM support
//
// Controls via Supabase Edge Function Secrets:
//
//   REFRAME_MODEL_PROVIDER   "openai" (default) | "anthropic"
//   REFRAME_MODEL_NAME       OpenAI:    "gpt-4o-mini" (default) | "gpt-4o"
//                            Anthropic: "claude-sonnet-4-20250514" (default) | "claude-opus-4-20250514"
//
// Examples:
//   Provider=openai,   Model=gpt-4o-mini          → original behaviour, cheapest
//   Provider=openai,   Model=gpt-4o               → stronger OpenAI model
//   Provider=anthropic, Model=claude-sonnet-4-20250514 → Claude Sonnet (recommended for quality)
//   Provider=anthropic, Model=claude-opus-4-20250514   → Claude Opus (highest quality, slowest)
//
// All other logic (prompts, quality gate, word cap, DB writes) is identical
// regardless of provider.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";
import OpenAI from "https://esm.sh/openai@4.57.0";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.3";
const VALID_FRAMING_STYLES = new Set([
  "value_tradeoff",
  "risk_vs_risk",
  "boundary_line",
  "trust_authority",
  "future_consequence",
  "moral_consistency",
  "personal_stake",
  "evidence_threshold"
]);
const QUALITY_THRESHOLD = 8;
const MAX_WORDS = 65;
const HARDCODED_REFRAME_PROMPT = `You are a civic question framing specialist. Your job is to take a raw draft question and rewrite it so it reads like a genuine reflection prompt — the kind a smart friend would ask over coffee, not a policy exam or a briefing document.

CORE RULE:
Do not ask users to choose an action. Ask them to reveal the principle behind the action.

REQUIRED STRUCTURE — every question must have all three parts:
1. Context: ONE short concrete sentence — a specific number, name, or recent event. Not a general policy description. Must be specific enough that the user immediately knows what real situation this is about.
2. Tension: ONE sentence showing the mechanism — not just "risks X" but WHY action A leads to outcome B. If both options are obviously necessary, find the underlying failure, root cause, or accountability gap instead.
3. Stance trigger: ONE question ending with "you" — never "governments", "institutions", or "countries". Must resolve into a single spectrum. Always ask about accountability first: why did this happen, what could have prevented it, who was responsible, did they do their job.

LENGTH: Target 30–45 words. 65 words is the hard ceiling, not the goal. Every word must earn its place.

PROHIBITED:
- Do not end with "Should [actor] do A, B, or C?"
- Do not list policy options as a menu
- Do not use parenthetical risk disclaimers after options, e.g. "(risking escalation)"
- Do not use "Do you support", "Are you for/against", "Should the government", "Should we"
- Do not use "face a genuine bind", "faces a genuine bind", or "The tension is real" — these are canned phrases
- Do not use "How much should [actor/country/institution]..." — always close with "you"
- Do not use "Which approach do you trust most" or "What principle guides you" — too abstract
- Do not tell the user what the correct moral answer is
- Do not ask two questions at once
- Do not exceed 65 words total
- Do not start sentence 2 with "This raises", "This situation creates", "This presents", or "This creates"
- Do not call out a person's nationality or ethnicity unless it is directly relevant to the tension
- Do not use academic vocabulary — avoid "destabilization", "prosecution frameworks", "institutional disruption", "implementation errors", "unintended consequences" — say what you mean in plain words
- CRITICAL — SLIDER COMPATIBILITY: Do not ask the user to choose between named options or rank competing values. The stance trigger must always resolve into a single spectrum. Every question must be answerable with "I strongly oppose this direction" through "I strongly support this direction."
- CRITICAL — TOPIC QUALITY GATE: If the topic title provided is a generic category label (e.g. "Infrastructure Investment Policy", "Foreign Investment Policy") rather than a specific news event, set quality_score to 0 and quality_notes to "topic_too_generic — needs specific news headline before reframing". Do not attempt to reframe.

GROUNDING RULES:
- Always anchor to WHERE the event happened, not where the person involved came from
- A single human story is more powerful than a statistic alone — lead with the person, follow with the scale
- Check the actual state of play: if a decision has already been made, a law passed, or a court has ruled — start from that reality, not from an open question
- When a court or independent body has had to intervene, the real question is about political failure — why did it take this long
- When an incident is part of a repeated pattern, zoom out to the pattern — that is where the real stance lives
- Name the specific accountable person (provided in context) — never leave it as "senior officials" or "politicians"
- When something basic has been ignored by elected officials, frame it as a failure of duty

FRAMING STYLES — choose one that best fits the topic:
- value_tradeoff: Surface the competing values and ask what the user prioritises
- risk_vs_risk: Ask which of two genuine risks worries them more
- boundary_line: Ask where their personal limit sits on a spectrum
- trust_authority: Ask who they trust to make the call
- future_consequence: Ask which long-term outcome matters most
- moral_consistency: Ask what principle should carry the most weight
- personal_stake: Ask if their view changes when it affects them directly
- evidence_threshold: Ask what evidence would most shift their thinking

POLICY-TO-VALUE CONVERSION:
Ban it → Safety / consistency / moral boundary
Leave it to states → Local control / federalism / democratic choice
Increase military presence → Security / deterrence / stability
Impose sanctions → Accountability / economic leverage
Stay silent → Political caution / restraint
Condemn publicly → Moral clarity / social responsibility
Regulate → Oversight / public protection
Deregulate → Freedom / market efficiency

REGISTER:
Write as if explaining to a smart friend, not drafting a policy brief. Translate economic or technical concepts into what they mean for an ordinary person's daily life — jobs, prices, household budgets, safety. Replace vague phrases with what actually happened. If a simpler word exists, use it.

VARIETY REQUIREMENT:
Each question must feel distinctly written — not templated. Avoid repeating sentence structures across questions. The stance trigger must be phrased freshly each time.

OUTPUT — return ONLY valid JSON, no markdown, no backticks:
{
  "question": "Reframed question (target 30–45 words, max 65)",
  "framing_style": "one of the 8 styles above",
  "core_tension": "one sentence describing the competing values",
  "primary_value": "e.g. national_security",
  "secondary_value": "e.g. global_safety",
  "slider_low_label": "3-6 word noun phrase for the oppose end of the slider — e.g. 'Protect individuals from exploitation'. Never 'Strongly oppose'.",
  "slider_high_label": "3-6 word noun phrase for the support end of the slider — e.g. 'Accept security trade-offs'. Never 'Strongly support'.",
  "quality_score": <number 0-10>,
  "quality_notes": "brief reason for score"
}

QUALITY SCORING (0–10):
- Concrete, specific context (a real event, name, or number — not a category): 2 points
- Neutral plain language (no academic vocabulary, no loaded terms): 2 points
- Clear tension with visible mechanism (shows WHY, not just THAT): 2 points
- Slider-compatible stance trigger ending with "you" (single spectrum, not a menu): 2 points
- Concise — at or under 45 words scores full point, 46–65 words scores half: 1 point
- Variety — fresh phrasing, not templated: 1 point

HARD REQUIREMENT: A question scoring 0 on slider compatibility must be flagged as reframe_failed regardless of total score. A question on a generic topic (quality_score = 0) must also be flagged.

Minimum acceptable score: 8. Flag anything below 8 in quality_notes.`;
const FORBIDDEN_PHRASES = [
  // Basic policy-exam framings
  "do you support",
  "are you for",
  "are you against",
  "should the government",
  "should we",
  // Canned academic phrases (see PROHIBITED rules)
  "face a genuine bind",
  "faces a genuine bind",
  "the tension is real",
  "how much should",
  "which approach do you trust",
  "what principle guides",
  // Slider-incompatible menu framings
  "what matters more to you",
  "which matters most",
  "what matters most to you",
  "do you prioritise",
  "do you prioritize",
  "a, b, or c",
  "x or y"
];
function checkForbidden(question) {
  const lower = question.toLowerCase();
  return FORBIDDEN_PHRASES.find((p)=>lower.includes(p)) ?? null;
}
function countWords(text) {
  return text.trim().split(/\s+/).length;
}
function parseReframeResult(raw) {
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    if (!parsed.question || typeof parsed.question !== "string") return null;
    return {
      question: parsed.question.trim(),
      framing_style: parsed.framing_style?.trim() ?? "value_tradeoff",
      core_tension: parsed.core_tension?.trim() ?? "",
      primary_value: parsed.primary_value?.trim() ?? "",
      secondary_value: parsed.secondary_value?.trim() ?? "",
      slider_low_label: parsed.slider_low_label?.trim() ?? null,
      slider_high_label: parsed.slider_high_label?.trim() ?? null,
      quality_score: typeof parsed.quality_score === "number" ? Math.max(0, Math.min(10, parsed.quality_score)) : 0,
      quality_notes: parsed.quality_notes?.trim() ?? ""
    };
  } catch  {
    return null;
  }
}
// ── Provider abstraction ──────────────────────────────────────────────────────
// Returns the raw LLM text response regardless of which provider is used.
// All provider-specific client logic is isolated here.
async function callLLM(provider, modelName, systemPrompt, userPrompt, apiKey) {
  if (provider === "anthropic") {
    const client = new Anthropic({
      apiKey
    });
    const message = await client.messages.create({
      model: modelName,
      max_tokens: 1024,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt
        }
      ]
    });
    // Guard against empty content array — happens when the model name is invalid
    // or the API rejects the request without a proper error (e.g. "claude-sonnet-4-5"
    // instead of "claude-sonnet-4-5-20251001"). Surface a clear error rather than
    // crashing on undefined with a misleading "Cannot read properties" message.
    if (!message.content || message.content.length === 0) {
      throw new Error(`Anthropic returned empty content array. ` + `Check model name is valid: "${modelName}". ` + `Stop reason: ${message.stop_reason ?? "unknown"}`);
    }
    const block = message.content[0];
    if (block.type !== "text") {
      throw new Error(`Anthropic returned non-text content block: type="${block.type}"`);
    }
    return block.text.trim();
  }
  // Default: OpenAI
  const client = new OpenAI({
    apiKey
  });
  const completion = await client.chat.completions.create({
    model: modelName,
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: userPrompt
      }
    ]
  });
  return completion.choices[0]?.message?.content?.trim() ?? "";
}
export async function run(ctx) {
  const { log, shouldStop } = ctx;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
  const BATCH = Number(Deno.env.get("REFRAME_BATCH") ?? 5);
  // ── Provider selection via secrets ──────────────────────────────────────────
  const rawProvider = (Deno.env.get("REFRAME_MODEL_PROVIDER") ?? "openai").toLowerCase().trim();
  const provider = rawProvider === "anthropic" ? "anthropic" : "openai";
  const defaultModel = provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o-mini";
  const modelName = (Deno.env.get("REFRAME_MODEL_NAME") ?? defaultModel).trim();
  // Resolve API key for selected provider
  const apiKey = provider === "anthropic" ? ANTHROPIC_KEY : OPENAI_API_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    log("error", "missing_env", {
      hasSupabaseUrl: !!SUPABASE_URL,
      hasServiceRole: !!SERVICE_ROLE
    });
    return {
      reframed: 0,
      failed: 1,
      skipped: 0,
      errors: [
        "Missing SUPABASE_URL or SERVICE_ROLE key"
      ]
    };
  }
  if (!apiKey) {
    const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    log("error", "missing_api_key", {
      provider,
      keyName
    });
    return {
      reframed: 0,
      failed: 1,
      skipped: 0,
      errors: [
        `Missing ${keyName} for provider '${provider}'`
      ]
    };
  }
  log("info", "provider_config", {
    provider,
    modelName
  });
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: {
      persistSession: false
    }
  });
  const errors = [];
  // ── Load active reframe prompt from ai_prompts ────────────────────────────
  let activeSystemPrompt = HARDCODED_REFRAME_PROMPT;
  let activePromptId = null;
  try {
    const { data: promptRow, error: promptErr } = await supabaseAdmin.from("ai_prompts").select("id, system_prompt").eq("prompt_key", "question_reframing").eq("is_active", true).maybeSingle();
    if (promptErr) {
      log("warn", "ai_prompts.read_failed_using_hardcoded", {
        error: promptErr.message
      });
    } else if (promptRow) {
      activeSystemPrompt = promptRow.system_prompt ?? HARDCODED_REFRAME_PROMPT;
      activePromptId = promptRow.id ?? null;
      log("info", "ai_prompts.loaded", {
        prompt_id: activePromptId
      });
    } else {
      log("info", "ai_prompts.no_active_prompt_using_hardcoded", {});
    }
  } catch (e) {
    log("warn", "ai_prompts.exception_using_hardcoded", {
      error: e?.message
    });
  }
  // ── Fetch unprocessed drafts (with topic title and news headline for grounding) ──
  const { data: draftsData, error: fetchError } = await supabaseAdmin
    .from("question_drafts")
    .select(`
      id, question, summary, tags, location_label, topic_draft_id,
      topic_drafts!inner (
        title,
        news_items!inner ( title )
      )
    `)
    .eq("status", "draft")
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (fetchError) {
    log("error", "fetch_drafts_failed", {
      error: fetchError.message
    });
    errors.push(`fetch_drafts_failed: ${fetchError.message}`);
    return {
      reframed: 0,
      failed: 1,
      skipped: 0,
      errors
    };
  }
  const drafts = draftsData ?? [];
  if (!drafts.length) {
    log("info", "no_drafts_to_reframe", {});
    return {
      reframed: 0,
      failed: 0,
      skipped: 0
    };
  }
  log("info", "reframe_candidates", {
    count: drafts.length,
    ids: drafts.map((d)=>d.id),
    prompt_source: activePromptId ? `ai_prompts:${activePromptId}` : "hardcoded",
    provider,
    model: modelName
  });
  let reframed = 0;
  let failed = 0;
  let skipped = 0;
  await Promise.all(drafts.map((draft)=>ctx.limit(async ()=>{
      if (shouldStop()) {
        skipped++;
        return;
      }
      await supabaseAdmin.from("question_drafts").update({
        status: "reframing"
      }).eq("id", draft.id);
      // Extract topic title and news headline from joined data
      const topicTitle: string = (draft as any).topic_drafts?.title ?? "(none)";
      const newsHeadline: string = (draft as any).topic_drafts?.news_items?.title ?? "(none)";

      const userPrompt =
        `Raw question to reframe:\n"${draft.question}"\n\n` +
        `Topic context:\n` +
        `Topic title: ${topicTitle}\n` +
        `News headline (the specific article that triggered this question): ${newsHeadline}\n` +
        `Summary: ${draft.summary ?? "(none)"}\n` +
        `Location: ${draft.location_label ?? "(none)"}\n\n` +
        `Instructions:\n` +
        `1. Use the news headline as your primary anchor — the question must be rooted in this specific event.\n` +
        `2. If the topic title is a generic category label (not a specific event), set quality_score = 0 and flag as topic_too_generic.\n` +
        `3. Check the state of play: has a decision already been made? Has someone already acted? Start from that reality.\n` +
        `4. Name any specific accountable person (head of government, minister, official) responsible for the location — use your knowledge to identify them.\n` +
        `5. Rewrite using the Context + Tension + Stance Trigger structure. Target 30–45 words.\n` +
        `6. Choose the most appropriate framing style from the 8 options.\n` +
        `Return only valid JSON — no markdown, no backticks.`;
      let rawText = "";
      let result = null;
      try {
        rawText = await callLLM(provider, modelName, activeSystemPrompt, userPrompt, apiKey);
        result = parseReframeResult(rawText);
      } catch (err) {
        const msg = err?.message ?? String(err);
        log("error", "reframe.llm_failed", {
          draft_id: draft.id,
          error: msg,
          provider,
          model: modelName
        });
        errors.push(`llm_failed(${draft.id}): ${msg}`);
        // Reset to draft for retry — do not mark reframe_failed on transient LLM errors
        await supabaseAdmin.from("question_drafts").update({
          status: "draft"
        }).eq("id", draft.id);
        failed++;
        return;
      }
      if (!result) {
        log("warn", "reframe.parse_failed", {
          draft_id: draft.id,
          preview: rawText.slice(0, 200)
        });
        errors.push(`parse_failed(${draft.id})`);
        await supabaseAdmin.from("question_drafts").update({
          status: "reframe_failed",
          quality_notes: "Failed to parse LLM response as valid JSON",
          reframe_ai_output: {
            rawText,
            provider,
            model: modelName
          }
        }).eq("id", draft.id);
        failed++;
        return;
      }
      const forbiddenMatch = checkForbidden(result.question);
      if (forbiddenMatch) {
        log("warn", "reframe.forbidden_phrase", {
          draft_id: draft.id,
          phrase: forbiddenMatch
        });
        errors.push(`forbidden_phrase(${draft.id}): "${forbiddenMatch}"`);
        await supabaseAdmin.from("question_drafts").update({
          status: "reframe_failed",
          quality_notes: `Forbidden phrase detected: "${forbiddenMatch}"`,
          reframe_ai_output: {
            rawText,
            result,
            provider,
            model: modelName
          }
        }).eq("id", draft.id);
        failed++;
        return;
      }
      const wordCount = countWords(result.question);
      if (wordCount > MAX_WORDS) {
        log("warn", "reframe.too_long", {
          draft_id: draft.id,
          wordCount
        });
        errors.push(`too_long(${draft.id}): ${wordCount} words`);
        await supabaseAdmin.from("question_drafts").update({
          status: "reframe_failed",
          quality_notes: `Question too long: ${wordCount} words (max ${MAX_WORDS})`,
          reframe_ai_output: {
            rawText,
            result,
            provider,
            model: modelName
          }
        }).eq("id", draft.id);
        failed++;
        return;
      }
      if (result.quality_score < QUALITY_THRESHOLD) {
        log("warn", "reframe.low_quality", {
          draft_id: draft.id,
          score: result.quality_score
        });
        errors.push(`low_quality(${draft.id}): score=${result.quality_score}`);
        await supabaseAdmin.from("question_drafts").update({
          status: "reframe_failed",
          framing_style: VALID_FRAMING_STYLES.has(result.framing_style) ? result.framing_style : null,
          core_tension: result.core_tension,
          primary_value: result.primary_value,
          secondary_value: result.secondary_value,
          question_quality_score: result.quality_score,
          quality_notes: result.quality_notes,
          reframe_ai_output: {
            rawText,
            result,
            provider,
            model: modelName
          },
          reframe_prompt_id: activePromptId
        }).eq("id", draft.id);
        failed++;
        return;
      }
      const framingStyle = VALID_FRAMING_STYLES.has(result.framing_style) ? result.framing_style : "value_tradeoff";
      if (!VALID_FRAMING_STYLES.has(result.framing_style)) {
        log("warn", "reframe.unknown_framing_style", {
          draft_id: draft.id,
          received: result.framing_style,
          fallback: "value_tradeoff"
        });
      }
      const { error: updateError } = await supabaseAdmin.from("question_drafts").update({
        question: result.question,
        raw_question: draft.question,
        status: "reframed",
        framing_style: framingStyle,
        core_tension: result.core_tension,
        primary_value: result.primary_value,
        secondary_value: result.secondary_value,
        slider_low_label: result.slider_low_label,
        slider_high_label: result.slider_high_label,
        question_quality_score: result.quality_score,
        quality_notes: result.quality_notes,
        reframe_ai_output: {
          rawText,
          result,
          provider,
          model: modelName
        },
        reframe_prompt_id: activePromptId,
        reframed_at: new Date().toISOString()
      }).eq("id", draft.id);
      if (updateError) {
        log("error", "reframe.update_failed", {
          draft_id: draft.id,
          error: updateError.message
        });
        errors.push(`update_failed(${draft.id}): ${updateError.message}`);
        await supabaseAdmin.from("question_drafts").update({
          status: "draft"
        }).eq("id", draft.id);
        failed++;
        return;
      }
      reframed++;
      log("info", "reframe.success", {
        draft_id: draft.id,
        framing_style: framingStyle,
        quality_score: result.quality_score,
        word_count: wordCount,
        provider,
        model: modelName
      });
    })));
  return {
    reframed,
    failed,
    skipped,
    errors: errors.length ? errors : undefined
  };
}
