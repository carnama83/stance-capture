// admin-draft-social-captions
// Facebook Campaign Manager (PDD v1.2 §4, §11): AI-drafted caption variants.
//
// POST { campaign_id, count_per_language?: 1..8 (default 4), languages?: string[] }
// For each language, reads the question's PUBLISHED rendition (the exact wording
// people will answer) and asks Claude for neutral caption variants across the
// content sequence: opening invitation, issue context, participation reminder,
// closing reminder. Variants are written as status 'draft' with no neutrality
// check; an admin edits each one and records the check before it can be used.
//
// The link is never part of the caption: the planner appends the tracked
// /c/<code> URL (or puts it in a comment, per the group's link policy).
//
// Auth: admin user JWT via is_admin_me(); writes with the service role.
// Env: ANTHROPIC_API_KEY, SOCIAL_CAPTION_MODEL (default claude-sonnet-4-6).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FUNC = "admin-draft-social-captions";
const MODEL = (Deno.env.get("SOCIAL_CAPTION_MODEL") ?? "claude-sonnet-4-6").trim();
const PURPOSES = ["invitation", "context", "reminder", "closing"] as const;
const LANGUAGE_NAMES: Record<string, string> = { en: "English", hi: "Hindi (Devanagari script)", mr: "Marathi (Devanagari script)" };

function log(level: string, msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, func: FUNC, msg, ...extra }));
}
function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SYSTEM_PROMPT = `You write short Facebook post captions that invite people in one city to record their stance on a civic question on Stance Capture.

Stance Capture's Mirror Rule applies to every caption:
- Describe the issue factually and invite people to say where they stand. Never frame one position as correct, better, obvious or more popular.
- Never imply a majority, a trend, momentum, or how people are leaning. Never quote or invent participation numbers.
- Never urge a direction ("say no to...", "support...", "stop..."). Both sides must feel equally welcome.
- Never say or imply the question closes, ends or has a deadline.
- No loaded or emotive wording, no rhetorical questions that suggest an answer, no hashtags, no emojis, no ALL CAPS.
- Use only facts stated in the question and background provided. Do not add laws, policies, dates, figures, names or events from your own knowledge.
- Do not include any link or URL; it is added separately.
- Keep each caption between 120 and 400 characters. Plain, local, respectful.

Write in the requested language only. Hindi and Marathi must be natural, in Devanagari script, not a word-for-word translation of English.

Return ONLY a JSON array, no prose, of objects: {"purpose": "invitation"|"context"|"reminder"|"closing", "body": "..."}. Each body must be clearly different in wording from the others.`;

