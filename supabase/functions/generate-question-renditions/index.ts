// supabase/functions/generate-question-renditions/index.ts
//
// Invoked by admin.cron_generate_renditions() every 1 min (editorial path —
// claims whatever's pending, up to BATCH_LIMIT, oldest first).
//
// Sep 2026, NEW: also accepts an optional `rendition_id` in the POST body —
// the "small follow-up" flagged in the previous version of this header
// comment. When present, claims and processes EXACTLY that one row (via
// admin_claim_rendition_job_by_id, a single-row counterpart to the FIFO
// admin_claim_rendition_jobs RPC — same pending/staleness guard and
// row-level lock, just targeted instead of batched) and returns its result
// synchronously in the response, instead of claiming a batch. This is what
// lets ugq-confirm-publish generate a question's Hindi rendition
// synchronously at publish time rather than waiting on the next cron
// sweep — see that file. Absent rendition_id, behavior is unchanged.
//
// Sep 2026, NEW: also translates questions.context_summary into
// context_summary on the rendition row, alongside rendered_text/slider
// labels — this was the last remaining piece of a published question that
// had NO rendition at all (get_question_localized used to always return the
// English context_summary regardless of language). Best-effort: translated
// in the SAME transform call as the main text (one LLM round trip, not two),
// but NOT itself gated by axis_equivalence_check — that check is scoped to
// the stance axis (question + slider labels), not supplementary background
// text, so a context_summary translation quirk never flips transform_status.
//
// Auth: x-cron-secret header must match CRON_SECRET.
// Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET,
//               ANTHROPIC_API_KEY, ANTHROPIC_VERSION (optional, defaults below)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const ANTHROPIC_VERSION = Deno.env.get("ANTHROPIC_VERSION") ?? "2023-06-01";

const BATCH_LIMIT = 10;

interface RenditionRow {
  id: string;
  question_id: string;
  language_code: string;
  generation_reason: string | null;
}

interface QuestionRow {
  question: string;
  slider_low_label: string | null;
  slider_high_label: string | null;
  canonical_language: string;
  context_summary: string | null;
}

interface AiPromptRow {
  system_prompt: string;
  user_prompt_template: string;
  model: string;
  temperature: number;
  max_tokens: number;
}

function restHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function fetchActivePrompt(promptKey: string): Promise<AiPromptRow> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_prompts?prompt_key=eq.${promptKey}&is_active=eq.true&select=system_prompt,user_prompt_template,model,temperature,max_tokens&limit=1`,
    { headers: restHeaders() },
  );
  if (!res.ok) throw new Error(`Failed to fetch prompt ${promptKey}: ${res.status}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`No active ai_prompts row for ${promptKey}`);
  return rows[0];
}

async function fetchQuestion(questionId: string): Promise<QuestionRow> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/questions?id=eq.${questionId}&select=question,slider_low_label,slider_high_label,canonical_language,context_summary`,
    { headers: restHeaders() },
  );
  if (!res.ok) throw new Error(`Failed to fetch question ${questionId}: ${res.status}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`Question ${questionId} not found`);
  return rows[0];
}

