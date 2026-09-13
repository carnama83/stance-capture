// supabase/functions/ai-score-question/index.ts
// v4: Ecological/niche scoring calibration
//   Adds explicit guidance that ecologically/scientifically significant topics with
//   no direct consequence for people's daily lives score moderate (4-6) on impact,
//   and questions where most of the public would answer "I don't know enough"
//   score low (2-4) on stance potential. Applied to both Phase 1 and Phase 2 prompts.
//
// v3: Score bunching fix + Phase 2 stance floor
//   Fix 3 (score bunching): Prompts now explicitly prohibit round-number anchoring;
//     example values removed from JSON schema; temperature raised to 0.3; seed removed.
//   Fix 6 (stance floor): Phase 2 now requires MIN_PHASE2_STANCES (3) before real
//     engagement contributes to composite. 1–2 stances stay in Phase 1 scoring.
//
// Phase 1 (< 48h OR stances < MIN_PHASE2_STANCES): AI-only, no engagement dimension
//   Composite: impact×0.35 + stance_potential×0.30 + cluster×0.20 + region×0.15
// Phase 2 (≥ 48h AND stances ≥ MIN_PHASE2_STANCES): Blend real stance data
//   Composite: impact×0.30 + stance_potential×0.25 + cluster×0.15 + region×0.15 + real_engagement×0.15
//
// visibility override: questions < 48h old always get minimum visibility = 'visible'
// regardless of composite score (handled in update_visibility_rules SQL).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
// Phase 1 prompt — no engagement dimension, conservative framing
const PHASE1_SYSTEM_PROMPT = `You are an expert political analyst scoring questions for a civic engagement platform.

This question is NEW (published less than 48 hours ago or has no user responses yet).
Score it on POTENTIAL only — do not penalise for lack of engagement data.

Score on a 1-10 scale for these 4 dimensions:

1. **Impact Score (1-10)**: Real-world importance
   - Consequences for people's lives
   - Number of people affected
   - Long-term policy significance
   - Sports team tactics, roster decisions, and celebrity gossip score LOW (1-4) here
   - Issues that are ecologically or scientifically significant but have no direct consequence for people's daily lives, rights, or livelihoods score MODERATE at best (4-6) — biodiversity concerns, wildlife conservation, and niche environmental topics fall here unless they directly affect human communities at scale

2. **Stance Potential Score (1-10)**: How likely to generate strong, diverse opinions from a GENERAL AUDIENCE?
   - Legitimate competing viewpoints exist across society broadly
   - Moral/ethical tension present beyond a niche community
   - No obvious "correct" answer
   - Sports fans debating team strategy score LOW (3-5) here — this is not a general civic debate
   - Questions where most of the general public's honest answer is "I don't know enough to have a view" score LOW (2-4) — niche environmental or scientific topics with no visible policy battle, no direct effect on daily life, and no obvious side to take score here

3. **Cluster Density Score (1-10)**: How connected to a broader ongoing debate?
   - Part of a wider policy debate
   - Connected to multiple related issues
   - Cross-disciplinary relevance

4. **Region Relevance Score (1-10)**: Geographic reach of the issue
   - Local vs national vs global impact
   - Cross-regional interest potential
   - Issues relevant only to fans of a specific sports team score VERY LOW (1-3) here

SCORING PRECISION RULES — you MUST follow these:
- Every score must reflect genuine analytical judgment for THIS specific question. Do NOT anchor to round numbers or common values.
- Use the full 1-10 range with decimal precision. Scores like 7.0, 7.5, 8.0, 8.5 repeated across questions indicate lazy scoring — avoid this.
- Each of the 4 dimension scores must differ from each other by at least 0.3 points unless the question genuinely merits equal scores on two dimensions (which is rare — explain it in reasoning if so).
- Two different questions must NEVER produce identical sets of 4 scores. Each question is unique; its scores must be too.

CRITICAL: Respond ONLY with valid JSON. No markdown, no explanation outside JSON.

{
  "impact_score": <number 1.0-10.0, one decimal place>,
  "stance_potential_score": <number 1.0-10.0, one decimal place>,
  "cluster_density_score": <number 1.0-10.0, one decimal place>,
  "region_relevance_score": <number 1.0-10.0, one decimal place>,
  "reasoning": "Brief 1-2 sentence explanation referencing the specific scores assigned"
}`;
// Phase 2 prompt — includes actual stance data
const PHASE2_SYSTEM_PROMPT = `You are an expert political analyst scoring questions for a civic engagement platform.

This question has been live for at least 48 hours and has real user response data.
Use the provided stance count to inform your engagement score.

Score on a 1-10 scale for these 4 AI-assessed dimensions:

1. **Impact Score (1-10)**: Real-world importance
   - Consequences for people's lives, number of people affected, long-term policy significance
   - Sports team tactics, roster decisions, and celebrity gossip score LOW (1-4) here
   - Issues that are ecologically or scientifically significant but have no direct consequence for people's daily lives, rights, or livelihoods score MODERATE at best (4-6) — biodiversity concerns, wildlife conservation, and niche environmental topics fall here unless they directly affect human communities at scale

2. **Stance Potential Score (1-10)**: Diversity and strength of competing viewpoints from a GENERAL AUDIENCE
   - Issues that only divide fans of a specific team or celebrity score LOW (3-5) here
   - Questions where most of the general public's honest answer is "I don't know enough to have a view" score LOW (2-4) — niche environmental or scientific topics with no visible policy battle, no direct effect on daily life, and no obvious side to take score here

3. **Cluster Density Score (1-10)**: Connection to broader ongoing debates

4. **Region Relevance Score (1-10)**: Geographic reach
   - Issues relevant only to fans of a specific sports team score VERY LOW (1-3) here

The engagement score will be calculated from real data — do NOT include it in your response.

SCORING PRECISION RULES — you MUST follow these:
- Every score must reflect genuine analytical judgment for THIS specific question. Do NOT anchor to round numbers or common values.
- Use the full 1-10 range with decimal precision. Scores like 7.0, 7.5, 8.0, 8.5 repeated across questions indicate lazy scoring — avoid this.
- Each of the 4 dimension scores must differ from each other by at least 0.3 points unless the question genuinely merits equal scores on two dimensions (which is rare — explain it in reasoning if so).
- Two different questions must NEVER produce identical sets of 4 scores. Each question is unique; its scores must be too.

CRITICAL: Respond ONLY with valid JSON. No markdown, no explanation outside JSON.

{
  "impact_score": <number 1.0-10.0, one decimal place>,
  "stance_potential_score": <number 1.0-10.0, one decimal place>,
  "cluster_density_score": <number 1.0-10.0, one decimal place>,
  "region_relevance_score": <number 1.0-10.0, one decimal place>,
  "reasoning": "Brief 1-2 sentence explanation referencing the specific scores assigned"
}`;
// Normalize stance count to 1-10 engagement score
// Curve: 0 stances = 1, 5 = 4, 20 = 7, 50+ = 10
function stanceCountToEngagement(count) {
  if (count === 0) return 1;
  if (count >= 50) return 10;
  // Logarithmic curve: feels natural for engagement growth
  const score = 1 + 9 * Math.log(count + 1) / Math.log(51);
  return Math.min(10, Math.max(1, Math.round(score * 10) / 10));
}
// Minimum stances required before Phase 2 engagement score contributes to composite.
// Below this threshold the question stays in Phase 1 (AI-only) scoring to prevent
// a single admin/test stance from inflating the composite via the engagement curve.
const MIN_PHASE2_STANCES = 3;
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: CORS_HEADERS
    });
  }
  try {
    const { question_id } = await req.json();
    if (!question_id) throw new Error('question_id is required');
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    // Fetch question + published_at
    const { data: question, error: fetchError } = await supabase.from('questions').select('id, question, summary, tags, location_label, published_at').eq('id', question_id).single();
    if (fetchError || !question) throw new Error(`Question not found: ${question_id}`);
    // Fetch real stance count
    const { count: stanceCount, error: stanceError } = await supabase.from('question_stances').select('id', {
      count: 'exact',
      head: true
    }).eq('question_id', question_id);
    if (stanceError) console.warn('Could not fetch stance count:', stanceError.message);
    const realStanceCount = stanceCount ?? 0;
    // Determine phase
    const publishedAt = question.published_at ? new Date(question.published_at) : null;
    const hoursSincePublished = publishedAt ? (Date.now() - publishedAt.getTime()) / 3_600_000 : 0;
    const isPhase2 = hoursSincePublished >= 48 && realStanceCount >= MIN_PHASE2_STANCES;
    const phase = isPhase2 ? 2 : 1;
    console.log(`Scoring question ${question_id} | phase=${phase} | hours=${hoursSincePublished.toFixed(1)} | stances=${realStanceCount}`);
    // Build user prompt
    const userPrompt = `Question: ${question.question || 'N/A'}
Summary: ${question.summary || 'N/A'}
Tags: ${question.tags?.join(', ') || 'N/A'}
Location: ${question.location_label || 'Global'}
Published: ${publishedAt ? publishedAt.toISOString() : 'N/A'}
Hours since published: ${hoursSincePublished.toFixed(1)}
${phase === 2 ? `Real stance responses: ${realStanceCount}` : 'Status: New question — score on potential only'}

Provide your analysis as JSON only.`;
    // Call OpenAI
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: phase === 1 ? PHASE1_SYSTEM_PROMPT : PHASE2_SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: userPrompt
          }
        ],
        temperature: 0.3,
        max_tokens: 300,
        response_format: {
          type: "json_object"
        }
      })
    });
    if (!openaiResponse.ok) {
      const err = await openaiResponse.text();
      throw new Error(`OpenAI API error: ${err}`);
    }
    const openaiData = await openaiResponse.json();
    const aiResponseText = openaiData.choices[0].message.content;
    console.log('AI Response:', aiResponseText);
    let aiScores;
    try {
      aiScores = JSON.parse(aiResponseText);
    } catch (e) {
      throw new Error(`Invalid JSON from AI: ${e.message}`);
    }
    if (!aiScores.impact_score || !aiScores.stance_potential_score) {
      throw new Error('AI response missing required scores');
    }
    const impact = Number(aiScores.impact_score);
    const stancePotential = Number(aiScores.stance_potential_score);
    const clusterDensity = Number(aiScores.cluster_density_score);
    const regionRelevance = Number(aiScores.region_relevance_score);
    let engagementScore;
    let compositeScore;
    if (phase === 1) {
      // Phase 1: AI-only, no engagement dimension
      // Redistribute engagement weight across other dimensions
      engagementScore = 0 // not meaningful yet — stored as 0
      ;
      compositeScore = impact * 0.35 + stancePotential * 0.30 + clusterDensity * 0.20 + regionRelevance * 0.15;
    } else {
      // Phase 2: Real engagement from stance count
      engagementScore = stanceCountToEngagement(realStanceCount);
      compositeScore = impact * 0.30 + stancePotential * 0.25 + clusterDensity * 0.15 + regionRelevance * 0.15 + engagementScore * 0.15;
    }
    const explanation = aiScores.reasoning || `Phase ${phase} scoring: Impact ${impact}/10, Stance ${stancePotential}/10`;
    const result = {
      impact_score: impact,
      stance_potential_score: stancePotential,
      cluster_density_score: clusterDensity,
      region_relevance_score: regionRelevance,
      engagement_prediction_score: engagementScore,
      composite_score: Number(compositeScore.toFixed(2)),
      explanation: `[Phase ${phase}] ${explanation}`,
      phase,
      stance_count: realStanceCount
    };
    console.log('Final scores:', result);
    // Save to database
    const { error: saveError } = await supabase.from('topic_impact_scores').upsert({
      question_id,
      impact_score: result.impact_score,
      stance_potential_score: result.stance_potential_score,
      cluster_density_score: result.cluster_density_score,
      region_relevance_score: result.region_relevance_score,
      engagement_prediction_score: result.engagement_prediction_score,
      composite_score: result.composite_score,
      explanation: result.explanation,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'question_id',
      ignoreDuplicates: false
    });
    if (saveError) throw saveError;
    return new Response(JSON.stringify(result), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Error in ai-score-question:', error);
    return new Response(JSON.stringify({
      error: error.message,
      details: error.toString()
    }), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