async function draftWithClaude(apiKey: string, lang: string, count: number, r: {
  rendered_text: string; slider_low_label: string | null; slider_high_label: string | null; context_summary: string | null;
}, cityName: string | null) {
  const purposes = Array.from({ length: count }, (_, i) => PURPOSES[i % PURPOSES.length]);
  const user = [
    `Language: ${LANGUAGE_NAMES[lang] ?? lang}`,
    cityName ? `City: ${cityName}` : null,
    `Question (exact published wording): ${r.rendered_text}`,
    r.slider_low_label || r.slider_high_label
      ? `Answer scale ends: "${r.slider_low_label ?? ""}" ... "${r.slider_high_label ?? ""}"` : null,
    r.context_summary ? `Background: ${r.context_summary}` : null,
    `Write ${count} captions with these purposes, in order: ${purposes.join(", ")}.`,
    `invitation = first post introducing the question; context = explains what the issue is about; reminder = a later nudge to add a stance; closing = a final reminder that does not imply any deadline.`,
  ].filter(Boolean).join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 2048, temperature: 0.7, system: SYSTEM_PROMPT, messages: [{ role: "user", content: user }] }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${body?.error?.message ?? "request failed"}`);
  const text = (body?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("model did not return a JSON array");
  const arr = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(arr)) throw new Error("model did not return a JSON array");
  return arr
    .map((x: any, i: number) => ({
      purpose: PURPOSES.includes(x?.purpose) ? x.purpose : purposes[i] ?? "invitation",
      body: String(x?.body ?? "").replace(/https?:\/\/\S+/g, "").trim(),
    }))
    .filter((x: any) => x.body.length >= 10 && x.body.length <= 2000);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "POST only" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_KEY) return json(500, { ok: false, error: "ANTHROPIC_API_KEY not configured" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { ok: false, error: "Missing bearer token" });
  const userSb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: isAdmin, error: adminErr } = await userSb.rpc("is_admin_me");
  if (adminErr || isAdmin !== true) return json(403, { ok: false, error: "Admin only" });
  const { data: userData } = await userSb.auth.getUser();
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let payload: any;
  try { payload = await req.json(); } catch { return json(400, { ok: false, error: "Invalid JSON" }); }
  const campaignId = String(payload?.campaign_id ?? "");
  const count = Math.min(8, Math.max(1, Number(payload?.count_per_language ?? 4) || 4));
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return json(400, { ok: false, error: "campaign_id required" });

  const { data: campaign } = await admin.from("social_campaigns")
    .select("id, question_id, language_codes, status, location_id").eq("id", campaignId).maybeSingle();
  if (!campaign) return json(404, { ok: false, error: "Campaign not found" });
  if (["cancelled", "completed"].includes(campaign.status)) return json(400, { ok: false, error: `Campaign is ${campaign.status}` });

  const languages: string[] = (Array.isArray(payload?.languages) && payload.languages.length
    ? payload.languages : campaign.language_codes).filter((l: string) => campaign.language_codes.includes(l));

  const { data: q } = await admin.from("questions").select("id, location_id").eq("id", campaign.question_id).single();
  // The campaign's target city wins; the question's own location is often a country.
  let cityName: string | null = null;
  const cityId = campaign.location_id ?? q?.location_id;
  if (cityId) {
    const { data: loc } = await admin.from("locations").select("name").eq("id", cityId).maybeSingle();
    cityName = loc?.name ?? null;
  }

  const results: Record<string, unknown> = {};
  for (const lang of languages) {
    const { data: r } = await admin.from("question_renditions")
      .select("rendered_text, slider_low_label, slider_high_label, context_summary")
      .eq("question_id", campaign.question_id).eq("language_code", lang).eq("lifecycle_status", "published")
      .order("published_at", { ascending: false }).limit(1).maybeSingle();
    if (!r) { results[lang] = { ok: false, error: `No published ${lang} rendition` }; continue; }

    try {
      const drafts = await draftWithClaude(ANTHROPIC_KEY, lang, count, r, cityName);
      const { data: existing } = await admin.from("social_campaign_caption_variants")
        .select("label, body_hash").eq("campaign_id", campaignId).eq("language_code", lang);
      const used = new Set((existing ?? []).map((e: any) => e.label));
      let n = (existing ?? []).length;
      const rows = drafts.map((d: any) => {
        let label: string;
        do { n += 1; label = `${lang.toUpperCase()}-${n}`; } while (used.has(label));
        used.add(label);
        return {
          campaign_id: campaignId, language_code: lang, label, purpose: d.purpose,
          body: d.body, ai_draft: d.body, ai_model: MODEL, ai_drafted_at: new Date().toISOString(),
          edited_by: userData?.user?.id ?? null,
        };
      });
      const { data: inserted, error } = await admin.from("social_campaign_caption_variants").insert(rows).select("id, label, purpose, body");
      if (error) throw new Error(error.message);
      results[lang] = { ok: true, inserted: inserted?.length ?? 0 };
    } catch (err) {
      log("error", "draft_failed", { lang, error: String((err as Error)?.message ?? err) });
      results[lang] = { ok: false, error: String((err as Error)?.message ?? err) };
    }
  }

  return json(200, { ok: true, model: MODEL, results });
});
