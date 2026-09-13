// supabase/functions/mp-suggest-poles/index.ts
//
// Epic MP — AI pole suggester for manifesto-promise questions.
//
// Generates the two context-driven slider end labels (slider_low_label /
// slider_high_label) for a single manifesto question WITHOUT rewriting the
// question itself. This deliberately reuses ONLY the pole-generation idea from
// the reframe pipeline — not its full question-rewrite — because manifesto
// questions are authored verbatim and must not be reworded.
//
// It reads the SAME provider/model configuration the reframe pipeline uses, so
// the poles match the style your normal pipeline produces:
//   REFRAME_MODEL_PROVIDER  "openai" (default) | "anthropic"
//   REFRAME_MODEL_NAME      OpenAI default "gpt-4o-mini" | Anthropic default "claude-sonnet-4-20250514"
//   OPENAI_API_KEY / ANTHROPIC_API_KEY
//
// Request:  POST { question_text: string, verbatim_quote?: string, category?: string }
// Response: 200 { slider_low_label, slider_high_label, provider, model }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import OpenAI from "https://esm.sh/openai@4.57.0";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.27.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You write the two end labels for a 5-point opinion slider on a civic-accountability platform.

You are given ONE question. Do NOT rewrite, restate, summarise, shorten, or critique the question. Output ONLY the two slider-end labels.

The slider runs from -2 (LOW end) to +2 (HIGH end). Decide what the two ends mean FROM THE QUESTION'S OWN WORDING:

- If the question asks whether a promise or outcome was actually DELIVERED ("were you paid…", "did prices fall…", "was the road built…", "have you received…"), the LOW end is the not-delivered / failed / broken-promise state and the HIGH end is the fully-delivered / kept-promise state.
  Example: "If you supply sugarcane, were you paid within 14 days?" -> low "Not paid in 14 days", high "Paid within 14 days".

- If the question asks whether someone SUPPORTS or OPPOSES a policy or idea, the LOW end is the oppose framing and the HIGH end is the support framing, written as concrete value noun phrases (e.g. "Protect individuals from exploitation" / "Accept security trade-offs"). Never bare "Strongly oppose" / "Strongly support".

RULES:
- Each label is a 3-6 word noun phrase, concrete to THIS question.
- Never use generic labels: not "Strongly disagree" / "Strongly agree", not "Not delivered" / "Fully delivered", not "Yes" / "No", not bare "Oppose" / "Support".
- The low label MUST describe the -2 end and the high label the +2 end. Do not swap them.

Return ONLY valid JSON, no markdown, no backticks:
{"slider_low_label": "...", "slider_high_label": "..."}`;

async function callLLM(
  provider: string,
  modelName: string,
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
): Promise<string> {
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: modelName,
      max_tokens: 256,
      temperature: 0.5,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    if (!message.content || message.content.length === 0) {
      throw new Error(
        `Anthropic returned empty content array. Check model name is valid: "${modelName}". ` +
          `Stop reason: ${message.stop_reason ?? "unknown"}`,
      );
    }
    const block = message.content[0];
    if (block.type !== "text") {
      throw new Error(`Anthropic returned non-text content block: type="${block.type}"`);
    }
    return block.text.trim();
  }
  // Default: OpenAI
  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: modelName,
    temperature: 0.5,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() ?? "";
}

function parsePoles(raw: string): { slider_low_label: string; slider_high_label: string } | null {
  try {
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    const low = typeof parsed.slider_low_label === "string" ? parsed.slider_low_label.trim() : "";
    const high = typeof parsed.slider_high_label === "string" ? parsed.slider_high_label.trim() : "";
    if (!low || !high) return null;
    return { slider_low_label: low, slider_high_label: high };
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: { ...corsHeaders } });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const questionText = (body?.question_text ?? "").toString().trim();
  if (!questionText) {
    return new Response(JSON.stringify({ error: "question_text is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const verbatim = (body?.verbatim_quote ?? "").toString().trim();
  const category = (body?.category ?? "").toString().trim();

  // ── Same provider/model selection as the reframe pipeline ──
  const rawProvider = (Deno.env.get("REFRAME_MODEL_PROVIDER") ?? "openai").toLowerCase().trim();
  const provider = rawProvider === "anthropic" ? "anthropic" : "openai";
  const defaultModel = provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o-mini";
  const modelName = (Deno.env.get("REFRAME_MODEL_NAME") ?? defaultModel).trim();
  const apiKey = provider === "anthropic"
    ? (Deno.env.get("ANTHROPIC_API_KEY") || "")
    : (Deno.env.get("OPENAI_API_KEY") || "");

  if (!apiKey) {
    const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    return new Response(
      JSON.stringify({ error: `Missing ${keyName} for provider '${provider}'` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const userPrompt = [
    `QUESTION: ${questionText}`,
    verbatim ? `MANIFESTO PROMISE (verbatim): ${verbatim}` : "",
    category ? `CATEGORY: ${category}` : "",
  ].filter(Boolean).join("\n");

  try {
    const raw = await callLLM(provider, modelName, SYSTEM_PROMPT, userPrompt, apiKey);
    const poles = parsePoles(raw);
    if (!poles) {
      return new Response(
        JSON.stringify({ error: "Could not parse poles from model output", raw }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ ...poles, provider, model: modelName }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
