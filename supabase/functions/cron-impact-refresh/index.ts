// supabase/functions/cron-impact-refresh/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const CRON_SECRET = Deno.env.get("CRON_SECRET");
// How old scores can be before we refresh (in hours)
const SCORE_MAX_AGE_HOURS = 6;
// Max topics to score in one cron run
const MAX_TOPICS_PER_RUN = 30;
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
function isFreshEnough(isoString) {
  if (!isoString) return false;
  const updatedAt = new Date(isoString).getTime();
  if (Number.isNaN(updatedAt)) return false;
  const now = Date.now();
  const diffHours = (now - updatedAt) / (1000 * 60 * 60);
  return diffHours <= SCORE_MAX_AGE_HOURS;
}
async function fetchMissingScoreTopics(supabase) {
  // Missing = composite_score IS NULL
  const { data, error } = await supabase.from("v_topic_impact_admin").select(`
      topic_id,
      topic_title,
      topic_summary,
      topic_tier,
      topic_location_label,
      topic_tags,
      scores_updated_at
    `).is("composite_score", null).limit(MAX_TOPICS_PER_RUN);
  if (error) {
    console.error("fetchMissingScoreTopics error:", error);
    throw new Error("Failed to fetch missing-score topics");
  }
  return data ?? [];
}
async function fetchStaleHighImpactTopics(supabase) {
  // Use get_high_impact_candidates to find top topics,
  // then filter on scores_updated_at age.
  const { data, error } = await supabase.rpc("get_high_impact_candidates", {
    p_limit: MAX_TOPICS_PER_RUN
  });
  if (error) {
    console.error("get_high_impact_candidates error:", error);
    throw new Error("Failed to fetch high-impact candidates");
  }
  const rows = data ?? [];
  const stale = rows.filter((row)=>!isFreshEnough(row.scores_updated_at));
  return stale.map((row)=>({
      topic_id: row.topic_id,
      topic_title: row.topic_title,
      topic_summary: row.topic_summary,
      topic_tier: row.topic_tier,
      topic_location_label: row.topic_location_label,
      topic_tags: row.topic_tags,
      scores_updated_at: row.scores_updated_at
    }));
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
  // Only POST, only with correct cron secret
  if (req.method !== "POST") {
    return jsonResponse({
      error: "Method not allowed"
    }, 405);
  }
  const headerSecret = req.headers.get("x-cron-secret") ?? "";
  if (!CRON_SECRET || headerSecret !== CRON_SECRET) {
    return jsonResponse({
      error: "Unauthorized"
    }, 401);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false
    }
  });
  const processed = [];
  const errors = [];
  try {
    // 1) Find topics that have no composite score yet
    const missing = await fetchMissingScoreTopics(supabase);
    // 2) Find top high-impact topics whose scores are stale
    const stale = await fetchStaleHighImpactTopics(supabase);
    // Merge and dedupe by topic_id
    const byId = new Map();
    for (const t of [
      ...missing,
      ...stale
    ]){
      byId.set(t.topic_id, t);
    }
    const candidates = Array.from(byId.values()).slice(0, MAX_TOPICS_PER_RUN);
    for (const topic of candidates){
      try {
        const scores = await callOpenAIForImpactScores(topic);
        const { error: upsertError } = await supabase.rpc("upsert_topic_impact_scores", {
          p_topic_id: topic.topic_id,
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
          p_topic_id: topic.topic_id
        });
        if (compositeError) {
          console.error("compute_composite_score error:", compositeError);
          throw new Error("Failed to compute composite score");
        }
        processed.push({
          topic_id: topic.topic_id,
          composite_score: composite
        });
      } catch (err) {
        console.error("Error scoring topic in cron:", topic.topic_id, err);
        errors.push({
          topic_id: topic.topic_id,
          error: String(err)
        });
      }
    }
    return jsonResponse({
      ok: true,
      processed_count: processed.length,
      error_count: errors.length,
      processed,
      errors
    });
  } catch (err) {
    console.error("cron-impact-refresh fatal error:", err);
    return jsonResponse({
      ok: false,
      error: "Internal cron error",
      details: String(err)
    }, 500);
  }
});
