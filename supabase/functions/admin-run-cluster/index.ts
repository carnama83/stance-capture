// supabase/functions/admin-run-cluster/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function isAdminResult(v) {
  // supports: boolean, {is_admin:true}, [{is_admin:true}]
  if (v === true) return true;
  if (v?.is_admin === true) return true;
  if (Array.isArray(v) && v[0]?.is_admin === true) return true;
  return false;
}
serve(async (req)=>{
  // CORS preflight
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  // Always return JSON with status 200 so the client gets the payload (no FunctionsHttpError)
  const json = (obj)=>new Response(JSON.stringify(obj), {
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "application/json"
      }
    });
  if (req.method !== "POST") {
    return json({
      ok: false,
      error: "Method Not Allowed"
    });
  }
  try {
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({
        ok: false,
        error: "Missing Authorization header"
      });
    }
    const userToken = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const cronSecret = Deno.env.get("CRON_SECRET") || "";
    const missing = [
      !supabaseUrl && "SUPABASE_URL",
      !anonKey && "SUPABASE_ANON_KEY",
      !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY",
      !cronSecret && "CRON_SECRET"
    ].filter(Boolean);
    if (missing.length) {
      return json({
        ok: false,
        error: "Missing env vars",
        missing
      });
    }
    // 1) Verify caller is admin using their JWT
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${userToken}`
        }
      },
      auth: {
        persistSession: false
      }
    });
    const { data: adminCheck, error: adminError } = await supabaseUser.rpc("is_admin_me");
    if (adminError || !isAdminResult(adminCheck)) {
      return json({
        ok: false,
        error: "Forbidden – admin only",
        details: adminError?.message ?? null
      });
    }
    // 2) Trigger cluster worker.
    // IMPORTANT: Your cluster function is deployed with verify-jwt enabled,
    // so we MUST forward the user's JWT + apikey.
    const started = performance.now();
    const resp = await fetch(`${supabaseUrl}/functions/v1/cluster`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cron-secret": cronSecret,
        // ✅ required to satisfy verify-jwt on the cluster function
        "authorization": `Bearer ${userToken}`,
        // ✅ matches what supabase-js sends; safe and commonly required by setups
        "apikey": anonKey
      },
      body: JSON.stringify({})
    });
    const text = await resp.text();
    let body = text;
    try {
      body = JSON.parse(text);
    } catch  {
    // keep as text
    }
    return json({
      ok: resp.ok,
      status: resp.status,
      duration_ms: Math.round(performance.now() - started),
      cluster_response: body
    });
  } catch (e) {
    return json({
      ok: false,
      error: e?.message ?? String(e)
    });
  }
});
