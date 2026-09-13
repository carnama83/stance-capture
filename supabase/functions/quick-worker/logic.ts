// supabase/functions/create-topic-drafts/logic.ts
// NEW FUNCTION: Creates topic_drafts from topic_clusters using AI
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";
import OpenAI from "https://esm.sh/openai@4.57.0";
export async function run(ctx) {
  const { log, shouldStop } = ctx;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
  const BATCH = Number(Deno.env.get("CREATE_DRAFTS_BATCH") ?? 50);
  log("info", "create_drafts_config", {
    batch: BATCH,
    hasOpenAI: !!OPENAI_API_KEY,
    hasSupabaseUrl: !!SUPABASE_URL,
    hasServiceRole: !!SERVICE_ROLE
  });
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    log("error", "missing_env", {
      hasSupabaseUrl: !!SUPABASE_URL,
      hasServiceRole: !!SERVICE_ROLE
    });
    return {
      drafts_created: 0,
      skipped: 0,
      failed: 1,
      errors: [
        "Missing SUPABASE_URL or SERVICE_ROLE key"
      ]
    };
  }
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: {
      persistSession: false
    }
  });
  const errors = [];
  let draftsCreated = 0;
  let skipped = 0;
  let failed = 0;
  // 1) Find clusters without topic_drafts
  const { data: clustersData, error: clustersError } = await supabaseAdmin.from("topic_clusters").select(`
      id,
      title,
      method,
      confidence,
      centroid,
      created_at,
      topic_cluster_items (
        ingestion_queue (
          id,
          title,
          summary,
          url,
          source_id,
          normalized
        )
      )
    `).order("created_at", {
    ascending: false
  }).limit(BATCH * 2);
  if (clustersError) {
    log("error", "select_clusters_failed", {
      error: clustersError.message,
      code: clustersError.code
    });
    errors.push(`select_clusters_failed: ${clustersError.message}`);
    return {
      drafts_created: 0,
      skipped: 0,
      failed: 1,
      errors
    };
  }
  let clusters = clustersData ?? [];
  // 2) Filter out clusters that already have drafts
  if (clusters.length > 0) {
    const clusterIds = clusters.map((c)=>c.id);
    const { data: existingDrafts, error: draftsError } = await supabaseAdmin.from("topic_drafts").select("cluster_id").in("cluster_id", clusterIds).not("cluster_id", "is", null);
    if (draftsError) {
      log("warn", "select_existing_drafts_failed", {
        error: draftsError.message,
        code: draftsError.code
      });
    } else {
      const alreadyHaveDrafts = new Set((existingDrafts ?? []).map((d)=>d.cluster_id));
      clusters = clusters.filter((c)=>!alreadyHaveDrafts.has(c.id));
      log("info", "filtered_existing_drafts", {
        totalClusters: clustersData?.length ?? 0,
        alreadyHaveDrafts: alreadyHaveDrafts.size,
        remaining: clusters.length
      });
    }
  }
  clusters = clusters.slice(0, BATCH);
  log("info", "create_drafts_candidates", {
    count: clusters.length,
    sampleIds: clusters.slice(0, 10).map((c)=>c.id)
  });
  if (clusters.length === 0) {
    log("info", "no_clusters_need_drafts", {});
    return {
      drafts_created: 0,
      skipped: 0,
      failed: 0,
      errors
    };
  }
  const openai = OPENAI_API_KEY && new OpenAI({
    apiKey: OPENAI_API_KEY
  });
  // 3) For each cluster, create a topic_draft
  await Promise.all(clusters.map((cluster)=>ctx.limit(async ()=>{
      if (shouldStop()) {
        skipped++;
        return;
      }
      const clusterTitle = cluster.title || "Untitled topic";
      // Get representative articles from cluster
      const articles = cluster.topic_cluster_items || [];
      const representativeArticles = articles.slice(0, 3).map((item)=>item.ingestion_queue).filter(Boolean);
      if (representativeArticles.length === 0) {
        log("warn", "cluster_has_no_articles", {
          cluster_id: cluster.id
        });
        failed++;
        return;
      }
      const mainArticle = representativeArticles[0];
      // Prepare defaults
      const baseTitle = clusterTitle;
      const baseSummary = mainArticle.summary || "Summary not available.";
      let aiTitle = baseTitle;
      let aiSummary = baseSummary;
      let aiTags = [];
      let aiLocation = null;
      let aiOutput = {};
      try {
        if (!openai) {
          log("warn", "openai_missing_fallback_topic_draft", {
            cluster_id: cluster.id
          });
          aiOutput = {
            skipped: "missing_openai_api_key"
          };
        } else {
          const systemPrompt = "You are an assistant that creates concise topic drafts for a stance-capture app. " + "Given news articles from a cluster, return a JSON object with fields: title, summary, tags, location_label. " + "The title should be a short, neutral, human-readable topic. " + "The summary should be 1–3 sentences and neutral. " + "tags is an array of 2–6 short lowercase slugs. " + "location_label should be like 'New Jersey', 'United States', or 'Global'.";
          // Build context from representative articles
          const articlesContext = representativeArticles.map((a, i)=>{
            const source = a.source_id ? `Source ${i + 1}` : `Article ${i + 1}`;
            return `${source}:\nTitle: ${a.title}\nSummary: ${a.summary}\nURL: ${a.url}`;
          }).join("\n\n");
          const userPrompt = `Cluster of ${articles.length} articles covering the same story:\n\n` + `${articlesContext}\n\n` + "Synthesize these into one neutral topic. Return only valid JSON with fields: title, summary, tags, location_label.";
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
            temperature: 0.5
          });
          const raw = completion.choices[0]?.message?.content || "{}";
          let parsed = {};
          try {
            parsed = JSON.parse(raw);
          } catch  {
            log("warn", "openai_json_parse_error", {
              cluster_id: cluster.id
            });
          }
          aiTitle = parsed.title || baseTitle;
          aiSummary = parsed.summary || baseSummary;
          aiTags = Array.isArray(parsed.tags) ? parsed.tags : [];
          aiLocation = parsed.location_label || null;
          aiOutput = {
            parsed,
            sources_count: articles.length
          };
        }
      } catch (err) {
        log("warn", "openai_call_error", {
          cluster_id: cluster.id,
          error: err?.message || String(err)
        });
        aiOutput = {
          error: err?.message || String(err)
        };
      }
      // Prepare insert data
      const insertData = {
        cluster_id: cluster.id,
        title: aiTitle.slice(0, 200),
        summary: aiSummary.slice(0, 500),
        status: 'draft'
      };
      // Add optional fields
      if (aiTags && Array.isArray(aiTags) && aiTags.length > 0) {
        insertData.tags = aiTags;
      }
      if (aiLocation) {
        insertData.location_label = aiLocation;
      }
      if (aiOutput && Object.keys(aiOutput).length > 0) {
        insertData.ai_output = aiOutput;
      }
      log("info", "attempting_insert", {
        cluster_id: cluster.id,
        fields: Object.keys(insertData),
        title_preview: aiTitle.slice(0, 50),
        sources_count: articles.length
      });
      const { error: insertErr } = await supabaseAdmin.from("topic_drafts").insert(insertData);
      if (insertErr) {
        log("error", "topic_draft_insert_failed", {
          cluster_id: cluster.id,
          error: insertErr.message,
          code: insertErr.code,
          hint: insertErr.hint,
          details: insertErr.details,
          attempted_fields: Object.keys(insertData)
        });
        failed++;
      } else {
        log("info", "topic_draft_created_successfully", {
          cluster_id: cluster.id,
          title: aiTitle.slice(0, 50),
          sources: articles.length
        });
        draftsCreated++;
      }
    })));
  log("info", "create_drafts_completed", {
    draftsCreated,
    skipped,
    failed
  });
  return {
    drafts_created: draftsCreated,
    skipped,
    failed,
    errors: errors.length ? errors : undefined
  };
}
