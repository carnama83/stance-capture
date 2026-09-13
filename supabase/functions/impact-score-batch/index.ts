// supabase/functions/impact-score-batch/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
function isValidUuid(id) {
  return /^[0-9a-fA-F-]{36}$/.test(id);
}
async function fetchTopicContext(supabase, topicId) {
  const { data, error } = await supabase.from("v_topic_impact_admin").select(`
      topic_id,
      topic_title,
      topic_summary,
      topic_tier,
      topic_location_label,
      topic_tags
    `).eq("topic_id", topicId).limit(1).maybeSingle();
  if (error) {
    console.error("fetchTopicContext error:", error);
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
async function callOpenAIForImpactScores(context) {
  const messages = [
    {
      role: "system",
      content: "You are an assistant that scores news topics for debate potential and civic importance. Respond ONLY with strict JSON. No commentary."
    },
    {
      role: "user",
      content: `
Topic title: ${context.topic_title ?? "(none)"}
Summary: ${context.topic_summary ?? "(none)"}
Tier: ${context.topic_tier ?? "(none)"}
Region label: ${context.topic_location_label ?? "(none)"}
Tags: ${(context.topic_tags ?? []).join(", ") || "(none)"}

Return JSON:
{
  "impact_score": 1-10,
  "stance_potential_score": 1-10,
  "cluster_density_score": 1-10,
  "region_relevance_score": 1-10,
  "engagement_prediction_score": 1-10,
  "explanation": "short reason"
}
      `.trim()
    }
  ];
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
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
  if (!resp.ok) {
    const body = await resp.text();
    console.error("OpenAI error:", resp.status, body);
    throw new Error(`OpenAI error ${resp.status}`);
  }
  const json = await resp.json();
  const raw = json.choices?.[0]?.message?.content ?? "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("Failed to parse OpenAI JSON:", err, raw);
    throw new Error("OpenAI returned invalid JSON");
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
  const topicIds = Array.isArray(payload.topic_ids) ? payload.topic_ids.filter((t)=>typeof t === "string" && isValidUuid(t)) : [];
  if (topicIds.length === 0) {
    return jsonResponse({
      error: "topic_ids must be a non-empty array of UUID strings"
    }, 400);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false
    }
  });
  const results = [];
  // Sequential for now; you can batch/parallelize later with Promise.allSettled
  for (const topicId of topicIds){
    try {
      const context = await fetchTopicContext(supabase, topicId);
      if (!context) {
        results.push({
          topic_id: topicId,
          ok: false,
          error: "Topic not found or no context"
        });
        continue;
      }
      const scores = await callOpenAIForImpactScores(context);
      const { data: upserted, error: upsertError } = await supabase.rpc("upsert_topic_impact_scores", {
        p_topic_id: topicId,
        p_impact_score: scores.impact_score,
        p_stance_potential_score: scores.stance_potential_score,
        p_cluster_density_score: scores.cluster_density_score,
        p_region_relevance_score: scores.region_relevance_score,
        p_engagement_prediction_score: scores.engagement_prediction_score,
        p_explanation: scores.explanation
      });
      if (upsertError) {
        console.error("upsert_topic_impact_scores error:", upsertError);
        throw new Error("Failed to upsert impact scores");
      }
      const { data: composite, error: compositeError } = await supabase.rpc("compute_composite_score", {
        p_topic_id: topicId
      });
      if (compositeError) {
        console.error("compute_composite_score error:", compositeError);
        throw new Error("Failed to compute composite score");
      }
      results.push({
        topic_id: topicId,
        ok: true,
        context,
        scores,
        db_row: upserted,
        composite_score: composite
      });
    } catch (err) {
      console.error("Error scoring topic", topicId, err);
      results.push({
        topic_id: topicId,
        ok: false,
        error: String(err)
      });
    }
  }
  return jsonResponse({
    ok: true,
    count: results.length,
    results
  });
});
