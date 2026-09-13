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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json(401, { ok: false, error: "UNAUTHORIZED" });
    const userSb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userSb.auth.getUser();
    if (!user) return json(401, { ok: false, error: "UNAUTHORIZED" });

    const body = await req.json().catch(() => ({}));
    const questionId = typeof body.question_id === "string" ? body.question_id : "";
    const authorityId = typeof body.authority_id === "string" ? body.authority_id : "";
    if (!questionId || !authorityId) return json(400, { ok: false, error: "MISSING_FIELDS" });

    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: question } = await adminSb.from("questions")
      .select("id, proposed_by").eq("id", questionId).maybeSingle();
    if (!question) return json(404, { ok: false, error: "QUESTION_NOT_FOUND" });
    if (question.proposed_by !== user.id) {
      return json(403, { ok: false, error: "FORBIDDEN", message: "You can only tag authorities on your own questions." });
    }

    const { data: authority } = await adminSb.from("authority_registry")
      .select("id, name").eq("id", authorityId).maybeSingle();
    if (!authority) return json(404, { ok: false, error: "AUTHORITY_NOT_FOUND" });

    const { error: upErr } = await adminSb.from("user_authority_suggestions")
      .upsert(
        { question_id: questionId, authority_id: authorityId, status: "user_tagged", suggested_by: "user" },
        { onConflict: "question_id,authority_id" },
      );
    if (upErr) {
      console.error(JSON.stringify({ tag: "ugq-tag-authority.upsert_failed", message: upErr.message }));
      return json(500, { ok: false, error: "TAG_FAILED", message: upErr.message });
    }

    return json(200, { ok: true, question_id: questionId, authority_id: authorityId, authority_name: authority.name, status: "user_tagged" });
  } catch (err) {
    return json(500, { ok: false, error: "INTERNAL_ERROR", message: (err as Error).message });
  }
});
