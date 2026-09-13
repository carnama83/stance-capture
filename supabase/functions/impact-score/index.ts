// supabase/functions/impact-score/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// -----------------------------
// Env vars
// -----------------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
// Fail fast if misconfigured
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
}
if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY env var");
}
// -----------------------------
// Helpers
// -----------------------------
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
// -----------------------------
// Fetch topic context from DB
// - We use v_topic_impact_admin so we can reuse this later
//   in the Impact Dashboard as well.
// -----------------------------
async function fetchTopicContext(topicId, supabase) {
  const { data, error } = await supabase.from("v_topic_impact_admin").select(`
      topic_id,
      topic_title,
      topic_summary,
      topic_tier,
      topic_location_label,
      topic_tags
    `).eq("topic_id", topicId).limit(1).maybeSingle();
  if (error) {
    console.error("Error fetching topic context:", error);
    throw new Error("Failed to fetch topic context");
  }
  if (!data) return null;
  return {
    topic_id: data.topic_id,
    topic_title: data.topic_title,
    topic_summary: data.topic_summary,
    topic_tier: data.topic_tier,
    topic_location_label: data.topic_location_label,
    topic_tags: data.topic_tags
  };
}
// -----------------------------
// Call OpenAI to compute scores
// -----------------------------
async function callOpenAIForImpactScores(context) {
  const messages = [
    {
      role: "system",
      content: "You are an assistant that scores news topics for debate potential and civic importance. Respond ONLY with strict JSON. No commentary."
    },
    {
      role: "user",
      content: `
You are given a topic from a civic discussion app.

Topic title: ${context.topic_title ?? "(none)"}
Summary: ${context.topic_summary ?? "(none)"}
Tier: ${context.topic_tier ?? "(none)"}
Region label: ${context.topic_location_label ?? "(none)"}
Tags: ${(context.topic_tags ?? []).join(", ") || "(none)"}

Return a JSON object with the following numeric fields, all between 1 and 10:

- impact_score: How important is this topic for society, politics, or public policy?
- stance_potential_score: How likely are people to have clear, opposing stances?
- cluster_density_score: Assume multiple sources if the issue is widely covered; rate 1 (niche) to 10 (broad coverage).
- region_relevance_score: How relevant is this to the region label provided?
- engagement_prediction_score: How likely is it that users will want to discuss and debate this?

Also include:
- explanation: A short sentence (max 30 words) explaining why.

Example JSON:
{
  "impact_score": 8,
  "stance_potential_score": 9,
  "cluster_density_score": 7,
  "region_relevance_score": 6,
  "engagement_prediction_score": 8,
  "explanation": "..."
}

Respond with JSON only.
      `.trim()
    }
  ];
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.2
    })
  });
  if (!response.ok) {
    const body = await response.text();
    console.error("OpenAI error:", response.status, body);
    throw new Error(`OpenAI API error: ${response.status}`);
  }
  const json = await response.json();
  const rawContent = json.choices?.[0]?.message?.content ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    console.error("Failed to parse OpenAI JSON:", err, rawContent);
    throw new Error("OpenAI did not return valid JSON");
  }
  const scores = {
    impact_score: Number(parsed.impact_score ?? 0),
    stance_potential_score: Number(parsed.stance_potential_score ?? 0),
    cluster_density_score: Number(parsed.cluster_density_score ?? 0),
    region_relevance_score: Number(parsed.region_relevance_score ?? 0),
    engagement_prediction_score: Number(parsed.engagement_prediction_score ?? 0),
    explanation: String(parsed.explanation ?? "")
  };
  return scores;
}
// -----------------------------
// Main handler
// -----------------------------
serve(async (req)=>{
  if (req.method !== "POST") {
    return jsonResponse({
      error: "Method not allowed"
    }, 405);
  }
  let payload;
  try {
    payload = await req.json();
  } catch (_err) {
    return jsonResponse({
      error: "Invalid JSON body"
    }, 400);
  }
  const { topic_id } = payload;
  if (!isNonEmptyString(topic_id)) {
    return jsonResponse({
      error: "Missing or invalid topic_id in request body"
    }, 400);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false
    }
  });
  try {
    // 1) Fetch topic context
    const context = await fetchTopicContext(topic_id, supabase);
    if (!context) {
      return jsonResponse({
        error: "Topic not found or not eligible for impact scoring"
      }, 404);
    }
    // 2) Call OpenAI to get impact scores
    const scores = await callOpenAIForImpactScores(context);
    // 3) Persist scores via RPC: upsert_topic_impact_scores
    const { data: upserted, error: upsertError } = await supabase.rpc("upsert_topic_impact_scores", {
      p_topic_id: topic_id,
      p_impact_score: scores.impact_score,
      p_stance_potential_score: scores.stance_potential_score,
      p_cluster_density_score: scores.cluster_density_score,
      p_region_relevance_score: scores.region_relevance_score,
      p_engagement_prediction_score: scores.engagement_prediction_score,
      p_explanation: scores.explanation
    });
    if (upsertError) {
      console.error("upsert_topic_impact_scores error:", upsertError);
      throw new Error("Failed to upsert topic impact scores");
    }
    // 4) Compute composite score
    const { data: composite, error: compositeError } = await supabase.rpc("compute_composite_score", {
      p_topic_id: topic_id
    });
    if (compositeError) {
      console.error("compute_composite_score error:", compositeError);
      throw new Error("Failed to compute composite score");
    }
    // 5) Return final result
    return jsonResponse({
      ok: true,
      topic_id,
      context,
      scores,
      db_row: upserted,
      composite_score: composite
    });
  } catch (err) {
    console.error("impact-score function error:", err);
    return jsonResponse({
      error: "Internal error in impact-score",
      details: String(err)
    }, 500);
  }
});
