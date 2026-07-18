// supabase/functions/classify-parent-topics/index.ts
//
// v2 — adds bootstrap phase: when < MIN_APPROVED_PARENTS approved parents exist,
// sends ALL unclassified draft titles in one GPT-4o batch call to generate
// 8-12 broad canonical categories, inserts them as `approved`, then classifies
// against them in the same run.
//
// Pipeline position: cluster → classify-parent-topics → generate question drafts
//
// Auth: x-cron-secret header OR user JWT with is_admin_me()
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)
//   SUPABASE_ANON_KEY          (for JWT auth path)
//   CRON_SECRET
//   OPENAI_API_KEY
//   CLASSIFY_BATCH             default 20
//   CLASSIFY_WINDOW_HOURS      default 72
//   CLASSIFY_THRESHOLD         default 0.75
//   MIN_APPROVED_PARENTS       default 5  (bootstrap triggers below this)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";
import OpenAI from "https://esm.sh/openai@4.57.0";
const FUNC = "classify-parent-topics";
function log(level, msg, extra = {}, traceId) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    func: FUNC,
    traceId,
    msg,
    ...extra
  }));
}
// ── Auth ──────────────────────────────────────────────────────────────────────
async function authorize(req) {
  const incoming = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET") ?? "";
  if (expected && incoming === expected) return {
    ok: true
  };
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!jwt) return {
    ok: false,
    status: 401,
    error: "unauthorized"
  };
  const { createClient: cc } = await import("https://esm.sh/@supabase/supabase-js@2.45.2");
  const client = cc(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${jwt}`
      }
    }
  });
  const { data: userData, error: userErr } = await client.auth.getUser();
  if (userErr || !userData?.user) return {
    ok: false,
    status: 401,
    error: "unauthorized"
  };
  const { data: isAdmin, error: adminErr } = await client.rpc("is_admin_me");
  if (adminErr || !isAdmin) return {
    ok: false,
    status: 403,
    error: "forbidden"
  };
  return {
    ok: true
  };
}
// ── Prompts ───────────────────────────────────────────────────────────────────
const CLASSIFY_SYSTEM_PROMPT = `You are a news topic classifier for a civic intelligence platform.
Your job is to assign a specific news story to the most appropriate broad THEME from a list of existing themes.

Rules:
1. Themes are broad, geography-scoped categories (e.g. "Gun Violence & Public Safety — United States").
2. Only assign a theme if you are genuinely confident (confidence >= 0.75).
3. If no theme fits well, return null for parent_topic_id.
4. Never invent a theme not in the list.
5. Geography matters — prefer themes whose location_label matches the story, or 'Global' themes for international stories.
6. Return ONLY valid JSON — no markdown, no explanation.

Response format:
{
  "parent_topic_id": "<uuid from the list, or null>",
  "confidence": <number 0.0 to 1.0>,
  "reason": "<one sentence explaining the match or why no match>"
}`;
const PROPOSE_SYSTEM_PROMPT = `You are a theme architect for a civic intelligence platform.
A new news story does not fit any existing theme. Propose a new broad THEME that this story belongs to.

Rules:
1. Themes must be BROAD enough to cover many future stories on the same topic (NOT event-specific).
   BAD: "WHCA Dinner Shooting 2026" — too specific, event-driven.
   GOOD: "Political Violence & Public Safety" — broad, reusable theme.
2. Include the geographic scope in the title: "Gun Violence — United States", "Immigration Policy — Europe".
3. Write a neutral 1-2 sentence description of what this theme covers.
4. Suggest 3-5 relevant tags.
5. Set location_label to match the story's geography, or "Global" for international issues.
6. Set tier to one of: city | county | state | country | global
7. Return ONLY valid JSON — no markdown.

Response format:
{
  "title": "Theme Name — Geography",
  "description": "What this theme covers in 1-2 neutral sentences.",
  "tags": ["tag1", "tag2", "tag3"],
  "location_label": "Country or Global",
  "tier": "country"
}`;
const BOOTSTRAP_SYSTEM_PROMPT = `You are a taxonomy architect for a civic intelligence platform.
Given a list of news story titles, generate a set of BROAD, CANONICAL parent themes that together
cover as much of the list as possible.

Rules:
1. Generate between 8 and 14 themes total — no more.
2. Themes must be BROAD and REUSABLE — they should describe an ongoing topic area, not a single event.
   BAD: "Trump Tariff Announcement April 2026", "Specific Bridge Collapse"
   GOOD: "Trade Policy & Tariffs — United States", "Infrastructure & Public Safety"
3. Each theme title must include a geographic scope:
   "Criminal Justice — United States", "Foreign Policy — India", "Climate & Environment — Global"
4. Aim to span diverse topic areas — do not create 5 themes all about US politics.
5. Include a neutral 1-2 sentence description and 3-5 tags per theme.
6. Set tier to one of: city | county | state | country | global
7. Return ONLY a valid JSON array — no markdown, no explanation.

Response format:
[
  {
    "title": "Theme Name — Geography",
    "description": "What this theme covers.",
    "tags": ["tag1", "tag2"],
    "location_label": "United States",
    "tier": "country"
  }
]`;
// ── Bootstrap: generate broad canonical themes from all draft titles ──────────
async function bootstrapParentTopics(drafts, openai, sb, traceId) {
  log("info", "bootstrap_start", {
    draftCount: drafts.length
  }, traceId);
  const titleList = drafts.map((d, i)=>`${i + 1}. ${d.title ?? "(untitled)"}`).join("\n");
  let parsed = [];
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      temperature: 0.2,
      max_tokens: 2000,
      // @ts-ignore
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content: BOOTSTRAP_SYSTEM_PROMPT + '\n\nIMPORTANT: Wrap your array in {"themes": [...]}'
        },
        {
          role: "user",
          content: `Here are the news story titles to analyse:\n\n${titleList}`
        }
      ]
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
    let outer = {};
    try {
      outer = JSON.parse(raw);
    } catch  {
      outer = {};
    }
    // Accept {"themes": [...]} or a bare array
    if (Array.isArray(outer)) {
      parsed = outer;
    } else if (Array.isArray(outer.themes)) {
      parsed = outer.themes;
    } else {
      // try first array value found
      const firstArr = Object.values(outer).find((v)=>Array.isArray(v));
      parsed = firstArr ?? [];
    }
  } catch (err) {
    log("error", "bootstrap_llm_failed", {
      error: err?.message
    }, traceId);
    return [];
  }
  if (!parsed.length) {
    log("warn", "bootstrap_empty_response", {}, traceId);
    return [];
  }
  log("info", "bootstrap_themes_generated", {
    count: parsed.length
  }, traceId);
  const validTiers = [
    "city",
    "county",
    "state",
    "country",
    "global"
  ];
  const inserted = [];
  for (const theme of parsed){
    if (!theme.title || theme.title.trim().length < 5) continue;
    const tier = validTiers.includes(theme.tier) ? theme.tier : "country";
    const { data: newTopic, error: insertErr } = await sb.from("topics").insert({
      title: theme.title.trim().slice(0, 200),
      description: (theme.description ?? "").trim().slice(0, 500) || null,
      tags: Array.isArray(theme.tags) ? theme.tags.slice(0, 10) : [],
      location_label: (theme.location_label ?? "Global").trim().slice(0, 100),
      tier,
      status: "approved",
      sources: [
        {
          type: "bootstrap",
          created_at: new Date().toISOString()
        }
      ],
      lang: "en",
      published_at: new Date().toISOString()
    }).select("id, title, tags, location_label").single();
    if (insertErr || !newTopic) {
      log("warn", "bootstrap_insert_failed", {
        title: theme.title,
        error: insertErr?.message
      }, traceId);
      continue;
    }
    log("info", "bootstrap_theme_created", {
      topicId: newTopic.id,
      title: newTopic.title
    }, traceId);
    inserted.push({
      id: newTopic.id,
      title: newTopic.title,
      tags: newTopic.tags,
      location_label: newTopic.location_label,
      child_count: 0
    });
  }
  log("info", "bootstrap_complete", {
    created: inserted.length
  }, traceId);
  return inserted;
}
// ── Core classification logic ─────────────────────────────────────────────────
async function classifyDraft(draft, allParents, openai, threshold) {
  const effectiveLocation = draft.location_label ?? "Global";
  // Geography filter: match location or Global parents
  const candidates = allParents.filter((p)=>!p.location_label || p.location_label === "Global" || p.location_label === effectiveLocation);
  if (!candidates.length) {
    return {
      parent_topic_id: null,
      confidence: 0,
      reason: "No geographically relevant parent topics",
      is_new: false
    };
  }
  const parentList = candidates.map((p)=>{
    const tags = p.tags?.length ? p.tags.join(", ") : "no tags";
    const loc = p.location_label ? ` | location: ${p.location_label}` : "";
    return `  - id: "${p.id}" | title: "${p.title}" | tags: ${tags}${loc} | children: ${p.child_count}`;
  }).join("\n");
  const draftTags = draft.tags?.length ? draft.tags.join(", ") : "no tags";
  const userPrompt = `Available themes:\n${parentList}\n\n` + `New story to classify:\n` + `  Title: "${draft.title ?? ""}"\n` + `  Tags: ${draftTags}\n` + `  Location: ${effectiveLocation}\n` + `  Summary: "${(draft.summary ?? "").slice(0, 300)}"\n\n` + `Which theme best fits this story?`;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 150,
      // @ts-ignore
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content: CLASSIFY_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: userPrompt
        }
      ]
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch  {
      parsed = {};
    }
    const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
    const parentTopicId = confidence >= threshold ? parsed.parent_topic_id ?? null : null;
    return {
      parent_topic_id: parentTopicId,
      confidence,
      reason: parsed.reason ?? "",
      is_new: false
    };
  } catch (err) {
    log("warn", "classify_llm_failed", {
      draftId: draft.id,
      error: err?.message
    });
    return {
      parent_topic_id: null,
      confidence: 0,
      reason: "LLM call failed",
      is_new: false
    };
  }
}
async function proposeDraft(draft, openai, supabaseAdmin) {
  const draftTags = draft.tags?.length ? draft.tags.join(", ") : "no tags";
  const userPrompt = `Story that needs a new theme:\n` + `  Title: "${draft.title ?? ""}"\n` + `  Tags: ${draftTags}\n` + `  Location: ${draft.location_label ?? "Global"}\n` + `  Summary: "${(draft.summary ?? "").slice(0, 300)}"\n\n` + `Propose a broad, reusable theme. Themes must be topic-level, not event-level.`;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 300,
      // @ts-ignore
      response_format: {
        type: "json_object"
      },
      messages: [
        {
          role: "system",
          content: PROPOSE_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: userPrompt
        }
      ]
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch  {
      parsed = {};
    }
    if (!parsed.title || parsed.title.trim().length < 8) {
      log("warn", "propose_invalid_title", {
        draftId: draft.id,
        preview: raw.slice(0, 150)
      });
      return {
        parent_topic_id: null,
        confidence: 0,
        reason: "LLM proposal invalid",
        is_new: false
      };
    }
    const validTiers = [
      "city",
      "county",
      "state",
      "country",
      "global"
    ];
    const tier = validTiers.includes(parsed.tier) ? parsed.tier : "country";
    const proposedTitle = parsed.title.trim().slice(0, 200);
    const { data: newTopic, error: insertErr } = await supabaseAdmin.from("topics").insert({
      title: proposedTitle,
      description: (parsed.description ?? "").trim().slice(0, 500) || null,
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 10) : [],
      location_label: (parsed.location_label ?? draft.location_label ?? "Global").trim().slice(0, 100),
      tier,
      status: "pending",
      sources: [
        {
          type: "auto_generated",
          trigger_draft: draft.id,
          created_at: new Date().toISOString()
        }
      ],
      lang: "en",
      published_at: new Date().toISOString()
    }).select("id, title, tags, location_label").single();
    if (insertErr || !newTopic) {
      log("warn", "propose_insert_failed", {
        draftId: draft.id,
        error: insertErr?.message
      });
      return {
        parent_topic_id: null,
        confidence: 0,
        reason: `Insert failed: ${insertErr?.message}`,
        is_new: false
      };
    }
    log("info", "new_theme_proposed", {
      draftId: draft.id,
      topicId: newTopic.id,
      title: newTopic.title
    });
    return {
      parent_topic_id: newTopic.id,
      confidence: 0.9,
      reason: `New theme auto-proposed: "${newTopic.title}" — pending admin approval`,
      is_new: true,
      proposed_title: newTopic.title
    };
  } catch (err) {
    log("warn", "propose_llm_failed", {
      draftId: draft.id,
      error: err?.message
    });
    return {
      parent_topic_id: null,
      confidence: 0,
      reason: "LLM call failed",
      is_new: false
    };
  }
}
// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req)=>{
  const traceId = crypto.randomUUID();
  const origin = req.headers.get("origin");
  const corsHeaders = {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-cron-secret",
    "Content-Type": "application/json"
  };
  if (req.method === "OPTIONS") return new Response(null, {
    status: 204,
    headers: corsHeaders
  });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      ok: false,
      error: "Method Not Allowed"
    }), {
      status: 405,
      headers: corsHeaders
    });
  }
  const auth = await authorize(req);
  if (!auth.ok) {
    log("warn", "auth_failed", {
      error: auth.error
    }, traceId);
    return new Response(JSON.stringify({
      ok: false,
      error: auth.error
    }), {
      status: auth.status ?? 401,
      headers: corsHeaders
    });
  }
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
  const BATCH = Number(Deno.env.get("CLASSIFY_BATCH") ?? "20");
  const WINDOW_HOURS = Number(Deno.env.get("CLASSIFY_WINDOW_HOURS") ?? "72");
  const THRESHOLD = Number(Deno.env.get("CLASSIFY_THRESHOLD") ?? "0.75");
  const MIN_PARENTS = Number(Deno.env.get("MIN_APPROVED_PARENTS") ?? "5");
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Missing SUPABASE_URL or SERVICE_ROLE"
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
  if (!OPENAI_KEY) {
    return new Response(JSON.stringify({
      ok: false,
      error: "Missing OPENAI_API_KEY"
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: {
      persistSession: false
    }
  });
  const openai = new OpenAI({
    apiKey: OPENAI_KEY
  });
  const sinceIso = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();
  log("info", "start", {
    batch: BATCH,
    windowHours: WINDOW_HOURS,
    threshold: THRESHOLD,
    minParents: MIN_PARENTS,
    sinceIso
  }, traceId);
  // ── Step 1: Load unclassified topic_drafts ────────────────────────────────
  const { data: drafts, error: draftsErr } = await sb.from("topic_drafts").select("id, title, summary, tags, location_label").gte("created_at", sinceIso).is("parent_topic_id", null).order("created_at", {
    ascending: false
  }).limit(BATCH);
  if (draftsErr) {
    log("error", "fetch_drafts_failed", {
      error: draftsErr.message
    }, traceId);
    return new Response(JSON.stringify({
      ok: false,
      error: draftsErr.message
    }), {
      status: 500,
      headers: corsHeaders
    });
  }
  const unclassified = drafts ?? [];
  log("info", "drafts_loaded", {
    count: unclassified.length
  }, traceId);
  if (!unclassified.length) {
    return new Response(JSON.stringify({
      ok: true,
      traceId,
      classified: 0,
      proposed: 0,
      skipped: 0,
      bootstrapped: 0
    }), {
      status: 200,
      headers: corsHeaders
    });
  }
  // ── Step 2: Load approved parent topics ──────────────────────────────────
  const { data: allParents, error: parentsErr } = await sb.rpc("get_parent_topics_for_classification");
  if (parentsErr) {
    log("warn", "fetch_parents_failed", {
      error: parentsErr.message
    }, traceId);
  }
  let parents = allParents ?? [];
  log("info", "parents_loaded", {
    count: parents.length
  }, traceId);
  // ── Step 3: Bootstrap if not enough approved parents ─────────────────────
  let bootstrapped = 0;
  if (parents.length < MIN_PARENTS) {
    log("info", "bootstrap_triggered", {
      approvedCount: parents.length,
      minRequired: MIN_PARENTS
    }, traceId);
    // Use a wider window for bootstrap — grab up to 100 titles to build taxonomy from
    const { data: allDrafts } = await sb.from("topic_drafts").select("id, title, summary, tags, location_label").is("parent_topic_id", null).order("created_at", {
      ascending: false
    }).limit(100);
    const bootstrapDrafts = allDrafts ?? unclassified;
    const newParents = await bootstrapParentTopics(bootstrapDrafts, openai, sb, traceId);
    bootstrapped = newParents.length;
    parents = [
      ...parents,
      ...newParents
    ];
    log("info", "bootstrap_merged", {
      totalParents: parents.length
    }, traceId);
  }
  // ── Step 4: Classify each draft ───────────────────────────────────────────
  let classified = 0;
  let proposed = 0;
  let skipped = 0;
  const errors = [];
  for (const draft of unclassified){
    try {
      let result;
      if (parents.length > 0) {
        result = await classifyDraft(draft, parents, openai, THRESHOLD);
      } else {
        result = {
          parent_topic_id: null,
          confidence: 0,
          reason: "No approved parents available",
          is_new: false
        };
      }
      // If classify didn't find a match, propose a new theme
      if (!result.parent_topic_id) {
        result = await proposeDraft(draft, openai, sb);
      }
      if (!result.parent_topic_id) {
        log("warn", "classify_skipped", {
          draftId: draft.id,
          reason: result.reason
        }, traceId);
        skipped++;
        continue;
      }
      // ── Step 5: Write classification back to topic_drafts ─────────────────
      const { error: updateErr } = await sb.from("topic_drafts").update({
        parent_topic_id: result.parent_topic_id,
        parent_topic_confidence: result.confidence,
        parent_topic_reason: result.reason,
        updated_at: new Date().toISOString()
      }).eq("id", draft.id);
      if (updateErr) {
        log("warn", "update_draft_failed", {
          draftId: draft.id,
          error: updateErr.message
        }, traceId);
        errors.push(`update_failed(${draft.id}): ${updateErr.message}`);
        skipped++;
        continue;
      }
      if (result.is_new) {
        proposed++;
        log("info", "draft_proposed_new_theme", {
          draftId: draft.id,
          parentTopicId: result.parent_topic_id,
          title: draft.title?.slice(0, 60)
        }, traceId);
      } else {
        classified++;
        log("info", "draft_classified", {
          draftId: draft.id,
          parentTopicId: result.parent_topic_id,
          confidence: result.confidence,
          reason: result.reason,
          title: draft.title?.slice(0, 60)
        }, traceId);
      }
      // Add newly proposed pending topic to local pool so subsequent drafts
      // in this same run can classify against it.
      // Use proposed_title (the real DB title) instead of parsing result.reason.
      if (result.is_new && result.parent_topic_id && result.proposed_title) {
        parents.push({
          id: result.parent_topic_id,
          title: result.proposed_title,
          tags: null,
          location_label: draft.location_label,
          child_count: 1
        });
      }
    } catch (err) {
      log("error", "draft_exception", {
        draftId: draft.id,
        error: err?.message
      }, traceId);
      errors.push(`exception(${draft.id}): ${err?.message}`);
      skipped++;
    }
  }
  log("info", "complete", {
    classified,
    proposed,
    skipped,
    bootstrapped,
    errorCount: errors.length
  }, traceId);
  return new Response(JSON.stringify({
    ok: true,
    traceId,
    classified,
    proposed,
    skipped,
    bootstrapped,
    errors: errors.length ? errors : undefined
  }), {
    status: 200,
    headers: corsHeaders
  });
});
