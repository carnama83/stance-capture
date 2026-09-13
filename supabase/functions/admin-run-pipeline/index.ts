// supabase/functions/admin-run-pipeline/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
function isAdminResult(v) {
  // supports: boolean, {is_admin:true}, [{is_admin:true}]
  if (v === true) return true;
  if (v?.is_admin === true) return true;
  if (Array.isArray(v) && v[0]?.is_admin === true) return true;
  return false;
}
function withTimeout(p, ms, label) {
  return new Promise((resolve, reject)=>{
    const t = setTimeout(()=>reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then((v)=>{
      clearTimeout(t);
      resolve(v);
    }).catch((e)=>{
      clearTimeout(t);
      reject(e);
    });
  });
}
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Missing or invalid Authorization header"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "content-type": "application/json"
        }
      });
    }
    const userToken = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Missing SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY env"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "content-type": "application/json"
        }
      });
    }
    // Parse body (optional)
    let body = {};
    try {
      body = await req.json();
    } catch  {
      body = {};
    }
    const mode = body?.mode === "full" ? "full" : "ingest_only";
    // 1) Verify caller is admin (user JWT)
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
      return new Response(JSON.stringify({
        ok: false,
        error: "Forbidden – admin only",
        details: adminError?.message ?? null
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "content-type": "application/json"
        }
      });
    }
    // 2) Do the work using service role (bypass RLS safely)
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false
      }
    });
    const started = performance.now();
    if (mode === "full") {
      // Full pipeline = ingest + cluster + generate (can be slow)
      const { error } = await supabaseAdmin.rpc("run_ingestion_pipeline");
      const durationMs = Math.round(performance.now() - started);
      if (error) {
        return new Response(JSON.stringify({
          ok: false,
          error: error.message,
          duration_ms: durationMs
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            "content-type": "application/json"
          }
        });
      }
      return new Response(JSON.stringify({
        ok: true,
        mode,
        duration_ms: durationMs
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "content-type": "application/json"
        }
      });
    }
    // mode === "ingest_only" (Epic B)
    // Step A: enqueue all enabled sources (calls /functions/v1/ingest via DB helper)
    const { error: ingestErr } = await supabaseAdmin.rpc("run_ingest_http");
    if (ingestErr) {
      const durationMs = Math.round(performance.now() - started);
      return new Response(JSON.stringify({
        ok: false,
        mode,
        error: ingestErr.message,
        duration_ms: durationMs
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "content-type": "application/json"
        }
      });
    }
    // Step B: process queue into news_items (call ingest-worker like admin-run-worker does)
    if (!cronSecret) {
      const durationMs = Math.round(performance.now() - started);
      return new Response(JSON.stringify({
        ok: false,
        mode,
        error: "CRON_SECRET env var is not set",
        duration_ms: durationMs
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "content-type": "application/json"
        }
      });
    }
    const workerUrl = `${supabaseUrl}/functions/v1/ingest-worker`;
    const workerResp = await withTimeout(fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": cronSecret
      },
      body: JSON.stringify({})
    }), 25000, "ingest-worker");
    const workerText = await workerResp.text();
    let workerBody = workerText;
    try {
      workerBody = JSON.parse(workerText);
    } catch  {
    // keep as text
    }
    const durationMs = Math.round(performance.now() - started);
    return new Response(JSON.stringify({
      ok: true,
      mode,
      duration_ms: durationMs,
      worker_ok: workerResp.ok,
      worker_status: workerResp.status,
      worker_body: workerBody
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "content-type": "application/json"
      }
    });
  } catch (err) {
    console.error("admin-run-pipeline exception", err);
    return new Response(JSON.stringify({
      ok: false,
      error: err?.message ?? String(err)
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "content-type": "application/json"
      }
    });
  }
});
