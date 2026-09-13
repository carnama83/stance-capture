// supabase/functions/embed-whoami/index.ts
// Epic T — Session detection for embed page
//
// Called by the embed page on load to check if the visitor has
// an active Stance Capture session. Returns minimal user info
// so the embed can show "You're signed in as X" and skip the CTA.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({
      authenticated: false
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  try {
    const userSb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const { data: { user }, error } = await userSb.auth.getUser();
    if (error || !user) {
      return new Response(JSON.stringify({
        authenticated: false
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Get minimal profile info
    const adminSb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: profile } = await adminSb.from("profiles").select("username, random_id, avatar_url").eq("user_id", user.id).single();
    return new Response(JSON.stringify({
      authenticated: true,
      display: profile?.username ?? profile?.random_id ?? "Stance Capture user",
      avatar_url: profile?.avatar_url ?? null
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("[embed-whoami]", err);
    return new Response(JSON.stringify({
      authenticated: false
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
