//Obsolete--
// supabase/functions/generate/logic.ts
// ULTRA-STRICT VERSION: Absolutely NO "Do you support" questions
// ✨ v2: Audience location classifier integrated (Phase 4A of homepage feed fix plan)
// ✨ v3: Epic J2 — reads active system prompt from ai_prompts table at runtime.
//        Falls back to hardcoded prompt if table missing, empty, or read fails.
//        All other logic (audience classifier, parent classification,
//        forbidden phrase check, scope, location trimming) is UNCHANGED.
// ✨ v4: Improved question framing — templates now surface tension and values
//        rather than listing policy options with "Should...?" suffix.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";
import OpenAI from "https://esm.sh/openai@4.57.0";
function inferAudienceLocation(questionText, summary, tags, originLabel) {
  const lower = [
    questionText,
    summary ?? "",
    (tags ?? []).join(" ")
  ].join(" ").toLowerCase();
  const globalEntities = /(iran|israel|nato|united nations|worldwide|international|global|russia|china|ukraine|hamas|hezbollah|war between|conflict between|multinational)/;
  const usPresence = /(\bu\.?s\.?\b|united states|america|military|strike|sanction)/;
  if (globalEntities.test(lower) && usPresence.test(lower)) {
    return {
      audience_label: "Global",
      reason: "International conflict or multinational issue; global relevance."
    };
  }
  const federalKeywords = /(white house|congress|senate|supreme court|pentagon|federal government|president trump|president biden|immigration policy|federal law|national security|us military|department of\b|cabinet|executive order|sanctions|foreign policy)/;
  if (federalKeywords.test(lower)) {
    return {
      audience_label: "United States",
      reason: "Federal policy decision; national relevance."
    };
  }
  return {
    audience_label: originLabel ?? "Global",
    reason: "Local/regional issue; audience matches origin."
  };
}
const PARENT_CLASSIFICATION_SYSTEM_PROMPT = `You are a news topic classifier. Your job is to assign a micro-topic
(a specific news story) to the most appropriate broad parent category from a fixed list.

Rules:
1. Only assign a parent if you are genuinely confident (confidence >= 0.75).
2. If no parent fits well, return null for parent_topic_id.
3. Never invent a parent that is not in the list.
4. Return ONLY valid JSON — no markdown, no explanation outside the JSON object.

Response format (JSON only):
{
  "parent_topic_id": "<uuid from the list, or null>",
  "confidence": <number 0.0 to 1.0>,
  "reason": "<one sentence explaining the match or why no match>"
}`;
const PARENT_CONFIDENCE_THRESHOLD = 0.75;
function buildParentClassificationPrompt(draft, parents) {
  if (parents.length === 0) return JSON.stringify({
    note: "No parent topics available yet."
  });
  const parentList = parents.map((p)=>{
    const tags = p.tags && p.tags.length > 0 ? p.tags.join(", ") : "no tags";
    const loc = p.location_label ? ` | location: ${p.location_label}` : "";
    return `  - id: "${p.id}" | title: "${p.title}" | tags: ${tags}${loc}`;
  }).join("\n");
  const draftTags = draft.tags && draft.tags.length > 0 ? draft.tags.join(", ") : "no tags";
  return `Available parent categories:\n${parentList}\n\nNew micro-topic to classify:\n  Title: "${draft.title ?? ""}"\n  Tags: ${draftTags}\n  Location: ${draft.location_label ?? "Global"}\n\nWhich parent category best fits this micro-topic?`;
}
function parseClassificationResult(raw) {
  try {
    const parsed = JSON.parse(raw);
    return {
      parent_topic_id: parsed.parent_topic_id ?? null,
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
      reason: parsed.reason ?? ""
    };
  } catch  {
    return {
      parent_topic_id: null,
      confidence: 0,
      reason: "Failed to parse LLM response"
    };
  }
}
async function classifyTopicDraftParent(draft, openai, supabaseAdmin, log) {
  const { data: parentsData, error: parentsError } = await supabaseAdmin.rpc("get_parent_topics_for_classification");
  if (parentsError) {
    log("warn", "classify_parent.fetch_failed", {
      topic_draft_id: draft.id,
      error: parentsError.message
    });
    return {
      parent_topic_id: null,
      confidence: 0,
      reason: "Could not fetch parent topics"
    };
  }
  const parents = parentsData ?? [];
  if (parents.length === 0) {
    log("info", "classify_parent.no_parents_defined", {
      topic_draft_id: draft.id
    });
    return {
      parent_topic_id: null,
      confidence: 0,
      reason: "No parent topics defined yet"
    };
  }
  log("info", "classify_parent.start", {
    topic_draft_id: draft.id,
    draft_title: draft.title,
    parent_count: parents.length
  });
  let result;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 150,
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content: PARENT_CLASSIFICATION_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: buildParentClassificationPrompt(draft, parents)
        }
      ]
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
    result = parseClassificationResult(raw);
  } catch (err) {
    log("error", "classify_parent.llm_failed", {
      topic_draft_id: draft.id,
      error: err?.message ?? String(err)
    });
    return {
      parent_topic_id: null,
      confidence: 0,
      reason: "LLM call failed"
    };
  }
  const accepted = result.confidence >= PARENT_CONFIDENCE_THRESHOLD && !!result.parent_topic_id;
  log("info", "classify_parent.result", {
    topic_draft_id: draft.id,
    parent_topic_id: result.parent_topic_id,
    confidence: result.confidence,
    reason: result.reason,
    accepted
  });
  if (!accepted) result.parent_topic_id = null;
  const updatePayload = {
    parent_topic_confidence: result.confidence,
    parent_topic_reason: result.reason
  };
  if (result.parent_topic_id) updatePayload.parent_topic_id = result.parent_topic_id;
  const { error: updateError } = await supabaseAdmin.from("topic_drafts").update(updatePayload).eq("id", draft.id);
  if (updateError) log("warn", "classify_parent.save_failed", {
    topic_draft_id: draft.id,
    error: updateError.message
  });
  return result;
}
// ─── Epic J2: Hardcoded fallback prompt ──────────────────────────────────────
// Active only when ai_prompts has no active question_generation prompt.
// Override via /admin/prompts — no redeployment needed.
const HARDCODED_SYSTEM_PROMPT = `You are generating stance questions for a civic platform.

⛔ ABSOLUTE PROHIBITIONS - YOU WILL BE PENALIZED FOR VIOLATING THESE:
1. NEVER use "Do you support"
2. NEVER use "Are you for or against"
3. NEVER use "Should the government"
4. NEVER ask yes/no questions
5. NEVER use "support", "favor", "oppose" in the question
6. NEVER end a question with "Should [actor] do X, Y, or Z?" — this is a policy vote, not a stance
7. NEVER list options inside the question as a menu — the question should surface a tension, not present a ballot

✅ REQUIRED QUESTION STRUCTURE - YOU MUST USE ONE OF THESE 7 TEMPLATES:

Each template ends with a tension-surfacing close — NOT a policy menu.
The close should make the reader feel the weight of the dilemma, not pick from a list.

---

TEMPLATE 1: Forced Trade-off
"[Concrete problem with statistic]. [Frame the two competing values or outcomes]. What would you prioritize — [Value A] or [Value B]?"

Examples:
- "Rent has increased 40% since 2019 in major cities, and both landlords and tenants are under pressure. What would you prioritize — protecting renters from displacement or keeping the market open enough to build more housing?"
- "AI can screen resumes 100x faster than humans but has shown racial bias in hiring studies. What would you prioritize — the speed and scale AI brings, or the risk it carries?"

---

TEMPLATE 2: Where Do You Draw the Line
"[Concrete situation with stakes on both sides]. Where do you draw the line between [Value A] and [Value B]?"

Examples:
- "Facial recognition can identify suspects in seconds, but it also flags innocent people — disproportionately people of color. Where do you draw the line between catching criminals faster and protecting people from wrongful suspicion?"
- "Social media platforms can remove vaccine misinformation instantly, but some flagged claims have later proved accurate. Where do you draw the line between public safety and the risk of silencing something true?"

---

TEMPLATE 3: Personal Stake
"[Specific scenario that lands on the individual]. If the cost landed on you directly — [concrete personal cost] — would it change where you stand?"

Examples:
- "Public college could become tuition-free, but it would cost the average household around $500 more per year in taxes. If that cost landed on you directly, would it change where you stand?"
- "Universal healthcare would mean guaranteed coverage for everyone, but non-emergency wait times could stretch to 6 months. If you or someone in your family needed that care, would it change how you weigh the trade-off?"

---

TEMPLATE 4: What Does This Tell You
"[Concrete fact or pattern that reveals a tension]. What does that tell you about [the underlying value or system]?"

Examples:
- "Illinois banned the death penalty 15 years ago. Most other states haven't followed. What does that tell you about how America thinks about justice — and whether it's actually changed?"
- "A political leader stays silent when anti-immigrant rhetoric dominates the news cycle. What does that silence tell you about their values?"

---

TEMPLATE 5: The Harder Question
"[Short, grounded context]. That raises a harder question: [tension-surfacing question that doesn't have an easy answer]."

Examples:
- "Nine countries hold nuclear weapons, and each justifies them as a deterrent. That raises a harder question: at what point does the threat of mutual destruction stop being a safeguard and start being the danger itself?"
- "The Strait of Hormuz carries 20% of the world's oil, and right now conflict has frozen it. That raises a harder question: when global energy security and civilian safety point in opposite directions, which one comes first?"

---

TEMPLATE 6: Outcome Focus
"[Concrete situation]. Ten years from now, what do you think the bigger cost will be — [Cost of action] or [Cost of inaction]?"

Examples:
- "Anti-immigrant rhetoric is rising in political discourse, and research links it to long-term increases in public hostility. Ten years from now, what do you think the bigger cost will be — the political risk of pushing back, or the social cost of letting it go unchallenged?"
- "Cities are spending billions on EV infrastructure while many low-income neighborhoods still lack basic public transit. Ten years from now, what do you think the bigger cost will be — slowing the clean energy transition or leaving people without reliable transport?"

---

TEMPLATE 7: Competing Values Head-on
"[Value A] vs [Value B] — [specific, concrete scenario]. Which carries more weight for you?"

Examples:
- "Speed vs accuracy — AI is being used to make bail decisions in some courts, processing cases in seconds but with documented racial disparities. Which carries more weight for you?"
- "National security vs civilian harm — sanctions on Iran restrict the flow of medical supplies alongside oil. Which carries more weight for you?"

---

CRITICAL RULES:
- Include SPECIFIC NUMBERS or CONCRETE DETAILS wherever possible
- The question must make the reader feel the tension — not just describe it
- Stay NEUTRAL — no loaded language, no signalling which answer is "correct"
- The close of the question should be open-ended — no options listed, no menu
- Every question must work as a standalone sentence a real person would pause on

SCOPE CLASSIFICATION:
- global: Climate, AI, technology, international relations, pandemics, space, human rights
- national: Federal/national laws, country-wide policies, elections
- local: City ordinances, state laws, regional infrastructure

OUTPUT: Return ONLY valid JSON:
{
  "question": "Your question using one of the 7 templates above",
  "summary": "2-3 neutral sentences explaining the trade-offs",
  "tags": ["tag1", "tag2", "tag3"],
  "location_label": "Geographic label",
  "scope": "global|national|local"
}

VALIDATION CHECK:
- Does your question contain "Do you support"? → REJECTED
- Does your question contain "Are you for/against"? → REJECTED
- Does your question end with a list of options? → REJECTED
- Is it a yes/no question? → REJECTED
- Does it lack specific numbers or concrete details? → REJECTED
- Does it not surface a genuine tension the reader will feel? → REJECTED`;
export async function run(ctx) {
  const { log, shouldStop } = ctx;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
  const BATCH = Number(Deno.env.get("GENERATE_BATCH") ?? 5);
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    log("error", "missing_env", {
      hasSupabaseUrl: !!SUPABASE_URL,
      hasServiceRole: !!SERVICE_ROLE
    });
    return {
      drafts_created: 0,
      drafts_updated: 0,
      skipped: 0,
      failed: 1,
      errors: [
        "Missing SUPABASE_URL or SERVICE_ROLE key"
      ]
    };
  }
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: {
      persistSession: false
    }
  });
  const errors = [];
  // ── Epic J2: Load active prompt from ai_prompts — non-fatal fallback ─────────
  let activeSystemPrompt = HARDCODED_SYSTEM_PROMPT;
  let activePromptId = null;
  try {
    const { data: promptRow, error: promptErr } = await supabaseAdmin.from("ai_prompts").select("id, system_prompt").eq("prompt_key", "question_generation").eq("is_active", true).maybeSingle();
    if (promptErr) {
      log("warn", "ai_prompts.read_failed_using_hardcoded", {
        error: promptErr.message
      });
    } else if (promptRow) {
      activeSystemPrompt = promptRow.system_prompt ?? HARDCODED_SYSTEM_PROMPT;
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
  // ─────────────────────────────────────────────────────────────────────────────
  const { data: topicDraftsData, error: topicError } = await supabaseAdmin.from("topic_drafts").select("id, title, summary, tags, location_label").order("created_at", {
    ascending: false
  }).limit(BATCH * 5);
  if (topicError) {
    log("error", "select_topic_drafts_failed", {
      error: topicError.message,
      code: topicError.code ?? null
    });
    errors.push(`topic_draft_select_failed: ${topicError.message}`);
    return {
      drafts_created: 0,
      drafts_updated: 0,
      skipped: 0,
      failed: 1,
      errors
    };
  }
  let topicDrafts = topicDraftsData ?? [];
  if (!topicDrafts.length) {
    log("info", "no_topic_drafts_found", {});
    return {
      drafts_created: 0,
      drafts_updated: 0,
      skipped: 0,
      failed: 0,
      errors
    };
  }
  const draftIds = topicDrafts.map((t)=>t.id);
  const { data: existingQuestions, error: qErr } = await supabaseAdmin.from("topic_question_drafts").select("topic_draft_id").in("topic_draft_id", draftIds);
  if (qErr) {
    log("warn", "select_existing_questions_failed", {
      error: qErr.message,
      code: qErr.code ?? null
    });
    errors.push(`existing_question_select_failed: ${qErr.message}`);
  }
  const alreadyCovered = new Set((existingQuestions ?? []).map((q)=>q.topic_draft_id));
  topicDrafts = topicDrafts.filter((t)=>!alreadyCovered.has(t.id)).slice(0, BATCH);
  if (!topicDrafts.length) {
    log("info", "no_topic_drafts_without_questions", {});
    return {
      drafts_created: 0,
      drafts_updated: 0,
      skipped: 0,
      failed: 0,
      errors
    };
  }
  log("info", "generate_candidates", {
    count: topicDrafts.length,
    ids: topicDrafts.map((t)=>t.id),
    prompt_source: activePromptId ? `ai_prompts:${activePromptId}` : "hardcoded"
  });
  const openai = OPENAI_API_KEY && new OpenAI({
    apiKey: OPENAI_API_KEY
  });
  let draftsCreated = 0;
  let draftsUpdated = 0;
  let skipped = 0;
  let failed = 0;
  let parentsAssigned = 0;
  await Promise.all(topicDrafts.map((draft)=>ctx.limit(async ()=>{
      if (shouldStop()) {
        skipped++;
        return;
      }
      const baseTitle = draft.title || "Untitled topic";
      const baseSummary = draft.summary || "Summary not available.";
      const existingTags = Array.isArray(draft.tags) ? draft.tags : [];
      const aiInput = {
        topic_draft_id: draft.id,
        topic_title: draft.title,
        topic_summary: draft.summary,
        topic_tags: draft.tags,
        location_label: draft.location_label ?? null,
        prompt_id: activePromptId
      };
      let question = "";
      let summary = "";
      let tags = [];
      let locationLabel = draft.location_label ?? null;
      let scope = "national";
      let aiOutput = {};
      try {
        if (!openai) {
          log("warn", "openai_missing_fallback_question_draft", {
            topic_draft_id: draft.id
          });
          question = `${baseTitle}: What trade-offs matter most to you?`;
          summary = baseSummary;
          tags = existingTags;
          scope = "national";
          aiOutput = {
            skipped: "missing_openai_api_key"
          };
        } else {
          // Epic E: classify parent before generating question
          const classification = await classifyTopicDraftParent(draft, openai, supabaseAdmin, log);
          if (classification.parent_topic_id) parentsAssigned++;
          const userPrompt = `Topic: ${draft.title ?? "(none)"}\n` + `Summary: ${draft.summary ?? "(none)"}\n` + `Location: ${draft.location_label ?? "(none)"}\n\n` + `Generate a question using TEMPLATE 1, 2, 3, 4, 5, 6, or 7 from the system prompt. ` + `The question MUST surface a genuine tension the reader will feel. ` + `DO NOT end the question with a list of options. ` + `DO NOT use "Do you support", "Are you for/against", or "Should [actor] do X, Y, or Z?". ` + `Return only valid JSON.`;
          // J2: use activeSystemPrompt (from ai_prompts or hardcoded fallback)
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content: activeSystemPrompt
              },
              {
                role: "user",
                content: userPrompt
              }
            ],
            temperature: 0.8
          });
          const rawText = completion.choices[0]?.message?.content?.trim() ?? "{}";
          let parsed = {};
          try {
            parsed = JSON.parse(rawText);
          } catch (_e) {
            log("warn", "question_draft_parse_failed_fallback", {
              topic_draft_id: draft.id,
              preview: rawText.slice(0, 200)
            });
            parsed = {};
          }
          question = (parsed.question ?? `${baseTitle}: What trade-offs matter most?`).toString().trim();
          // Forbidden phrase check — always enforced regardless of prompt source
          const forbidden = [
            "do you support",
            "are you for",
            "are you against",
            "should the government"
          ];
          const questionLower = question.toLowerCase();
          const hasForbidden = forbidden.some((phrase)=>questionLower.includes(phrase));
          if (hasForbidden) {
            log("warn", "question_contains_forbidden_phrase_using_fallback", {
              topic_draft_id: draft.id,
              original_question: question
            });
            question = `${baseTitle}: What matters more — acting quickly and accepting the risks, or taking more time and accepting the delay?`;
          }
          summary = (parsed.summary ?? baseSummary).toString().trim();
          const parsedTags = Array.isArray(parsed.tags) ? parsed.tags.map((t)=>t?.toString().trim()).filter(Boolean) : [];
          tags = parsedTags.length ? parsedTags : existingTags;
          scope = parsed.scope?.toString().toLowerCase() || "national";
          if (![
            "global",
            "national",
            "local"
          ].includes(scope)) scope = "national";
          if (scope === "global") {
            locationLabel = "Global";
          } else if (scope === "national") {
            const original = parsed.location_label?.toString().trim() || draft.location_label || null;
            if (original && original.includes(",")) {
              const parts = original.split(",").map((p)=>p.trim());
              locationLabel = parts[parts.length - 1];
            } else {
              locationLabel = original;
            }
          } else {
            locationLabel = parsed.location_label?.toString().trim() || draft.location_label || null;
          }
          aiOutput = {
            rawText,
            parsed,
            forbidden_check: hasForbidden,
            prompt_id: activePromptId
          };
        }
        // Audience classification (Phase 4A) — unchanged
        const originLocationLabel = locationLabel;
        const audienceResult = inferAudienceLocation(question, summary, tags, originLocationLabel);
        log("info", "audience_classified", {
          topic_draft_id: draft.id,
          origin: originLocationLabel,
          audience: audienceResult.audience_label,
          reason: audienceResult.reason
        });
        const insertPayload = {
          topic_draft_id: draft.id,
          question,
          raw_question: question,
          summary,
          tags,
          location_label: locationLabel,
          scope,
          state: "draft",
          reason: null,
          ai_version: "question-draft-v5-tension-framing",
          ai_input: aiInput,
          ai_output: aiOutput,
          origin_location_label: originLocationLabel,
          audience_location_label: audienceResult.audience_label,
          audience_reason: audienceResult.reason
        };
        const { data, error } = await supabaseAdmin.from("topic_question_drafts").insert(insertPayload).select().single();
        if (error || !data) {
          failed++;
          const msg = error?.message ?? "unknown_error";
          errors.push(`insert_topic_question_draft(${draft.id}): ${msg}`);
          log("error", "insert_topic_question_draft_failed", {
            topic_draft_id: draft.id,
            error: msg,
            code: error?.code ?? null
          });
          return;
        }
        draftsCreated++;
        log("info", "topic_question_draft_created", {
          topic_draft_id: draft.id,
          question_draft_id: data.id ?? null,
          scope,
          audience: audienceResult.audience_label
        });
      } catch (err) {
        failed++;
        const msg = err?.message ?? String(err);
        errors.push(`generate_for_topic_draft(${draft.id}): ${msg}`);
        log("error", "generate_for_topic_draft_exception", {
          topic_draft_id: draft.id,
          error: msg
        });
      }
    })));
  return {
    drafts_created: draftsCreated,
    drafts_updated: draftsUpdated,
    skipped,
    failed,
    parents_assigned: parentsAssigned,
    errors: errors.length ? errors : undefined
  };
}
