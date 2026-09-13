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

const REFINE_MIN_LEN = 5;
const REFINE_MAX_LEN = 500;

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
    const additionalContext = typeof body.additional_context === "string" ? body.additional_context.trim() : "";
    if (!proposalId) return json(400, { ok: false, error: "MISSING_PROPOSAL_ID" });
    if (additionalContext.length < REFINE_MIN_LEN) {
      return json(400, {
        ok: false, error: "CONTEXT_TOO_SHORT",
        message: `Add a bit more detail (at least ${REFINE_MIN_LEN} characters).`,
      });
    }
    if (additionalContext.length > REFINE_MAX_LEN) {
      return json(400, {
        ok: false, error: "CONTEXT_TOO_LONG",
        message: `Keep it under ${REFINE_MAX_LEN} characters.`,
      });
    }

    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: proposal } = await adminSb.from("user_question_proposals")
      .select("id, user_id, status").eq("id", proposalId).maybeSingle();
    if (!proposal) return json(404, { ok: false, error: "NOT_FOUND" });
    if (proposal.user_id !== user.id) {
      return json(403, { ok: false, error: "FORBIDDEN", message: "You can only refine your own proposals." });
    }
    if (proposal.status !== "in_review") {
      return json(409, {
        ok: false, error: "NOT_REFINABLE",
        message: proposal.status === "published"
          ? "This question is already live and can't be refined here."
          : `Proposal is '${proposal.status}' — it needs to be in review to refine.`,
      });
    }

    const screenResp = await fetch(`${SUPABASE_URL}/functions/v1/ugq-screen`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": CRON_SECRET },
      body: JSON.stringify({ proposal_id: proposalId, additional_context: additionalContext }),
    });
    const screenJson = await screenResp.json().catch(() => ({}));
    if (!screenResp.ok || !screenJson?.ok) {
      console.error(JSON.stringify({ tag: "ugq-refine-preview.screen_failed", body: screenJson }));
      return json(502, { ok: false, error: "REFINE_FAILED", message: "Couldn't regenerate the preview just now. Please try again." });
    }

    if (screenJson.refined === false) {
      return json(200, {
        ok: true, refined: false,
        message: "Couldn't regenerate with that context — your original preview is still here.",
        preview_reframe: screenJson.preview_reframe ?? null,
      });
    }

    return json(200, { ok: true, refined: true, preview_reframe: screenJson.preview_reframe });
  } catch (err) {
    return json(500, { ok: false, error: "INTERNAL_ERROR", message: (err as Error).message });
  }
});
