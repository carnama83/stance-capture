// supabase/functions/comment-sentiment/index.ts
// Analyze sentiment of a single comment, then update the DB, with CORS + safe fallbacks.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "npm:openai";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
Deno.serve(async (req)=>{
  // 1) Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
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
    const payload = await req.json().catch(()=>null);
    const comment_id = payload?.comment_id;
    const body = payload?.body;
    if (!comment_id || !body) {
      return new Response(JSON.stringify({
        error: "Missing comment_id or body"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    // Helper to update DB and respond
    async function updateAndReturn(score, label, source) {
      try {
        await supabase.from("comments").update({
          sentiment_score: score,
          sentiment_label: label
        }).eq("id", comment_id);
      } catch (dbErr) {
        console.error("[comment-sentiment] DB update error", dbErr);
      }
      return new Response(JSON.stringify({
        source,
        score,
        label
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // 2) If no OpenAI key, simple heuristic fallback
    if (!openaiKey) {
      console.warn("[comment-sentiment] Missing OPENAI_API_KEY; using heuristic fallback");
      const lower = body.toLowerCase();
      let score = 0;
      if (lower.includes("love") || lower.includes("great") || lower.includes("good")) {
        score = 0.5;
      } else if (lower.includes("hate") || lower.includes("terrible") || lower.includes("bad")) {
        score = -0.5;
      }
      const label = score > 0 ? "positive" : score < 0 ? "negative" : "neutral";
      return await updateAndReturn(score, label, "fallback_no_key");
    }
    // 3) Real AI sentiment via OpenAI, but always with try/catch + fallback
    let score = 0;
    let label = "neutral";
    try {
      const client = new OpenAI({
        apiKey: openaiKey
      });
      const prompt = `
You are analyzing the sentiment of a single user comment.
Return a JSON object with:

- "score": a number from -1.0 (very negative) to +1.0 (very positive)
- "label": one of "negative", "neutral", or "positive"

Comment:
"${body}"
`;
      const result = await client.responses.create({
        model: "gpt-4o-mini",
        input: prompt,
        response_format: {
          type: "json_object"
        }
      });
      const text = result.output_text ?? "{}";
      let parsed = {};
      try {
        parsed = JSON.parse(text);
      } catch (parseErr) {
        console.warn("[comment-sentiment] Failed to parse JSON from OpenAI, text=", text, "err=", parseErr);
      }
      if (typeof parsed.score === "number") {
        score = parsed.score;
      }
      if (parsed.label === "positive" || parsed.label === "negative" || parsed.label === "neutral") {
        label = parsed.label;
      } else if (score > 0) {
        label = "positive";
      } else if (score < 0) {
        label = "negative";
      } else {
        label = "neutral";
      }
    } catch (aiErr) {
      console.error("[comment-sentiment] OpenAI error, falling back to neutral", aiErr);
    // keep default score=0, label="neutral"
    }
    return await updateAndReturn(score, label, "ai_or_neutral_fallback");
  } catch (err) {
    console.error("[comment-sentiment] top-level error", err);
    // even if something weird happens, don't 500 the browser
    return new Response(JSON.stringify({
      error: err?.message ?? "Unknown error",
      source: "top_level_fallback"
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
