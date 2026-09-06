// supabase/functions/ai-stance-tip/index.ts
// ENHANCED: Context-aware stance tips for trade-off questions
//
// Sep 2026, NEW: accepts an optional language_code in the request body (the
// viewer's current UI language, e.g. "hi") and, when it's not English,
// explicitly instructs the model to answer in that language. Previously this
// had NO language handling at all — question_text/summary/low_label/
// high_label can already be a Hindi rendition (get_question_localized on the
// caller's side), but the tip itself still came back in English regardless,
// since nothing ever told the model what language to respond in. Same root
// cause/fix pattern as ugq-screen's LANGUAGE_HANDLING_INSTRUCTIONS — here
// there's no detection needed since the caller already knows the target
// language deterministically (the site's language toggle).
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
// ✨ ENHANCED: More nuanced fallback tips
const FALLBACK_TIPS = {
  [-2]: "You strongly oppose this approach and would prefer alternatives that avoid these trade-offs entirely.",
  [-1]: "You lean against this option. You see more downsides than upsides, but might accept it with strong modifications.",
  [0]: "You're neutral or unsure. You may see valid points on multiple sides or need more information to decide.",
  [1]: "You generally support this direction and believe the benefits outweigh the costs.",
  [2]: "You strongly support this approach, accepting the trade-offs as worthwhile to achieve the outcome."
};
function buildFallbackTip(stance) {
  return FALLBACK_TIPS[stance] ?? "This describes how strongly you feel about this question.";
}
// Sep 2026, NEW — small, deliberately non-exhaustive map: this platform's UI
// only supports English + Hindi today (see the `languages` table's
// is_active_for_ugq rows). An unmapped non-"en" code still gets an explicit
// instruction using the raw code itself, so a future language "just works"
// without needing this map updated first — the model can interpret a
// language name or an ISO code either way.
const LANGUAGE_NAMES = {
  hi: "Hindi"
};
serve(async (req)=>{
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: {
        ...corsHeaders
      }
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method not allowed"
    }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  let body;
  try {
    body = await req.json();
  } catch  {
    return new Response(JSON.stringify({
      error: "Invalid JSON body"
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  // question_id is passed by the frontend for cache-key scoping on the client
  // side (React Query key includes it). It is not used in the LLM prompt since
  // question_text + summary carry all the content needed for tip generation.
  // It is included in log output for traceability in Edge Function logs.
  const { stance, question_text, summary, question_id, low_label, high_label, language_code } = body ?? {};
  if (typeof stance !== "number" || stance < -2 || stance > 2) {
    return new Response(JSON.stringify({
      error: "stance must be a number between -2 and 2"
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  const fallbackTip = buildFallbackTip(stance);
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiApiKey) {
    // No key → fallback, but we still log & return 200
    console.log("[ai-stance-tip] No OPENAI_API_KEY configured; returning fallback tip", {
      stance,
      fallbackTip
    });
    return new Response(JSON.stringify({
      tip: fallbackTip,
      source: "fallback",
      reason: "missing_openai_key"
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  // ✨ ENHANCED: Context-aware prompt that references specific trade-offs
  const lowLabel = (typeof low_label === "string" && low_label.trim()) ? low_label.trim() : "Strongly disagree";
  const highLabel = (typeof high_label === "string" && high_label.trim()) ? high_label.trim() : "Strongly agree";
  const scaleDescription = `
Stance scale for THIS question (the two ends are defined below):
-2 = ${lowLabel}
-1 = leans toward "${lowLabel}"
 0 = Neutral / unsure
 1 = leans toward "${highLabel}"
 2 = ${highLabel}
`.trim();
  const questionSnippet = question_text ? `Question: "${question_text}"\n` : "";
  const summarySnippet = summary ? `Context: ${summary}\n` : "";
  // Sep 2026, NEW — see header note. Empty string for English/unset, so it's
  // a no-op splice into the prompt below (identical output to before this
  // change) whenever there's nothing non-English to ask for.
  const targetLanguageCode = typeof language_code === "string" ? language_code.trim().toLowerCase() : "";
  const targetLanguageName = targetLanguageCode && targetLanguageCode !== "en"
    ? (LANGUAGE_NAMES[targetLanguageCode] ?? targetLanguageCode)
    : "";
  const languageInstruction = targetLanguageName
    ? `\n\nCRITICAL: Write your entire answer in ${targetLanguageName}, not English — the question and its scale labels above are already in ${targetLanguageName} because that's the viewer's chosen language; your explanation must match, so they can actually read it.`
    : "";
  // ✨ NEW: Enhanced prompt with examples and instructions
  const prompt = `
You explain what a user's stance means on a civic platform. Every question defines its own scale; the two ends for THIS question are given below. Explain the user's position strictly in terms of those two ends. Do NOT assume the scale is about agreeing or disagreeing with a policy - frame it that way only if the labels themselves say so.

${scaleDescription}

${questionSnippet}${summarySnippet}
User's stance: ${stance}

INSTRUCTIONS:
1. Explain what stance ${stance} means for THIS question, in terms of "${lowLabel}" (-2) vs "${highLabel}" (+2).
2. If the labels describe delivery or implementation (e.g. "Not delivered"/"Fully delivered", "Loan not waived"/"Loan fully waived"), frame it as the user's JUDGMENT about whether it was actually done - not whether they support the idea.
3. If the labels describe support or opposition, frame it as the user's policy alignment.
4. Write in second person ("You ...").
5. Neutral and factual - help the user understand, do not persuade.
6. 50-80 words maximum.

EXAMPLES (the framing follows the labels):

Ends: "Loan not waived" / "Loan fully waived"
Stance 2: "You believe this promise was delivered - that small and marginal farmers actually received the crop-loan waiver as pledged."
Stance -2: "You believe this promise went unmet - the waiver never reached the farmers it was meant for."

Ends: "Strongly oppose" / "Strongly support"
Stance 2: "You strongly support this policy and want it enacted, prioritising its goals over the trade-offs it carries."

Now write a 50-80 word, second-person explanation of stance ${stance} for THIS question.${languageInstruction}
`.trim();
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You generate concise, neutral stance explanations for a civic platform. Explain the user's position in terms of the question's two defined scale ends; never assume agreement or disagreement unless the labels say so." + (targetLanguageName ? ` Always respond in ${targetLanguageName} when asked to.` : "")
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.5,
        max_tokens: 150
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error("[ai-stance-tip] OpenAI error; returning fallback tip", response.status, errText);
      return new Response(JSON.stringify({
        tip: fallbackTip,
        source: "fallback",
        reason: "openai_error"
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const data = await response.json();
    // ✨ UPDATED: Parse new response format
    const tip = data?.choices?.[0]?.message?.content?.trim() || fallbackTip;
    console.log("[ai-stance-tip] Using AI tip", {
      question_id: question_id ?? null,
      stance,
      question_text: question_text ?? null,
      summary: summary ?? null,
      language_code: targetLanguageCode || "en",
      tip
    });
    return new Response(JSON.stringify({
      tip,
      source: "ai",
      reason: null
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("[ai-stance-tip] Unexpected error; returning fallback tip", err);
    return new Response(JSON.stringify({
      tip: fallbackTip,
      source: "fallback",
      reason: "unexpected_error"
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
