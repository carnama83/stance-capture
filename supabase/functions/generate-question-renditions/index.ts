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
// Sep 2026, FIX (UGQ-D7): the Anthropic system prompt is now run through
// fillTemplate like the user prompt already was. It previously went out RAW,
// so {{target_language_name}} — which question_essence_transform references
// ONLY in its system prompt — reached the model unsubstituted and the
// translator was never told which language to produce. Both prompts are now
// asserted fully substituted before the call, so this class of failure is
// loud (rendition retried, error surfaced) instead of silent nonsense.
//
// Sep 2026, F2: the transform source is now the question's ORIGINAL rendition
// (the proposer-approved wording) rather than questions.question, so a
// non-English question's other renditions are no longer derived from an
// unverified English translation. Publishing goes through
// publish_rendition_version() so supersede+publish stays atomic and the
// publish gate is enforced once -- setting transform_status='published' no
// longer makes anything live. A failed equivalence check now drives a bounded
// repair loop (max 3) that feeds the checker's own explanation back in as a
// correction target, instead of flagging on the first miss.
//
// Sep 2026, UGQ-O5: generation failures are now logged and persisted
// (failure_count / last_error) instead of existing only in an HTTP response
// body the cron discards, and admin_claim_rendition_jobs stops claiming a row
// after 5 consecutive failures. Before this a permanently failing rendition
// retried every minute forever, silently.
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
  // UGQ-O5: returned by both claim RPCs (they select *), used to bound retries.
  failure_count: number | null;
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

function requireFullySubstituted(label: string, text: string): string {
  const leftover = text.match(/\{\{\w+\}\}/g);
  if (leftover) {
    throw new Error(
      `${label} still contains unsubstituted variables: ${[...new Set(leftover)].join(", ")}`,
    );
  }
  return text;
}

// UGQ-D7 (Sep 2026): system_prompt used to be sent RAW while only
// user_prompt_template went through fillTemplate. Both prompt rows reference
// {{target_language_name}} in their SYSTEM prompt, and question_essence_transform
// does not reference it in its user template at all — so the translator was never
// told which language to translate into and echoed the English back. Every
// prompt part now goes through fillTemplate and is asserted fully substituted.
async function callClaude(
  prompt: AiPromptRow,
  filledUserPrompt: string,
  vars: Record<string, string>,
): Promise<any> {
  const filledSystemPrompt = requireFullySubstituted(
    "system_prompt",
    fillTemplate(prompt.system_prompt, vars),
  );
  requireFullySubstituted("user_prompt", filledUserPrompt);
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
      system: filledSystemPrompt,
      messages: [{ role: "user", content: filledUserPrompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const textBlock = data.content?.find((b: any) => b.type === "text");
  if (!textBlock) {
    // UGQ-O5: "No text content in Anthropic response" on its own was a dead end.
    // The usual cause is the token budget being consumed before any text block
    // is emitted, so say so: stop_reason distinguishes that from a genuinely
    // empty reply, and the block types show what the budget went on.
    throw new Error(
      "No text content in Anthropic response " +
      `(stop_reason=${data.stop_reason ?? "unknown"}, ` +
      `blocks=[${(data.content ?? []).map((b: any) => b.type).join(",") || "none"}], ` +
      `max_tokens=${prompt.max_tokens}, usage=${JSON.stringify(data.usage ?? {})})`,
    );
  }

  // Models routinely wrap JSON in a markdown fence even when told not to, and
  // a bare JSON.parse treats that as a hard failure -- the rendition throws, is
  // retried, and throws again for the same reason. Surfaced by a QA fault
  // injection whose reply came back fenced; the parse error was indistinguishable
  // from a genuinely malformed response.
  const raw = String(textBlock.text ?? "").trim();
  const unfenced = raw
    .replace(/^```(?:json)?s*/i, "")
    .replace(/s*```$/, "")
    .trim();

  for (const candidate of [unfenced, raw]) {
    try {
      return JSON.parse(candidate);
    } catch { /* fall through to the next shape */ }
  }

  // Last resort: the outermost {...} in the reply. Covers a model that prefixes
  // prose before the object.
  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(unfenced.slice(first, last + 1));
    } catch { /* genuinely unparseable */ }
  }

  throw new Error(`Failed to parse JSON from model output: ${raw.slice(0, 300)}`);
}

