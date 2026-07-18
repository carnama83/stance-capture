// check-comment-civility/index.ts  — SELF-CONTAINED
// G3 — Civility Warning: scans comment text before posting.
// H2 — Also writes toxicity score to toxicity_scores table.
// H auto-escalation — if flagged=true, inserts a moderation_action to hide the comment.
// Fails open — if API is unavailable, returns flagged: false so posting proceeds.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
async function dbPost(path, body) {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: "resolution=ignore-duplicates"
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.error("dbPost error", e);
  }
}
async function dbGet(path) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/${path}`, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: "application/json"
      }
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] ?? null : rows;
  } catch (e) {
    console.error("dbGet error", e);
    return null;
  }
}
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method not allowed"
    }), {
      status: 405,
      headers: CORS_HEADERS
    });
  }
  if (!req.headers.get("Authorization")) {
    return new Response(JSON.stringify({
      error: "Unauthorized"
    }), {
      status: 401,
      headers: CORS_HEADERS
    });
  }
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return new Response(JSON.stringify({
      flagged: false
    }), {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json"
      }
    });
  }
  let text;
  let commentId = null;
  let commentUserId = null;
  try {
    const body = await req.json();
    text = body?.text ?? "";
    commentId = body?.comment_id ?? null;
    commentUserId = body?.user_id ?? null;
  } catch  {
    return new Response(JSON.stringify({
      error: "Invalid JSON"
    }), {
      status: 400,
      headers: CORS_HEADERS
    });
  }
  if (!text.trim()) {
    return new Response(JSON.stringify({
      flagged: false
    }), {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json"
      }
    });
  }
  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        input: text
      })
    });
    if (!res.ok) {
      console.warn("OpenAI moderation API error", res.status);
      return new Response(JSON.stringify({
        flagged: false
      }), {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json"
        }
      });
    }
    const data = await res.json();
    const result = data?.results?.[0];
    const flagged = result?.flagged === true;
    const score = result?.category_scores ? Math.max(...Object.values(result.category_scores)) : null;
    const categories = result?.categories ?? {};
    // H2: Write toxicity score to DB when comment_id is provided
    if (commentId) {
      await dbPost("toxicity_scores", [
        {
          comment_id: commentId,
          flagged,
          toxicity_score: score !== null ? Math.round(score * 1000) / 1000 : null,
          categories: categories,
          scored_at: new Date().toISOString()
        }
      ]);
      // H auto-escalation: auto-hide if flagged by OpenAI
      if (flagged && commentUserId) {
        // Hide the comment
        await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/comments?id=eq.${commentId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`
          },
          body: JSON.stringify({
            is_deleted: true
          })
        });
        // Log the auto-escalation action
        await dbPost("moderation_actions", [
          {
            report_id: null,
            comment_id: commentId,
            target_user_id: commentUserId,
            moderator_id: null,
            action: "hide_comment",
            reason: "Auto-hidden: flagged by AI moderation (OpenAI)",
            created_at: new Date().toISOString()
          }
        ]);
        // Resolve question_id for notification href
        const commentRow = await dbGet(`comments?id=eq.${commentId}&select=question_id`);
        const questionId = commentRow?.question_id ?? null;
        const notifHref = questionId ? `/questions/${questionId}` : "/settings/account";
        // Notify the user
        await dbPost("user_notifications", [
          {
            user_id: commentUserId,
            notification_type: "reminder",
            title: "Your comment was removed",
            body: "Your comment was automatically removed for violating community guidelines.",
            href: notifHref,
            metadata: {
              eventKind: "auto_moderation",
              comment_id: commentId,
              question_id: questionId
            }
          }
        ]);
      }
    }
    return new Response(JSON.stringify({
      flagged,
      score
    }), {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("check-comment-civility error", err);
    return new Response(JSON.stringify({
      flagged: false
    }), {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json"
      }
    });
  }
});
