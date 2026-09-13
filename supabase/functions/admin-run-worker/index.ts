// supabase/functions/admin-run-worker/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json"
    }
  });
}
function ensure(v, name) {
  if (!v || String(v).trim().length === 0) throw new Error(`Missing env ${name}`);
  return String(v);
}
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  try {
    const supabaseUrl = ensure(Deno.env.get("SUPABASE_URL"), "SUPABASE_URL");
    const anonKey = ensure(Deno.env.get("SUPABASE_ANON_KEY"), "SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
    ensure(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY (or SERVICE_ROLE_KEY)");
    // ---- Auth: cron OR admin user ----
    const incomingCron = req.headers.get("x-cron-secret") || "";
    const cronSecret = Deno.env.get("CRON_SECRET") || "";
    const authHeader = req.headers.get("authorization") || "";
    const hasBearer = authHeader.startsWith("Bearer ");
    const userToken = hasBearer ? authHeader.replace("Bearer ", "") : "";
    const cronOk = cronSecret && incomingCron && incomingCron === cronSecret;
    if (!cronOk) {
      // Require admin JWT
      if (!userToken) return json(401, {
        ok: false,
        error: "Missing Authorization"
      });
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
      const { data: isAdmin, error: adminErr } = await supabaseUser.rpc("is_admin_me");
      if (adminErr || isAdmin !== true) {
        return json(403, {
          ok: false,
          error: "Forbidden – admin only",
          details: adminErr?.message ?? null,
          is_admin: isAdmin ?? null
        });
      }
    }
    // ---- Drain-only: call ingest-worker (does NOT enqueue) ----
    // We prefer calling ingest-worker with cron-secret so ingest-worker can remain cron-only.
    const workerCron = cronSecret || incomingCron;
    if (!workerCron) {
      return json(500, {
        ok: false,
        error: "Missing CRON_SECRET env (needed to call ingest-worker securely)"
      });
    }
    const workerUrl = `${supabaseUrl}/functions/v1/ingest-worker`;
    const started = performance.now();
    const resp = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cron-secret": workerCron
      },
      body: JSON.stringify({})
    });
    const durationMs = Math.round(performance.now() - started);
    const text = await resp.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch  {
      parsed = {
        raw: text
      };
    }
    if (!resp.ok) {
      return json(resp.status, {
        ok: false,
        error: "ingest-worker returned non-2xx",
        status: resp.status,
        duration_ms: durationMs,
        workerBody: parsed
      });
    }
    return json(200, {
      ok: true,
      duration_ms: durationMs,
      workerBody: parsed
    });
  } catch (err) {
    console.error("admin-run-worker error:", err);
    return json(500, {
      ok: false,
      error: err?.message ?? String(err)
    });
  }
});
