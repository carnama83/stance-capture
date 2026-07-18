// supabase/functions/admin-create-topic-draft/index.ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "https://esm.sh/openai@4.57.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({
        error: "Missing or invalid Authorization header"
      }, 401);
    }
    const accessToken = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!supabaseUrl || !anonKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
      return jsonResponse({
        error: "Server misconfigured: Supabase env vars missing"
      }, 500);
    }
    if (!serviceRoleKey) {
      console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
      return jsonResponse({
        error: "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY missing"
      }, 500);
    }
    // client bound to user (for is_admin_me)
    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    });
    // admin client (bypasses RLS)
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false
      }
    });
    // 1) verify admin
    const { data: isAdmin, error: adminError } = await supabaseAuth.rpc("is_admin_me");
    if (adminError) {
      console.error("is_admin_me error:", adminError);
      return jsonResponse({
        error: "Failed to verify admin status"
      }, 500);
    }
    if (!isAdmin) {
      return jsonResponse({
        error: "Forbidden"
      }, 403);
    }
    // 2) parse body
    const body = await req.json();
    if (!body?.news_item_id) {
      return jsonResponse({
        error: "news_item_id is required"
      }, 400);
    }
    const newsItemId = body.news_item_id;
    // 3) load news_items row (via admin client)
    const { data: news, error: newsError } = await supabaseAdmin.from("news_items").select("id, source_id, title, summary, url, published_at").eq("id", newsItemId).single();
    if (newsError) {
      console.error("Failed to load news_items row:", newsError);
      return jsonResponse({
        error: "Failed to load news item",
        details: newsError?.message ?? String(newsError),
        code: newsError?.code ?? null
      }, 500);
    }
    if (!news) {
      return jsonResponse({
        error: "News item not found"
      }, 404);
    }
    // 4) build AI (or fallback) draft
    let aiTitle;
    let aiSummary;
    let aiTags;
    let aiLocation;
    let aiOutput;
    const aiInput = {
      news_item_id: news.id,
      title: news.title,
      summary: news.summary,
      url: news.url,
      published_at: news.published_at
    };
    const baseTitle = news.title ?? "Untitled topic";
    const baseSummary = news.summary ?? "Summary not available.";
    if (!openaiApiKey) {
      console.warn("OPENAI_API_KEY missing, using fallback topic draft (no model call).");
      aiTitle = baseTitle;
      aiSummary = baseSummary;
      aiTags = [];
      aiLocation = null;
      aiOutput = {
        skipped: "missing_openai_api_key"
      };
    } else {
      const openai = new OpenAI({
        apiKey: openaiApiKey
      });
      const systemPrompt = "You are an assistant that creates concise topic drafts for a stance-capture app. " + "Given a news article, return a JSON object with fields: title, summary, tags, location_label. " + "The title should be a short, neutral, human-readable topic. " + "The summary should be 1–3 sentences and neutral. " + "tags is an array of 2–6 short lowercase slugs (e.g. ['taxes','new-jersey']). " + "location_label should be a short human-readable area like 'Mahwah, NJ', 'New Jersey', 'United States', or 'Global'.";
      const userPrompt = "News article:\n\n" + `Title: ${news.title ?? "(none)"}\n` + `Summary: ${news.summary ?? "(none)"}\n` + `URL: ${news.url ?? "(none)"}\n` + `Published at: ${news.published_at ?? "(none)"}\n\n` + "Return ONLY valid JSON with keys: title, summary, tags, location_label.";
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            {
              role: "user",
              content: userPrompt
            }
          ],
          temperature: 0.4
        });
        const rawText = completion.choices[0]?.message?.content?.trim() ?? "{}";
        let parsed;
        try {
          parsed = JSON.parse(rawText);
        } catch (_e) {
          console.warn("Failed to parse model JSON, falling back to base draft.");
          parsed = {};
        }
        aiTitle = parsed.title?.toString().trim() || baseTitle;
        aiSummary = parsed.summary?.toString().trim() || baseSummary;
        aiTags = Array.isArray(parsed.tags) ? parsed.tags.map((t)=>t.toString().trim()).filter(Boolean) : [];
        aiLocation = parsed.location_label?.toString().trim() || null;
        aiOutput = {
          rawText,
          parsed
        };
      } catch (err) {
        // 👇 THIS is where your 429 is coming from; we now fallback instead of failing
        console.warn("OpenAI call failed, using fallback draft:", err);
        aiTitle = baseTitle;
        aiSummary = baseSummary;
        aiTags = [];
        aiLocation = null;
        aiOutput = {
          error: String(err),
          note: "fallback_used_due_to_openai_error"
        };
      }
    }
    // 5) insert via RPC admin_create_topic_draft (admin client)
    const { data: draft, error: draftError } = await supabaseAdmin.rpc("admin_create_topic_draft", {
      p_news_item_id: news.id,
      p_title: aiTitle,
      p_summary: aiSummary,
      p_tags: aiTags,
      p_location_label: aiLocation,
      p_ai_version: "topic-draft-v1",
      p_ai_input: aiInput,
      p_ai_output: aiOutput
    });
    if (draftError || !draft) {
      console.error("admin_create_topic_draft error:", draftError);
      return jsonResponse({
        error: "Failed to create topic draft",
        details: draftError?.message ?? String(draftError),
        code: draftError?.code ?? null
      }, 500);
    }
    return jsonResponse({
      ok: true,
      draft
    }, 200);
  } catch (err) {
    console.error("admin-create-topic-draft error:", err);
    return jsonResponse({
      error: "Unexpected error",
      details: err?.message ?? String(err),
      stack: err?.stack ?? null
    }, 500);
  }
});
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