async function fetchLanguageName(languageCode: string): Promise<string> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/languages?language_code=eq.${languageCode}&select=display_name_english`,
    { headers: restHeaders() },
  );
  if (!res.ok) throw new Error(`Failed to fetch language ${languageCode}: ${res.status}`);
  const rows = await res.json();
  return rows[0]?.display_name_english ?? languageCode;
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value ?? "");
  }
  return out;
}

async function callClaude(prompt: AiPromptRow, filledUserPrompt: string): Promise<any> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: prompt.model,
      max_tokens: prompt.max_tokens,
      // temperature deliberately omitted — claude-sonnet-5 (the model
      // configured in ai_prompts for these two prompt keys) rejects the
      // parameter outright ("temperature is deprecated for this model"),
      // confirmed against the real API, not just out-of-range. Sending it
      // at all fails every call regardless of value.
      system: prompt.system_prompt,
      messages: [{ role: "user", content: filledUserPrompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((b: any) => b.type === "text");
  if (!textBlock) throw new Error("No text content in Anthropic response");

  try {
    return JSON.parse(textBlock.text);
  } catch {
    throw new Error(`Failed to parse JSON from model output: ${textBlock.text.slice(0, 300)}`);
  }
}

async function updateRendition(id: string, patch: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/question_renditions?id=eq.${id}`, {
    method: "PATCH",
    headers: restHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to update rendition ${id}: ${res.status} ${text.slice(0, 300)}`);
  }
}

async function processRendition(
  rendition: RenditionRow,
  transformPrompt: AiPromptRow,
  equivalencePrompt: AiPromptRow,
) {
  const [question, targetLanguageName] = await Promise.all([
    fetchQuestion(rendition.question_id),
    fetchLanguageName(rendition.language_code),
  ]);

  // 1. Essence-preserving transform (Sep 2026: now also translates
  //    context_summary, when present, in this same call — see header note).
  const transformUserPrompt = fillTemplate(transformPrompt.user_prompt_template, {
    target_language_name: targetLanguageName,
    canonical_text: question.question,
    slider_low_label: question.slider_low_label ?? "Strongly oppose",
    slider_high_label: question.slider_high_label ?? "Strongly support",
    context_summary: question.context_summary ?? "",
  });
  const transformResult = await callClaude(transformPrompt, transformUserPrompt);

  // 2. Axis equivalence check — independent pass over the transform's own output,
  //    not the same call grading itself. Scoped to the stance axis only
  //    (question + slider labels) — context_summary is supplementary
  //    background, not part of what this check verifies.
  const equivalenceUserPrompt = fillTemplate(equivalencePrompt.user_prompt_template, {
    target_language_name: targetLanguageName,
    canonical_text: question.question,
    slider_low_label: question.slider_low_label ?? "Strongly oppose",
    slider_high_label: question.slider_high_label ?? "Strongly support",
    rendered_text: transformResult.rendered_text,
    rendered_slider_low: transformResult.slider_low_label ?? "",
    rendered_slider_high: transformResult.slider_high_label ?? "",
  });
  const equivalenceResult = await callClaude(equivalencePrompt, equivalenceUserPrompt);

  // 3. Final status
  //    - community_proposer: pass auto-publishes (proposer sees it immediately,
  //      matching English's own instant-publish path); anything else flags for review
  //    - editorial_pipeline / anything else: never auto-publishes — always lands
  //      in the admin review queue, 'transformed' if clean or 'flagged' if not
  let finalStatus: string;
  if (rendition.generation_reason === "community_proposer") {
    finalStatus = equivalenceResult.result === "pass" ? "published" : "flagged";
  } else {
    finalStatus = equivalenceResult.result === "pass" ? "transformed" : "flagged";
  }

  await updateRendition(rendition.id, {
    rendered_text: transformResult.rendered_text,
    slider_low_label: transformResult.slider_low_label ?? null,
    slider_high_label: transformResult.slider_high_label ?? null,
    // Sep 2026, NEW: empty string from the model (no source context_summary,
    // or a genuine empty translation) is stored as null, matching
    // questions.context_summary's own null-when-absent convention.
    context_summary: typeof transformResult.rendered_context_summary === "string" && transformResult.rendered_context_summary.trim()
      ? transformResult.rendered_context_summary.trim()
      : null,
    transform_status: finalStatus,
    transform_model: transformPrompt.model,
    axis_equivalence_check: equivalenceResult.result,
    axis_equivalence_notes: equivalenceResult.notes ?? null,
  });

  return finalStatus;
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const singleRenditionId = typeof body?.rendition_id === "string" && body.rendition_id ? body.rendition_id : null;

  let claimed: RenditionRow[];
  try {
    if (singleRenditionId) {
      const claimRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_claim_rendition_job_by_id`, {
        method: "POST",
        headers: restHeaders(),
        body: JSON.stringify({ p_rendition_id: singleRenditionId }),
      });
      if (!claimRes.ok) throw new Error(`Claim failed: ${claimRes.status}`);
      claimed = await claimRes.json();
    } else {
      const claimRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_claim_rendition_jobs`, {
        method: "POST",
        headers: restHeaders(),
        body: JSON.stringify({ p_limit: BATCH_LIMIT }),
      });
      if (!claimRes.ok) throw new Error(`Claim failed: ${claimRes.status}`);
      claimed = await claimRes.json();
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: `claim failed: ${err}` }), { status: 500 });
  }

  if (!claimed.length) {
    return new Response(
      JSON.stringify({ processed: 0, message: singleRenditionId ? "rendition not claimable" : "nothing pending" }),
      { status: 200 },
    );
  }

  const [transformPrompt, equivalencePrompt] = await Promise.all([
    fetchActivePrompt("question_essence_transform"),
    fetchActivePrompt("question_axis_equivalence_check"),
  ]);

  let succeeded = 0;
  const errors: string[] = [];
  // Sep 2026, NEW: only meaningful for the single-rendition path — lets the
  // caller (ugq-confirm-publish) know the resulting status without a
  // second round-trip back to question_renditions.
  let singleResultStatus: string | null = null;

  for (const rendition of claimed) {
    try {
      const finalStatus = await processRendition(rendition, transformPrompt, equivalencePrompt);
      succeeded++;
      if (singleRenditionId) singleResultStatus = finalStatus;
    } catch (err) {
      errors.push(`${rendition.id}: ${err}`);
      // Clear claimed_at so it's retried next sweep rather than stuck for
      // the full 10-minute stale window. No retry cap yet — see note below.
      await updateRendition(rendition.id, { claimed_at: null }).catch(() => {});
    }
  }

  return new Response(
    JSON.stringify({
      processed: claimed.length, succeeded, failed: errors.length, errors,
      ...(singleRenditionId ? { rendition_id: singleRenditionId, status: singleResultStatus } : {}),
    }),
    { status: 200 },
  );
});
