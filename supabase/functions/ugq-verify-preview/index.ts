import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const APPROVE_TIMEOUT_MS = 120_000;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json(401, { ok: false, error: "UNAUTHORIZED" });
    const userSb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userSb.auth.getUser();
    if (!user) return json(401, { ok: false, error: "UNAUTHORIZED" });

    const body = await req.json().catch(() => ({}));
    const proposalId = typeof body.proposal_id === "string" ? body.proposal_id : "";
    if (!proposalId) return json(400, { ok: false, error: "MISSING_PROPOSAL_ID" });

    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: proposal } = await adminSb.from("user_question_proposals")
      .select("id, user_id, status, auto_topic_id, input_mode")
      .eq("id", proposalId).maybeSingle();
    if (!proposal) return json(404, { ok: false, error: "NOT_FOUND" });
    if (proposal.user_id !== user.id) {
      return json(403, { ok: false, error: "FORBIDDEN", message: "You can only verify your own proposals." });
    }
    if (proposal.status !== "in_review") {
      return json(200, { ok: true, verified: false, message: `Proposal is '${proposal.status}' — nothing to verify.` });
    }
    if (!proposal.auto_topic_id) {
      console.error(JSON.stringify({ tag: "ugq-verify-preview.no_topic", proposal_id: proposalId }));
      return json(200, { ok: true, verified: false, message: "No topic resolved yet — showing the unverified preview." });
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), APPROVE_TIMEOUT_MS);
    let approveJson: Record<string, unknown> = {};
    let approveOk = false;
    try {
      const approveResp = await fetch(`${SUPABASE_URL}/functions/v1/ugq-moderate`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-cron-secret": CRON_SECRET },
        body: JSON.stringify({ proposal_id: proposalId, action: "approve", topic_id: proposal.auto_topic_id }),
      });
      approveJson = await approveResp.json().catch(() => ({}));
      approveOk = approveResp.ok && approveJson?.ok === true && approveJson?.status === "reframed";
    } catch (e) {
      console.error(JSON.stringify({ tag: "ugq-verify-preview.approve_threw", message: (e as Error).message }));
    } finally {
      clearTimeout(t);
    }

    if (!approveOk) {
      console.error(JSON.stringify({
        tag: "ugq-verify-preview.approve_failed",
        proposal_id: proposalId,
        error: approveJson?.error ?? "unknown",
        message: approveJson?.message ?? null,
      }));
      return json(200, {
        ok: true, verified: false,
        message: "Couldn't finish fact-checking just now — showing the unverified preview instead.",
      });
    }

    const question = typeof approveJson.question === "string" ? approveJson.question.trim() : "";
    if (!question) {
      console.error(JSON.stringify({ tag: "ugq-verify-preview.empty_question", proposal_id: proposalId }));
      return json(200, { ok: true, verified: false, message: "Fact-checked result was empty — showing the unverified preview instead." });
    }
    const previewReframe = {
      question,
      slider_low_label: typeof approveJson.slider_low_label === "string" ? approveJson.slider_low_label : null,
      slider_high_label: typeof approveJson.slider_high_label === "string" ? approveJson.slider_high_label : null,
      context_summary: null as string | null,
      supporting_links: Array.isArray(approveJson.sources)
        ? (approveJson.sources as unknown[]).filter((u): u is string => typeof u === "string").slice(0, 3)
        : [],
      quality_notes: typeof approveJson.quality_notes === "string" ? approveJson.quality_notes : null,
      cover_image_url: null as string | null,
      model: typeof approveJson.model === "string" ? approveJson.model : null,
      generated_at: new Date().toISOString(),
      verified: true,
    };

    await adminSb.from("user_question_proposals").update({
      status: "in_review",
      preview_reframe: previewReframe,
    }).eq("id", proposalId);

    console.log(JSON.stringify({ tag: "ugq-verify-preview.ok", proposal_id: proposalId }));
    return json(200, { ok: true, verified: true, preview_reframe: previewReframe });
  } catch (err) {
    return json(500, { ok: false, error: "INTERNAL_ERROR", message: (err as Error).message });
  }
});