interface OriginalRow {
  id: string;
  language_code: string;
  rendered_text: string;
  slider_low_label: string | null;
  slider_high_label: string | null;
  context_summary: string | null;
}

// F2: the proposer-approved source wording, which is what a rendition must
// preserve. Previously every transform read questions.question -- i.e. the
// ENGLISH -- so a Hindi-origin question's Marathi rendition was derived from
// a translation nobody had verified.
async function fetchOriginal(questionId: string): Promise<OriginalRow> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/question_renditions?question_id=eq.${questionId}` +
    `&rendition_type=eq.original&lifecycle_status=eq.published` +
    `&select=id,language_code,rendered_text,slider_low_label,slider_high_label,context_summary&limit=1`,
    { headers: restHeaders() },
  );
  if (!res.ok) throw new Error(`Failed to fetch original for ${questionId}: ${res.status}`);
  const rows = await res.json();
  if (!rows.length) throw new Error(`Question ${questionId} has no published original rendition`);
  return rows[0];
}

// Publishing goes through the RPC so supersede+publish stays atomic and the
// publish gate is enforced in one place. Setting transform_status to
// 'published' directly no longer makes anything live.
async function publishRendition(renditionId: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/publish_rendition_version`, {
    method: "POST",
    headers: restHeaders(),
    body: JSON.stringify({ p_rendition_id: renditionId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`publish_rendition_version failed for ${renditionId}: ${res.status} ${text.slice(0, 300)}`);
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

// Maximum regeneration attempts before a human is asked to look. The proposal
// is never rejected for this: a valid native-language question must not be
// blamed for the system failing to represent it.
const MAX_REPAIR_ATTEMPTS = 3;

async function processRendition(
  rendition: RenditionRow,
  transformPrompt: AiPromptRow,
  equivalencePrompt: AiPromptRow,
) {
  const [question, original, targetLanguageName] = await Promise.all([
    fetchQuestion(rendition.question_id),
    fetchOriginal(rendition.question_id),
    fetchLanguageName(rendition.language_code),
  ]);

  // A rendition in the source's own language would be a round trip through a
  // model back to words the proposer already approved -- the one outcome this
  // design exists to prevent.
  if (rendition.language_code === original.language_code) {
    throw new Error(
      `Rendition ${rendition.id} targets ${rendition.language_code}, which is the ` +
      `question's source language; the original is authoritative and is never regenerated`,
    );
  }

  const sourceLanguageName = await fetchLanguageName(original.language_code);

  const lowLabel  = original.slider_low_label  ?? question.slider_low_label  ?? "Strongly oppose";
  const highLabel = original.slider_high_label ?? question.slider_high_label ?? "Strongly support";

  let transformResult: any = null;
  let equivalenceResult: any = null;
  let attempts = 0;
  let lastFailureNote: string | null = null;

  // Bounded repair loop. Each retry carries the checker's own explanation back
  // in as a correction target -- a blind retry of a non-deterministic call is
  // not a repair strategy, it is a coin flip.
  while (attempts < MAX_REPAIR_ATTEMPTS) {
    attempts++;

    const transformVars = {
      target_language_name: targetLanguageName,
      source_language_name: sourceLanguageName,
      canonical_text: original.rendered_text,
      slider_low_label: lowLabel,
      slider_high_label: highLabel,
      context_summary: original.context_summary ?? question.context_summary ?? "",
    };
    let transformUserPrompt = fillTemplate(transformPrompt.user_prompt_template, transformVars);
    if (lastFailureNote) {
      transformUserPrompt +=
        "\n\nThe previous attempt was REJECTED by an independent equivalence check " +
        "for this reason:\n" + lastFailureNote + "\n" +
        "Produce a new rendition that fixes precisely that problem while keeping " +
        "the stance axis identical to the source.";
    }
    transformResult = await callClaude(transformPrompt, transformUserPrompt, transformVars);

    // Independent pass over the transform's own output -- not the same call
    // grading itself. Scoped to the stance axis (question + slider labels);
    // context_summary is supplementary background and never flips the verdict.
    const equivalenceVars = {
      target_language_name: targetLanguageName,
      source_language_name: sourceLanguageName,
      canonical_text: original.rendered_text,
      slider_low_label: lowLabel,
      slider_high_label: highLabel,
      rendered_text: transformResult.rendered_text,
      rendered_slider_low: transformResult.slider_low_label ?? "",
      rendered_slider_high: transformResult.slider_high_label ?? "",
    };
    const equivalenceUserPrompt = fillTemplate(equivalencePrompt.user_prompt_template, equivalenceVars);
    equivalenceResult = await callClaude(equivalencePrompt, equivalenceUserPrompt, equivalenceVars);

    if (equivalenceResult.result === "pass") break;
    lastFailureNote = equivalenceResult.notes ?? "No explanation returned by the checker.";
  }

  const passed = equivalenceResult?.result === "pass";

  // community_proposer: a pass goes live immediately, matching the source
  // language's own instant-publish path. Everything else lands in the admin
  // queue. Neither path may bypass the publish gate.
  const shouldPublish = passed && rendition.generation_reason === "community_proposer";

  await updateRendition(rendition.id, {
    rendered_text: transformResult.rendered_text,
    slider_low_label: transformResult.slider_low_label ?? null,
    slider_high_label: transformResult.slider_high_label ?? null,
    context_summary: typeof transformResult.rendered_context_summary === "string" && transformResult.rendered_context_summary.trim()
      ? transformResult.rendered_context_summary.trim()
      : null,
    transform_status: passed ? "transformed" : "flagged",
    transform_model: transformPrompt.model,
    axis_equivalence_check: equivalenceResult.result,
    axis_equivalence_notes: attempts > 1
      ? "[" + attempts + " attempts] " + (equivalenceResult.notes ?? "")
      : (equivalenceResult.notes ?? null),
    derived_from_rendition_id: original.id,
  });

  if (shouldPublish) await publishRendition(rendition.id);

  // Reset on success: the cap counts CONSECUTIVE failures, not lifetime ones.
  if ((rendition.failure_count ?? 0) > 0) {
    await updateRendition(rendition.id, { failure_count: 0, last_error: null }).catch(() => {});
  }

  return shouldPublish ? "published" : (passed ? "transformed" : "flagged");
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
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${rendition.id}: ${message}`);

      // UGQ-O5: log it. Previously the only record of a failure was the HTTP
      // response body, which admin.cron_generate_renditions discards -- so a
      // rendition could fail every minute forever and leave no trace anywhere
      // an operator would look.
      console.error(JSON.stringify({
        event: "rendition_generation_failed",
        rendition_id: rendition.id,
        question_id: rendition.question_id,
        language_code: rendition.language_code,
        error: message.slice(0, 1000),
      }));

      // Persist the reason and count the attempt. admin_claim_rendition_jobs
      // stops claiming at 5, so a permanently broken row is flagged for a
      // human instead of burning an Anthropic call every sweep. Clearing
      // claimed_at still lets a transient failure retry on the next sweep
      // rather than waiting out the 10-minute stale window.
      await updateRendition(rendition.id, {
        claimed_at: null,
        failure_count: (rendition.failure_count ?? 0) + 1,
        last_error: message.slice(0, 2000),
      }).catch(() => {});
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
