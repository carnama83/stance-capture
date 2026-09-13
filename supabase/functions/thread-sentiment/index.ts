// functions/thread-sentiment/index.ts
// Compute thread-level sentiment + AI summary for a question, with CORS.
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
    const { question_id } = await req.json();
    if (!question_id) {
      return new Response(JSON.stringify({
        error: "missing question_id"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    // 2) Pull comments for that question
    const { data: comments, error: commentsError } = await supabase.from("comments").select("id, body, sentiment_score").eq("question_id", question_id).eq("is_deleted", false);
    if (commentsError) {
      console.error("[thread-sentiment] comments error", commentsError);
      return new Response(JSON.stringify({
        error: commentsError.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (!comments || comments.length === 0) {
      return new Response(JSON.stringify({
        message: "no comments"
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // 3) Compute numeric stats from per-comment sentiment
    const valid = comments.filter((c)=>c.sentiment_score !== null);
    const count = valid.length;
    const avg = count === 0 ? 0 : valid.reduce((sum, c)=>sum + Number(c.sentiment_score), 0) / count;
    const variance = count <= 1 ? 0 : valid.reduce((s, c)=>{
      const d = Number(c.sentiment_score) - avg;
      return s + d * d;
    }, 0) / (count - 1);
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    let summary = "No AI summary available.";
    let model = "none";
    if (openaiKey) {
      const client = new OpenAI({
        apiKey: openaiKey
      });
      const joinedComments = comments.slice(0, 20).map((c)=>`- ${c.body}`).join("\n");
      const prompt = `
You are summarizing a public discussion on a civic question.
Write 2–3 sentences that capture:

- Overall mood (supportive, critical, mixed, worried, hopeful, etc.)
- Main themes or concerns
- Any clear disagreements

Be neutral and factual.

COMMENTS:
${joinedComments}
`;
      const resp = await client.responses.create({
        model: "gpt-4o-mini",
        input: prompt
      });
      summary = resp.output_text ?? "No summary.";
      model = "gpt-4o-mini";
    }
    // 4) Persist into question_comment_sentiment (via RPC)
    const { data: upserted, error: upsertErr } = await supabase.rpc("upsert_question_comment_sentiment", {
      p_question_id: question_id,
      p_avg_sentiment: avg,
      p_sentiment_variance: variance,
      p_comment_count: comments.length,
      p_summary_text: summary,
      p_model: model
    });
    if (upsertErr) {
      console.error("[thread-sentiment] upsert error", upsertErr);
      return new Response(JSON.stringify({
        error: upsertErr.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    return new Response(JSON.stringify({
      ok: true,
      avg,
      variance,
      comment_count: comments.length,
      summary
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("[thread-sentiment] error", err);
    return new Response(JSON.stringify({
      error: err?.message ?? "Unknown error"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
